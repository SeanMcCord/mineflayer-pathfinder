const {Vec3} = require('vec3')
const nbt = require('prismarine-nbt')
const Move = require('./move')
const {logger} = require('./logger')

// TODO: rename node to move in here. This file opperates on moves.

const cardinalDirectionVectors = [
  new Vec3(-1, 0, 0), // north
  new Vec3(1, 0, 0), // south
  new Vec3(0, 0, -1), // west
  new Vec3(0, 0, 1), // east
  new Vec3(0, 1, 0), // up
  new Vec3(0, -1, 0), // down
]
const cardinalDirections = [
  {x: -1, z: 0}, // north
  {x: 1, z: 0}, // south
  {x: 0, z: -1}, // west
  {x: 0, z: 1} // east
]
const diagonalDirections = [
  {x: -1, z: -1},
  {x: -1, z: 1},
  {x: 1, z: -1},
  {x: 1, z: 1}
]

class Movements {
  constructor(bot, mcData) {
    this.bot = bot

    this.occupyCost = (positions) => 0;

    this.canDig = true
    this.digCost = 1
    this.placeCost = 1
    this.liquidCost = 1

    this.dontCreateFlow = true
    this.allow1by1towers = true
    this.allowFreeMotion = false
    this.allowParkour = true
    this.allowSprinting = true

    this.blocksCantBreak = new Set()
    this.blocksCantBreak.add(mcData.blocksByName.chest.id)
    this.blocksCantBreak.add(mcData.blocksByName.wheat.id)

    mcData.blocksArray.forEach(block => {
      if (block.diggable) return
      this.blocksCantBreak.add(block.id)
    })

    this.blocksToAvoid = new Set()
    this.blocksToAvoid.add(mcData.blocksByName.fire.id)
    this.blocksToAvoid.add(mcData.blocksByName.wheat.id)
    this.blocksToAvoid.add(mcData.blocksByName.lava.id)

    this.liquids = new Set()
    this.liquids.add(mcData.blocksByName.water.id)
    this.liquids.add(mcData.blocksByName.lava.id)

    this.climbables = new Set()
    this.climbables.add(mcData.blocksByName.ladder.id)
    // this.climbables.add(mcData.blocksByName.vine.id)

    this.replaceables = new Set()
    this.replaceables.add(mcData.blocksByName.air.id)
    if (mcData.blocksByName.cave_air) this.replaceables.add(mcData.blocksByName.cave_air.id)
    if (mcData.blocksByName.void_air) this.replaceables.add(mcData.blocksByName.void_air.id)
    this.replaceables.add(mcData.blocksByName.water.id)
    this.replaceables.add(mcData.blocksByName.lava.id)

    this.scafoldingBlocks = []
    this.scafoldingBlocks.push(mcData.blocksByName.dirt.id)
    this.scafoldingBlocks.push(mcData.blocksByName.cobblestone.id)

    const Block = require('prismarine-block')(bot.version)
    this.fences = new Set()
    this.carpets = new Set()
    mcData.blocksArray.map(x => Block.fromStateId(x.minStateId, 0)).forEach(block => {
      if (block.shapes.length > 0) {
        // Fences or any block taller than 1, they will be considered as non-physical to avoid
        // trying to walk on them
        if (block.shapes[0][4] > 1) this.fences.add(block.type)
        // Carpets or any blocks smaller than 0.1, they will be considered as safe to walk in
        if (block.shapes[0][4] < 0.1) this.carpets.add(block.type)
      }
    })

    this.maxDropDown = 4
  }

  countScaffoldingItems() {
    let count = 0
    const items = this.bot.inventory.items()
    for (const id of this.scafoldingBlocks) {
      for (const j in items) {
        const item = items[j]
        if (item.type === id) count += item.count
      }
    }
    return count
  }

  getScaffoldingItem() {
    const items = this.bot.inventory.items()
    for (const id of this.scafoldingBlocks) {
      for (const j in items) {
        const item = items[j]
        if (item.type === id) return item
      }
    }
    return null
  }

  // TODO: finalize interface and remove direct pasage of node.
  getBlock(pos, dx, dy, dz, node) {
    const emptyBlock = {
      replaceable: false,
      safe: false,
      physical: false,
      liquid: false,
      climbable: false,
      height: dy
    }
    if (pos == null) {
      return emptyBlock
    }
    const blockPosition = new Vec3(pos.x + dx, pos.y + dy, pos.z + dz)
    // Get the state after all previous mutations
    const blockState = node.mutatedBlockStateMap.get(blockPosition.toString())
    let b
    if (blockState != null) {
      b = {
        position: blockPosition,
        // air and cobble
        type: blockState === 'air' ? 0 : 12,
        boundingBox: blockState === 'air' ? 'empty' : 'block',
        shapes: blockState === 'air' ? [] : [[0, 0, 0, 1, 1, 1]],
        // TODO: maybe put the correct ammount here
        digTime: () => blockState === 'air' ? 0 : 3
      }
    } else {
      b = this.bot.blockAt(blockPosition, false)
    }
    if (b == null) {
      return emptyBlock
    }
    b.climbable = this.climbables.has(b.type)
    b.safe = (b.boundingBox === 'empty' || b.climbable || this.carpets.has(b.type)) && !this.blocksToAvoid.has(b.type)
    b.physical = b.boundingBox === 'block' && !this.fences.has(b.type)
    b.replaceable = this.replaceables.has(b.type) && !b.physical
    b.liquid = this.liquids.has(b.type)
    b.height = pos.y + dy
    for (const shape of b.shapes) {
      b.height = Math.max(b.height, pos.y + dy + shape[4])
    }
    return b
  }

  safeToBreak(block, node) {
    if (!this.canDig) {
      return false
    }

    if (this.dontCreateFlow) {
      // false if next to liquid
      if (this.getBlock(block.position, 0, 1, 0, node).liquid) return false
      if (this.getBlock(block.position, -1, 0, 0, node).liquid) return false
      if (this.getBlock(block.position, 1, 0, 0, node).liquid) return false
      if (this.getBlock(block.position, 0, 0, -1, node).liquid) return false
      if (this.getBlock(block.position, 0, 0, 1, node).liquid) return false
    }
    return block.type && !this.blocksCantBreak.has(block.type)
    // TODO: break exclusion areas
  }

  safeOrBreak(block, toBreak, node) {
    if (block.safe) return 0;
    if (!this.safeToBreak(block, node)) return 100 // Can't break, so can't move
    toBreak.push(block.position)

    const tool = this.bot.pathfinder.bestHarvestTool(block)
    const enchants = (tool && tool.nbt) ? nbt.simplify(tool.nbt).Enchantments : []
    const effects = this.bot.entity.effects
    const digTime = block.digTime(tool ? tool.type : null, false, false, false, enchants, effects)
    return (1 + 3 * digTime / 1000) * this.digCost
  }

  getMoveJumpUp(node, dir, neighbors) {
    const blockA = this.getBlock(node, 0, 2, 0, node)
    const blockH = this.getBlock(node, dir.x, 2, dir.z, node)
    const blockB = this.getBlock(node, dir.x, 1, dir.z, node)
    const blockC = this.getBlock(node, dir.x, 0, dir.z, node)

    let cost = 2 // move cost (move+jump)
    const toBreak = []
    const toPlace = []
    const positionsOccupied = []
    positionsOccupied.push(blockA.position)
    positionsOccupied.push(blockH.position)
    positionsOccupied.push(blockB.position)

    if (!blockC.physical) {
      if (node.remainingBlocks === 0) return // not enough blocks to place

      // TODO: avoid entities as part of placing blocks
      const blockD = this.getBlock(node, dir.x, -1, dir.z, node)
      if (!blockD.physical) {
        if (node.remainingBlocks === 1) return // not enough blocks to place

        if (!blockD.replaceable) {
          if (!this.safeToBreak(blockD, node)) return
          toBreak.push(blockD.position)
        }
        toPlace.push({x: node.x, y: node.y - 1, z: node.z, dx: dir.x, dy: 0, dz: dir.z, returnPos: new Vec3(node.x, node.y, node.z)})
        cost += this.placeCost // additional cost for placing a block
      }

      if (!blockC.replaceable) {
        if (!this.safeToBreak(blockC, node)) return
        toBreak.push(blockC.position)
      }
      toPlace.push({x: node.x + dir.x, y: node.y - 1, z: node.z + dir.z, dx: 0, dy: 1, dz: 0})
      cost += this.placeCost // additional cost for placing a block

      blockC.height += 1
    }

    const block0 = this.getBlock(node, 0, -1, 0, node)
    if (blockC.height - block0.height > 1.2) return // Too high to jump

    cost += this.safeOrBreak(blockA, toBreak, node)
    if (cost > 100) return
    cost += this.safeOrBreak(blockH, toBreak, node)
    if (cost > 100) return
    cost += this.safeOrBreak(blockB, toBreak, node)
    if (cost > 100) return

    neighbors.push(new Move(blockB.position.x, blockB.position.y, blockB.position.z, node.remainingBlocks - toPlace.length, cost, toBreak, toPlace, undefined, positionsOccupied, node.allBroken, node.allPlaced, node.actionChain))
  }

  getMoveForward(node, dir, neighbors) {
    // Block head will be in
    const blockB = this.getBlock(node, dir.x, 1, dir.z, node)
    // Block feet will be in
    const blockC = this.getBlock(node, dir.x, 0, dir.z, node)
    // Block we will stand on
    const blockD = this.getBlock(node, dir.x, -1, dir.z, node)

    let cost = 1 // move cost
    const toBreak = []
    const toPlace = []
    const positionsOccupied = []
    positionsOccupied.push(blockB.position)
    positionsOccupied.push(blockC.position)

    if (!blockD.physical && !blockC.liquid) {
      if (node.remainingBlocks === 0) return // not enough blocks to place

      if (!blockD.replaceable) {
        if (!this.safeToBreak(blockD, node)) return
        toBreak.push(blockD.position)
      }
      toPlace.push({x: node.x, y: node.y - 1, z: node.z, dx: dir.x, dy: 0, dz: dir.z})
      cost += this.placeCost // additional cost for placing a block
    }

    cost += this.safeOrBreak(blockB, toBreak, node)
    if (cost > 100) return
    cost += this.safeOrBreak(blockC, toBreak, node)
    if (cost > 100) return

    if (this.getBlock(node, 0, 0, 0, node).liquid) cost += this.liquidCost

    neighbors.push(new Move(blockC.position.x, blockC.position.y, blockC.position.z, node.remainingBlocks - toPlace.length, cost, toBreak, toPlace, undefined, positionsOccupied, node.allBroken, node.allPlaced, node.actionChain))
  }

  getMoveDiagonal(node, dir, neighbors) {
    let cost = Math.SQRT2 // move cost
    const toBreak = []
    const positionsOccupied = []

    // Block feet will move into diagonally
    const blockC = this.getBlock(node, dir.x, 0, dir.z, node)
    const y = blockC.physical ? 1 : 0

    // TODO: handle the case where z or x direction block -1 is not safe or empty
    let cost1 = 0
    const toBreak1 = []
    // Block head will move into if going in z
    const blockB1 = this.getBlock(node, 0, y + 1, dir.z, node)
    // Block feet will move into if going in z
    const blockC1 = this.getBlock(node, 0, y, dir.z, node)
    cost1 += this.safeOrBreak(blockB1, toBreak1, node)
    cost1 += this.safeOrBreak(blockC1, toBreak1, node)

    let cost2 = 0
    const toBreak2 = []
    // Block head will move into if going in x
    const blockB2 = this.getBlock(node, dir.x, y + 1, 0, node)
    // Block feet will move into if going in x
    const blockC2 = this.getBlock(node, dir.x, y, 0, node)
    cost2 += this.safeOrBreak(blockB2, toBreak2, node)
    cost2 += this.safeOrBreak(blockC2, toBreak2, node)

    if (cost1 < cost2) {
      // If neither of the blocks we brush against are physical then we may enter unsafe blocks
      if (!blockB2.physical && !blockC2.physical) {
        if (!blockB2.safe || !blockC2.safe) {
          return
        }
      }
      // Go in z
      cost += cost1
      toBreak.push(...toBreak1)
      positionsOccupied.push(blockB1.position)
      positionsOccupied.push(blockC1.position)
    } else {
      // If neither of the blocks we brush against are physical then we may enter unsafe blocks
      if (!blockB1.physical && !blockC1.physical) {
        if (!blockB1.safe || !blockC1.safe) {
          return
        }
      }
      // Go in x
      cost += cost2
      toBreak.push(...toBreak2)
      positionsOccupied.push(blockB2.position)
      positionsOccupied.push(blockC2.position)
    }
    if (cost > 100) return

    // TODO: check if this moves us into unsafe blocks for the direction with the higher cost.
    // Right now it picks the direction with the lower cost, but if the other direction was unsafe it would move the bot through those blocks.

    const blockStandInGoal = this.getBlock(node, dir.x, y, dir.z, node)
    cost += this.safeOrBreak(blockStandInGoal, toBreak, node)
    if (cost > 100) return
    const blockHeadInGoal = this.getBlock(node, dir.x, y + 1, dir.z, node)
    cost += this.safeOrBreak(blockHeadInGoal, toBreak, node)
    if (cost > 100) return
    positionsOccupied.push(blockStandInGoal.position)
    positionsOccupied.push(blockHeadInGoal.position)

    // TODO: check if this works when jumping out of water
    if (this.getBlock(node, 0, 0, 0, node).liquid) cost += this.liquidCost

    const blockD = this.getBlock(node, dir.x, -1, dir.z, node)
    if (y === 1) {
      // Case move up one block
      const block0 = this.getBlock(node, 0, -1, 0, node)
      if (blockC.height - block0.height > 1.2) return // Too high to jump
      const blockAbove = this.getBlock(node, 0, 2, 0, node)
      cost += this.safeOrBreak(blockAbove, toBreak, node)
      if (cost > 100) return
      positionsOccupied.push(blockAbove.position)
      cost += 1
      neighbors.push(new Move(blockC.position.x, blockC.position.y + 1, blockC.position.z, node.remainingBlocks, cost, toBreak, undefined, undefined, positionsOccupied, node.allBroken, node.allPlaced, node.actionChain))
    } else if (blockD.physical || blockC.liquid) {
      // Case on same level
      neighbors.push(new Move(blockC.position.x, blockC.position.y, blockC.position.z, node.remainingBlocks, cost, toBreak, undefined, undefined, positionsOccupied, node.allBroken, node.allPlaced, node.actionChain))
    } else if (this.getBlock(node, dir.x, -2, dir.z, node).physical || blockD.liquid) {
      // Case move down one block
      if (blockC.liquid) return // dont go underwater
      cost += this.safeOrBreak(blockD, toBreak, node)
      if (cost > 100) return
      positionsOccupied.push(blockD.position)
      neighbors.push(new Move(blockC.position.x, blockC.position.y - 1, blockC.position.z, node.remainingBlocks, cost, toBreak, undefined, undefined, positionsOccupied, node.allBroken, node.allPlaced, node.actionChain))
    }
  }

  getLandingBlock(node, dir) {
    let positionsOccupied = [];
    let blockLand = this.getBlock(node, dir.x, -2, dir.z, node)
    positionsOccupied.push(blockLand.position)
    while (blockLand.position && blockLand.position.y > 0) {
      if (blockLand.liquid && blockLand.safe) {
        return {block: blockLand, positions: positionsOccupied}
      }
      if (blockLand.physical) {
        if (node.y - blockLand.position.y <= this.maxDropDown) {
          positionsOccupied = positionsOccupied.filter((pos) => !pos.equals(blockLand.position))
          const blockAboveLanding = this.getBlock(blockLand.position, 0, 1, 0, node)
          return {block: blockAboveLanding, positions: positionsOccupied}
        } else {
          return {block: null, positions: []}
        }
      }
      if (!blockLand.safe) {
        return {block: null, positions: []}
      } else {
        blockLand = this.getBlock(blockLand.position, 0, -1, 0, node)
        positionsOccupied.push(blockLand.position)
      }
    }
    return {block: null, positions: []}
  }

  getMoveDropDown(node, dir, neighbors) {
    const blockB = this.getBlock(node, dir.x, 1, dir.z, node)
    const blockC = this.getBlock(node, dir.x, 0, dir.z, node)
    const blockD = this.getBlock(node, dir.x, -1, dir.z, node)

    let cost = 1 // move cost
    const toBreak = []
    const toPlace = []
    const positionsOccupied = []

    const blockLandResult = this.getLandingBlock(node, dir)
    const blockLand = blockLandResult.block
    if (!blockLand) return
    positionsOccupied.push(...blockLandResult.positions)

    // TODO: get the cost of moving through the blocks on the way to blockLand
    cost += this.safeOrBreak(blockB, toBreak, node)
    if (cost > 100) return
    positionsOccupied.push(blockB.position)
    cost += this.safeOrBreak(blockC, toBreak, node)
    if (cost > 100) return
    positionsOccupied.push(blockC.position)
    cost += this.safeOrBreak(blockD, toBreak, node)
    if (cost > 100) return
    positionsOccupied.push(blockD.position)

    if (blockC.liquid) return // dont go underwater

    neighbors.push(new Move(blockLand.position.x, blockLand.position.y, blockLand.position.z, node.remainingBlocks - toPlace.length, cost, toBreak, toPlace, undefined, positionsOccupied, node.allBroken, node.allPlaced, node.actionChain))
  }

  getMoveDown(node, neighbors) {
    const block0 = this.getBlock(node, 0, -1, 0, node)

    let cost = 1 // move cost
    const toBreak = []
    const toPlace = []
    const positionsOccupied = []

    const blockLandResult = this.getLandingBlock(node, {x: 0, z: 0})
    const blockLand = blockLandResult.block
    if (!blockLand) return
    positionsOccupied.push(...blockLandResult.positions)

    // TODO: get the cost of moving through the blocks on the way to blockLand
    cost += this.safeOrBreak(block0, toBreak, node)
    if (cost > 100) return
    positionsOccupied.push(block0.position)

    if (this.getBlock(node, 0, 0, 0, node).liquid) return // dont go underwater

    neighbors.push(new Move(blockLand.position.x, blockLand.position.y, blockLand.position.z, node.remainingBlocks - toPlace.length, cost, toBreak, toPlace, undefined, positionsOccupied, node.allBroken, node.allPlaced, node.actionChain))
  }

  getMoveUp(node, neighbors) {
    const block1 = this.getBlock(node, 0, 0, 0, node)
    if (block1.liquid) return

    const block2 = this.getBlock(node, 0, 2, 0, node)
    let cost = 1 // move cost
    const toBreak = []
    const toPlace = []
    const positionsOccupied = []
    cost += this.safeOrBreak(block2, toBreak, node)
    if (cost > 100) return
    positionsOccupied.push(block2.position)

    if (!block1.climbable) {
      if (!this.allow1by1towers || node.remainingBlocks === 0) return // not enough blocks to place

      if (!block1.replaceable) {
        if (!this.safeToBreak(block1, node)) return
        // TODO: check if this logic is right. Why are we breaking a block if it isn't replaceable?
        toBreak.push(block1.position)
      }

      const block0 = this.getBlock(node, 0, -1, 0, node)
      if (block0.physical && block0.height - node.y < -0.2) return // cannot jump-place from a half block

      toPlace.push({x: node.x, y: node.y - 1, z: node.z, dx: 0, dy: 1, dz: 0, jump: true})
      cost += this.placeCost // additional cost for placing a block
    }

    neighbors.push(new Move(node.x, node.y + 1, node.z, node.remainingBlocks - toPlace.length, cost, toBreak, toPlace, undefined, positionsOccupied, node.allBroken, node.allPlaced, node.actionChain))
  }

  // Jump up, down or forward over a 1 block gap
  getMoveParkourForward(node, dir, neighbors) {
    const positionsOccupied = []
    const block0 = this.getBlock(node, 0, -1, 0, node)
    // TODO: do we check if block1 is safe?
    const block1 = this.getBlock(node, dir.x, -1, dir.z, node)
    const blockFeetA = this.getBlock(node, dir.x, 0, dir.z, node)
    const blockHeadA = this.getBlock(node, dir.x, 1, dir.z, node)
    // TODO: why don't we jump over if the height is the same?
    if ((block1.physical && block1.height >= block0.height) ||
      !blockFeetA.safe ||
      !blockHeadA.safe) return
    positionsOccupied.push(blockHeadA.position)
    positionsOccupied.push(blockFeetA.position)

    if (this.getBlock(node, 0, 0, 0, node).liquid) return // cant jump from water

    // If we have a block on the ceiling, we cannot jump but we can still fall
    const ceilingBlockA = this.getBlock(node, 0, 2, 0, node)
    const ceilingBlockB = this.getBlock(node, dir.x, 2, dir.z, node)
    let ceilingPositions = [ceilingBlockA.position, ceilingBlockB.position]
    let ceilingClear = ceilingBlockA.safe && ceilingBlockB.safe

    // Similarly for the down path
    const floorBlock = this.getBlock(node, dir.x, -2, dir.z, node)
    const floorPositions = [floorBlock.position]
    let floorCleared = floorBlock.safe

    const maxD = this.allowSprinting ? 4 : 2

    for (let d = 2; d <= maxD; d++) {
      const dx = dir.x * d
      const dz = dir.z * d
      const blockA = this.getBlock(node, dx, 2, dz, node)
      const blockB = this.getBlock(node, dx, 1, dz, node)
      const blockC = this.getBlock(node, dx, 0, dz, node)
      const blockD = this.getBlock(node, dx, -1, dz, node)

      if (ceilingClear && blockB.safe && blockC.safe && blockD.physical) {
        const positionsOccupiedForMove = [...positionsOccupied, ...ceilingPositions, blockB.position, blockC.position]
        // Forward
        neighbors.push(new Move(blockC.position.x, blockC.position.y, blockC.position.z, node.remainingBlocks, 1, [], [], true, positionsOccupiedForMove, node.allBroken, node.allPlaced, node.actionChain))
        break
      } else if (ceilingClear && blockB.safe && blockC.physical) {
        // Up
        if (blockA.safe) {
          if (blockC.height - block0.height > 1.2) break // Too high to jump
          const positionsOccupiedForMove = [...positionsOccupied, ...ceilingPositions, blockB.position, blockA.position]
          neighbors.push(new Move(blockB.position.x, blockB.position.y, blockB.position.z, node.remainingBlocks, 1, [], [], true, positionsOccupiedForMove, node.allBroken, node.allPlaced, node.actionChain))
          break
        }
      } else if ((ceilingClear || d === 2) && blockB.safe && blockC.safe && blockD.safe && floorCleared) {
        // Down
        const blockE = this.getBlock(node, dx, -2, dz, node)
        if (blockE.physical) {
          const positionsOccupiedForMove = [...positionsOccupied, ...ceilingPositions, ...floorPositions, blockB.position, blockC.position, blockD.position]
          neighbors.push(new Move(blockD.position.x, blockD.position.y, blockD.position.z, node.remainingBlocks, 1, [], [], true, positionsOccupiedForMove, node.allBroken, node.allPlaced, node.actionChain))
        }
        floorPositions.push(blockE.position)
        floorCleared = floorCleared && blockE.safe
      } else if (!blockB.safe || !blockC.safe) {
        break
      }

      ceilingPositions.push(blockA.position)
      ceilingClear = ceilingClear && blockA.safe
    }
  }

  getPlaceBlock(node, dir, yOffset, neighbors) {
    if (node.remainingBlocks === 0) return // not enough blocks to place

    const directionVector = new Vec3(dir.x || 0, dir.y || 0, dir.z || 0)
    const positionsOccupied = [new Vec3(node.x, node.y, node.z), new Vec3(node.x, node.y, node.z).offset(0, 1, 0)]
    const blockBOrC = this.getBlock(node, dir.x, yOffset, dir.z, node)
    if (blockBOrC.physical) {
      return
    }
    const targetBlockPos = node.offset(0, yOffset, 0).plus(directionVector)
    cardinalDirectionVectors.some((direction) => {
      const inverseDirection = direction.scaled(-1)
      if (directionVector.equals(inverseDirection)) {
        return false
      }
      const refBlock = this.getBlock(targetBlockPos, direction.x, direction.y, direction.z, node)
      if (refBlock.physical) {
        const toPlace = [{x: refBlock.position.x, y: refBlock.position.y, z: refBlock.position.z, dx: inverseDirection.x, dy: inverseDirection.y, dz: inverseDirection.z}]
        const cost = this.placeCost * 5
        neighbors.push(new Move(node.x, node.y, node.z, node.remainingBlocks - toPlace.length, cost, undefined, toPlace, undefined, positionsOccupied, node.allBroken, node.allPlaced, node.actionChain))
        return true
      } else {
        return false
      }
    })
  }

  // for each cardinal direction:
  // "." is head. "+" is feet and current location.
  // "#" is initial floor which is always solid. "a"-"u" are blocks to check
  //
  //   --0123-- horizontalOffset
  //  |
  // +2  aho
  // +1  .bip
  //  0  +cjq
  // -1  #dkr
  // -2   els
  // -3   fmt
  // -4   gn
  //  |
  //  dy

  getNeighbors(node) {
    const neighbors = []

    // Simple moves in 4 cardinal points
    for (const i in cardinalDirections) {
      const dir = cardinalDirections[i]
      this.getMoveForward(node, dir, neighbors)
      this.getMoveJumpUp(node, dir, neighbors)
      this.getMoveDropDown(node, dir, neighbors)
      if (this.allowParkour) {
        this.getMoveParkourForward(node, dir, neighbors)
      }
      // this.getPlaceBlock(node, dir, 1, neighbors)
    }

    // Diagonals
    for (const i in diagonalDirections) {
      const dir = diagonalDirections[i]
      this.getMoveDiagonal(node, dir, neighbors)
    }

    this.getMoveDown(node, neighbors)
    this.getMoveUp(node, neighbors)

    neighbors.forEach((neighbor) => {
      neighbor.cost = neighbor.cost + (neighbor.cost * this.occupyCost(neighbor.positionsOccupied));
    });

    neighbors.forEach((neighbor) => {
      logger.info({
        pathfinderMovement: 'generation',
        startNodePos: {x: node.x, y: node.y, z: node.z},
        neighbor
      });
    });
    return neighbors
  }
}

module.exports = Movements
