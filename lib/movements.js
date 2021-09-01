const {Vec3} = require('vec3')
const nbt = require('prismarine-nbt')
const Move = require('./move')
const {logger} = require('./logger')
const PositionCache = require('./position_cache');

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

// https://stackoverflow.com/a/2450976
const shuffle = (array) => {
  let currentIndex = array.length, randomIndex;

  // While there remain elements to shuffle...
  while (0 !== currentIndex) {

    // Pick a remaining element...
    randomIndex = Math.floor(Math.random() * currentIndex);
    currentIndex--;

    // And swap it with the current element.
    [array[currentIndex], array[randomIndex]] = [
      array[randomIndex], array[currentIndex]];
  }

  return array;
}


const bestHarvestTool = (bot, block) => {
  const availableTools = bot.inventory.items()
  const effects = bot.entity.effects

  let fastest = Number.MAX_VALUE
  let bestTool = null
  for (const tool of availableTools) {
    const enchants = (tool && tool.nbt) ? nbt.simplify(tool.nbt).Enchantments : []
    const digTime = block.digTime(tool ? tool.type : null, false, false, false, enchants, effects)
    if (digTime < fastest) {
      fastest = digTime
      bestTool = tool
    }
  }

  return bestTool
}

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
    this.allowMutationHistory = false;

    this.blocksCantBreak = new Set()
    this.blocksCantBreak.add(mcData.blocksByName.chest.id)
    this.blocksCantBreak.add(mcData.blocksByName.wheat.id)
    this.blocksCantBreakArray = Array(mcData.blocksArray.length).fill(false);

    mcData.blocksArray.forEach(block => {
      if (block.diggable) return
      this.blocksCantBreak.add(block.id)
      this.blocksCantBreakArray[block.id] = true;
    })

    this.blocksToAvoid = new Set()
    this.blocksToAvoid.add(mcData.blocksByName.fire.id)
    this.blocksToAvoid.add(mcData.blocksByName.wheat.id)
    this.blocksToAvoid.add(mcData.blocksByName.lava.id)

    this.blocksToAvoidArray = Array(mcData.blocksArray.length).fill(false);
    this.blocksToAvoidArray[mcData.blocksByName.fire.id] = true;
    this.blocksToAvoidArray[mcData.blocksByName.wheat.id] = true;
    this.blocksToAvoidArray[mcData.blocksByName.lava.id] = true;


    this.liquids = new Set()
    this.liquids.add(mcData.blocksByName.water.id)
    this.liquids.add(mcData.blocksByName.lava.id)

    this.liquidsArray = Array(mcData.blocksArray.length).fill(false);
    this.liquidsArray[mcData.blocksByName.water.id] = true;
    this.liquidsArray[mcData.blocksByName.lava.id] = true;


    this.climbables = new Set()
    this.climbables.add(mcData.blocksByName.ladder.id)
    // this.climbables.add(mcData.blocksByName.vine.id)

    this.climbablesArray = Array(mcData.blocksArray.length).fill(false);
    this.climbablesArray[mcData.blocksByName.ladder.id] = true;


    this.replaceables = new Set()
    this.replaceables.add(mcData.blocksByName.air.id)
    if (mcData.blocksByName.cave_air) this.replaceables.add(mcData.blocksByName.cave_air.id)
    if (mcData.blocksByName.void_air) this.replaceables.add(mcData.blocksByName.void_air.id)
    this.replaceables.add(mcData.blocksByName.water.id)
    this.replaceables.add(mcData.blocksByName.lava.id)

    this.replaceablesArray = Array(mcData.blocksArray.length).fill(false);
    this.replaceablesArray[mcData.blocksByName.air.id] = true;
    if (mcData.blocksByName.cave_air) this.replaceables[mcData.blocksByName.cave_air.id] = true;
    if (mcData.blocksByName.void_air) this.replaceablesArray[mcData.blocksByName.void_air.id] = true;
    this.replaceablesArray[mcData.blocksByName.water.id] = true;
    this.replaceablesArray[mcData.blocksByName.lava.id] = true;

    this.scafoldingBlocks = []
    this.scafoldingBlocks.push(mcData.blocksByName.dirt.id)
    this.scafoldingBlocks.push(mcData.blocksByName.cobblestone.id)

    const Block = require('prismarine-block')(bot.version)
    this.fences = new Set()
    this.carpets = new Set()
    this.fencesArray = Array(mcData.blocksArray.length).fill(false);
    this.carpetsArray = Array(mcData.blocksArray.length).fill(false);
    mcData.blocksArray.map(x => Block.fromStateId(x.minStateId, 0)).forEach(block => {
      if (block.shapes.length > 0) {
        // Fences or any block taller than 1, they will be considered as non-physical to avoid
        // trying to walk on them
        if (block.shapes[0][4] > 1) {
          this.fences.add(block.type)
          this.fencesArray[block.type] = true;
        }
        // Carpets or any blocks smaller than 0.1, they will be considered as safe to walk in
        if (block.shapes[0][4] < 0.1) {
          this.carpetsArray[block.type] = true;
        }
      }
    })

    this.maxDropDown = 4

    this.testBlockCount = 0;
    this.testBlockMap = new Map();
    this.testCacheHits = 0;
    this.testBlockCache = new PositionCache(undefined, (x, y, z) => this.getBlockNoCache(x, y, z));

    this.getBlock = this.testBlockCache.getPosWriteOnMiss.bind(this.testBlockCache);
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

  getBlockNoCache(x, y, z) {
    const blockPosition = new Vec3(x, y, z)
    const b = this.bot.blockAt(blockPosition, false)
    if (b == null) {
      return {
        position: blockPosition,
        type: null,
        boundingBox: null,
        shapes: [],
        digTime: () => 50000,
        replaceable: false,
        safe: false,
        physical: false,
        liquid: false,
        climbable: false,
        height: y,
        fake: true,
      }
    }
    const climbable = this.climbablesArray[b.type];
    const safe = (b.boundingBox === 'empty' || climbable || this.carpetsArray[b.type]) && !this.blocksToAvoidArray[b.type];
    const digTime = () => b.digTime();
    const physical = b.boundingBox === 'block' && !this.fencesArray[b.type];
    const replaceable = this.replaceablesArray[b.type] && !physical;
    let height = 0;
    for (const shape of b.shapes) {
      if (height < shape[4]) {
        height = shape[4];
      }
    }
    height = height + y;
    return {
      position: blockPosition,
      type: b.type,
      boundingBox: b.boundingBox,
      shapes: b.shapes,
      digTime,
      replaceable,
      safe,
      physical,
      liquid: this.liquidsArray[b.type],
      climbable,
      height,
      fake: false,
    }
  }

  getBlockWithMutations(blockPosition, mutations) {
    if (!this.allowMutationHistory) {
      return this.getBlockNoCache(blockPosition);
    }
    const blockState = mutations.getPos(blockPosition);
    if (blockState == null) {
      return this.getBlockNoCache(blockPosition);
    } else {
      return {
        position: blockPosition,
        // air and cobble
        type: blockState,
        boundingBox: blockState === 0 ? 'empty' : 'block',
        shapes: blockState === 0 ? [] : [[0, 0, 0, 1, 1, 1]],
        // TODO: maybe put the correct ammount here
        digTime: () => blockState === 0 ? 0 : 3,
        replaceable: false,
        safe: blockState === 0,
        physical: blockState !== 0,
        liquid: false,
        climbable: false,
        height: posY + dy,
        fake: true,
      };
    }
  }

  // getBlockEncapsulate(x, y, z) {
  //   return this.testBlockCache.getPosWriteOnMiss(x, y, z);
  // }

  // // TODO: finalize interface and remove direct pasage of node.
  // getBlock(posX, posY, posZ, dx, dy, dz) {
  //   // this.testBlockCount++;
  //   // if (posX == null || posY == null || posZ == null) {
  //   //   throw new Error('getBlock pos null');
  //   // }
  //   // const posHash = blockPosition.toString();
  //   // if (this.testBlockMap.has(posHash)) {
  //   //   this.testBlockMap.set(posHash,
  //   //     this.testBlockMap.get(posHash) + 1
  //   //   );
  //   // } else {
  //   //   this.testBlockMap.set(posHash, 1);
  //   // }
  //   // const simplePos = {x: posX + dx, y: posY + dy, z: posZ + dz};
  //   return this.getBlockEncapsulate(posX + dx, posY + dy, posZ + dz)
  // }

  safeToBreak(block, node) {
    if (!this.canDig) {
      return false
    }

    if (this.dontCreateFlow) {
      // false if next to liquid
      if (this.getBlock(block.position.x, block.position.y + 1, block.position.z).liquid) return false
      if (this.getBlock(block.position.x - 1, block.position.y, block.position.z).liquid) return false
      if (this.getBlock(block.position.x + 1, block.position.y, block.position.z).liquid) return false
      if (this.getBlock(block.position.x, block.position.y, block.position.z - 1).liquid) return false
      if (this.getBlock(block.position.x, block.position.y, block.position.z + 1).liquid) return false
    }
    return block.type && !this.blocksCantBreakArray[block.type]
    // TODO: break exclusion areas
  }

  safeOrBreak(block, toBreak, node) {
    if (block.safe) return 0;
    if (!this.safeToBreak(block, node)) return 100 // Can't break, so can't move
    toBreak.push(block.position)

    const tool = bestHarvestTool(this.bot, block)
    const enchants = (tool && tool.nbt) ? nbt.simplify(tool.nbt).Enchantments : []
    const effects = this.bot.entity.effects
    const digTime = block.digTime(tool ? tool.type : null, false, false, false, enchants, effects)
    return (1 + 3 * digTime / 1000) * this.digCost
  }

  getMoveJumpUp(node, dir, neighbors) {
    const blockA = this.getBlock(node.x, node.y + 2, node.z)
    const blockH = this.getBlock(node.x + dir.x, node.y + 2, node.z + dir.z)
    const blockB = this.getBlock(node.x + dir.x, node.y + 1, node.z + dir.z)
    const blockC = this.getBlock(node.x + dir.x, node.y, node.z + dir.z)

    let cost = 2 // move cost (move+jump)
    const toBreak = []
    const toPlace = []
    const positionsOccupied = []
    // positionsOccupied.push(blockA.position)
    // positionsOccupied.push(blockH.position)
    // positionsOccupied.push(blockB.position)

    if (!blockC.physical) {
      if (node.remainingBlocks === 0) return // not enough blocks to place

      // TODO: avoid entities as part of placing blocks
      const blockD = this.getBlock(node.x + dir.x, node.y - 1, node.z + dir.z)
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

    const block0 = this.getBlock(node.x, node.y - 1, node.z)
    if (blockC.height - block0.height > 1.2) return // Too high to jump

    cost += this.safeOrBreak(blockA, toBreak, node)
    if (cost > 100) return
    cost += this.safeOrBreak(blockH, toBreak, node)
    if (cost > 100) return
    cost += this.safeOrBreak(blockB, toBreak, node)
    if (cost > 100) return

    neighbors.push(new Move(blockB.position.x, blockB.position.y, blockB.position.z, node.remainingBlocks - toPlace.length, cost, toBreak, toPlace, undefined, positionsOccupied, node.allBroken, node.allPlaced, node.actionChain, node.mutatedBlockStateMap, node.costToCome, node.priorPosHashes, node.mutations))
  }

  getMoveForward(node, dir, neighbors) {
    // Block head will be in
    const blockB = this.getBlock(node.x + dir.x, node.y + 1, node.z + dir.z)
    // Block feet will be in
    const blockC = this.getBlock(node.x + dir.x, node.y, node.z + dir.z)
    // Block we will stand on
    const blockD = this.getBlock(node.x + dir.x, node.y - 1, node.z + dir.z)

    let cost = 1 // move cost
    const toBreak = []
    const toPlace = []
    const positionsOccupied = []
    // positionsOccupied.push(blockB.position)
    // positionsOccupied.push(blockC.position)

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

    if (this.getBlock(node.x, node.y, node.z).liquid) cost += this.liquidCost

    neighbors.push(new Move(blockC.position.x, blockC.position.y, blockC.position.z, node.remainingBlocks - toPlace.length, cost, toBreak, toPlace, undefined, positionsOccupied, node.allBroken, node.allPlaced, node.actionChain, node.mutatedBlockStateMap, node.costToCome, node.priorPosHashes, node.mutations))
  }

  getMoveDiagonal(node, dir, neighbors) {
    let cost = Math.SQRT2 // move cost
    const toBreak = []
    const positionsOccupied = []

    // Block feet will move into diagonally
    const blockC = this.getBlock(node.x + dir.x, node.y, node.z + dir.z)
    const y = blockC.physical ? 1 : 0

    // TODO: handle the case where z or x direction block -1 is not safe or empty
    let cost1 = 0
    const toBreak1 = []
    // Block head will move into if going in z
    const blockB1 = this.getBlock(node.x, node.y + y + 1, node.z + dir.z)
    // Block feet will move into if going in z
    const blockC1 = this.getBlock(node.x, node.y + y, node.z + dir.z)
    cost1 += this.safeOrBreak(blockB1, toBreak1, node)
    cost1 += this.safeOrBreak(blockC1, toBreak1, node)

    let cost2 = 0
    const toBreak2 = []
    // Block head will move into if going in x
    const blockB2 = this.getBlock(node.x + dir.x, node.y + y + 1, node.z)
    // Block feet will move into if going in x
    const blockC2 = this.getBlock(node.x + dir.x, node.y + y, node.z)
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
      // positionsOccupied.push(blockB1.position)
      // positionsOccupied.push(blockC1.position)
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
      // positionsOccupied.push(blockB2.position)
      // positionsOccupied.push(blockC2.position)
    }
    if (cost > 100) return

    // TODO: check if this moves us into unsafe blocks for the direction with the higher cost.
    // Right now it picks the direction with the lower cost, but if the other direction was unsafe it would move the bot through those blocks.

    const blockStandInGoal = this.getBlock(node.x + dir.x, node.y + y, node.z + dir.z)
    cost += this.safeOrBreak(blockStandInGoal, toBreak, node)
    if (cost > 100) return
    const blockHeadInGoal = this.getBlock(node.x + dir.x, node.y + y + 1, node.z + dir.z)
    cost += this.safeOrBreak(blockHeadInGoal, toBreak, node)
    if (cost > 100) return
    // positionsOccupied.push(blockStandInGoal.position)
    // positionsOccupied.push(blockHeadInGoal.position)

    // TODO: check if this works when jumping out of water
    if (this.getBlock(node.x, node.y, node.z).liquid) cost += this.liquidCost

    const blockD = this.getBlock(node.x + dir.x, node.y - 1, node.z + dir.z)
    if (y === 1) {
      // Case move up one block
      const block0 = this.getBlock(node.x, node.y - 1, node.z)
      if (blockC.height - block0.height > 1.2) return // Too high to jump
      const blockAbove = this.getBlock(node.x, node.y + 2, node.z)
      cost += this.safeOrBreak(blockAbove, toBreak, node)
      if (cost > 100) return
      // positionsOccupied.push(blockAbove.position)
      cost += 1
      neighbors.push(new Move(blockC.position.x, blockC.position.y + 1, blockC.position.z, node.remainingBlocks, cost, toBreak, undefined, undefined, positionsOccupied, node.allBroken, node.allPlaced, node.actionChain, node.mutatedBlockStateMap, node.costToCome, node.priorPosHashes, node.mutations))
    } else if (blockD.physical || blockC.liquid) {
      // Case on same level
      neighbors.push(new Move(blockC.position.x, blockC.position.y, blockC.position.z, node.remainingBlocks, cost, toBreak, undefined, undefined, positionsOccupied, node.allBroken, node.allPlaced, node.actionChain, node.mutatedBlockStateMap, node.costToCome, node.priorPosHashes, node.mutations))
    } else if (this.getBlock(node.x + dir.x, node.y - 2, node.z + dir.z).physical || blockD.liquid) {
      // Case move down one block
      if (blockC.liquid) return // dont go underwater
      cost += this.safeOrBreak(blockD, toBreak, node)
      if (cost > 100) return
      // positionsOccupied.push(blockD.position)
      neighbors.push(new Move(blockC.position.x, blockC.position.y - 1, blockC.position.z, node.remainingBlocks, cost, toBreak, undefined, undefined, positionsOccupied, node.allBroken, node.allPlaced, node.actionChain, node.mutatedBlockStateMap, node.costToCome, node.priorPosHashes, node.mutations))
    }
  }

  getLandingBlock(node, dir) {
    let positionsOccupied = [];
    let blockLand = this.getBlock(node.x + dir.x, node.y - 2, node.z + dir.z)
    // positionsOccupied.push(blockLand.position)
    while (blockLand.position && blockLand.position.y > 0) {
      // console.log({blockLand});
      if (blockLand.liquid && blockLand.safe) {
        return {block: blockLand, positions: positionsOccupied}
      }
      if (blockLand.physical) {
        if (node.y - blockLand.position.y <= this.maxDropDown) {
          // positionsOccupied = positionsOccupied.filter((pos) => !pos.equals(blockLand.position))
          const blockAboveLanding = this.getBlock(blockLand.position.x, blockLand.position.y + 1, blockLand.position.z)
          return {block: blockAboveLanding, positions: positionsOccupied}
        } else {
          // console.log('blockland too far down');
          return {block: null, positions: []}
        }
      }
      if (!blockLand.safe) {
        // console.log('blockland not safe');
        return {block: null, positions: []}
      } else {
        blockLand = this.getBlock(blockLand.position.x, blockLand.position.y - 1, blockLand.position.z)
        // positionsOccupied.push(blockLand.position)
      }
    }
    return {block: null, positions: []}
  }

  getMoveDropDown(node, dir, neighbors) {
    const blockB = this.getBlock(node.x + dir.x, node.y + 1, node.z + dir.z)
    const blockC = this.getBlock(node.x + dir.x, node.y, node.z + dir.z)
    const blockD = this.getBlock(node.x + dir.x, node.y - 1, node.z + dir.z)

    let cost = 1 // move cost
    const toBreak = []
    const toPlace = []
    const positionsOccupied = []

    const blockLandResult = this.getLandingBlock(node, dir)
    const blockLand = blockLandResult.block
    if (!blockLand) return
    // positionsOccupied.push(...blockLandResult.positions)

    // TODO: get the cost of moving through the blocks on the way to blockLand
    cost += this.safeOrBreak(blockB, toBreak, node)
    if (cost > 100) return
    // positionsOccupied.push(blockB.position)
    cost += this.safeOrBreak(blockC, toBreak, node)
    if (cost > 100) return
    // positionsOccupied.push(blockC.position)
    cost += this.safeOrBreak(blockD, toBreak, node)
    if (cost > 100) return
    // positionsOccupied.push(blockD.position)

    if (blockC.liquid) return // dont go underwater

    neighbors.push(new Move(blockLand.position.x, blockLand.position.y, blockLand.position.z, node.remainingBlocks - toPlace.length, cost, toBreak, toPlace, undefined, positionsOccupied, node.allBroken, node.allPlaced, node.actionChain, node.mutatedBlockStateMap, node.costToCome, node.priorPosHashes, node.mutations))
  }

  getMoveDown(node, neighbors) {
    const block0 = this.getBlock(node.x, node.y - 1, node.z)
    // console.log({block0});

    let cost = 1 // move cost
    const toBreak = []
    const toPlace = []
    const positionsOccupied = []

    const blockLandResult = this.getLandingBlock(node, {x: 0, z: 0})
    const blockLand = blockLandResult.block
    // console.log({blockLand});
    if (!blockLand) return
    // positionsOccupied.push(...blockLandResult.positions)

    // TODO: get the cost of moving through the blocks on the way to blockLand
    cost += this.safeOrBreak(block0, toBreak, node)
    if (cost > 100) return
    // positionsOccupied.push(block0.position)

    if (this.getBlock(node.x, node.y, node.z).liquid) return // dont go underwater

    neighbors.push(new Move(blockLand.position.x, blockLand.position.y, blockLand.position.z, node.remainingBlocks - toPlace.length, cost, toBreak, toPlace, undefined, positionsOccupied, node.allBroken, node.allPlaced, node.actionChain, node.mutatedBlockStateMap, node.costToCome, node.priorPosHashes, node.mutations))
  }

  getMoveUp(node, neighbors) {
    const block1 = this.getBlock(node.x, node.y, node.z)
    if (block1.liquid) return

    const block2 = this.getBlock(node.x, node.y + 2, node.z)
    let cost = 1 // move cost
    const toBreak = []
    const toPlace = []
    const positionsOccupied = []
    cost += this.safeOrBreak(block2, toBreak, node)
    if (cost > 100) return
    // positionsOccupied.push(block2.position)

    if (!block1.climbable) {
      if (!this.allow1by1towers || node.remainingBlocks === 0) return // not enough blocks to place

      if (!block1.replaceable) {
        if (!this.safeToBreak(block1, node)) return
        toBreak.push(block1.position)
      }

      const block0 = this.getBlock(node.x, node.y - 1, node.z)
      if (block0.physical && block0.height - node.y < -0.2) return // cannot jump-place from a half block

      toPlace.push({x: node.x, y: node.y - 1, z: node.z, dx: 0, dy: 1, dz: 0, jump: true})
      cost += this.placeCost // additional cost for placing a block
    }

    neighbors.push(new Move(node.x, node.y + 1, node.z, node.remainingBlocks - toPlace.length, cost, toBreak, toPlace, undefined, positionsOccupied, node.allBroken, node.allPlaced, node.actionChain, node.mutatedBlockStateMap, node.costToCome, node.priorPosHashes, node.mutations))
  }

  // Jump up, down or forward over a 1 block gap
  getMoveParkourForward(node, dir, neighbors) {
    const positionsOccupied = []
    const block0 = this.getBlock(node.x, node.y - 1, node.z)
    // TODO: do we check if block1 is safe?
    const block1 = this.getBlock(node.x + dir.x, node.y - 1, node.z + dir.z)
    const blockFeetA = this.getBlock(node.x + dir.x, node.y, node.z + dir.z)
    const blockHeadA = this.getBlock(node.x + dir.x, node.y + 1, node.z + dir.z)
    // TODO: why don't we jump over if the height is the same?
    if ((block1.physical && block1.height >= block0.height) ||
      !blockFeetA.safe ||
      !blockHeadA.safe) return
    // positionsOccupied.push(blockHeadA.position)
    // positionsOccupied.push(blockFeetA.position)

    if (this.getBlock(node.x, node.y, node.z).liquid) return // cant jump from water

    // If we have a block on the ceiling, we cannot jump but we can still fall
    const ceilingBlockA = this.getBlock(node.x, node.y + 2, node.z)
    const ceilingBlockB = this.getBlock(node.x + dir.x, node.y + 2, node.z + dir.z)
    let ceilingPositions = [ceilingBlockA.position, ceilingBlockB.position]
    let ceilingClear = ceilingBlockA.safe && ceilingBlockB.safe

    // Similarly for the down path
    const floorBlock = this.getBlock(node.x + dir.x, node.y - 2, node.z + dir.z)
    const floorPositions = [floorBlock.position]
    let floorCleared = floorBlock.safe

    const maxD = this.allowSprinting ? 4 : 2

    for (let d = 2; d <= maxD; d++) {
      const dx = dir.x * d
      const dz = dir.z * d
      const blockA = this.getBlock(node.x + dx, node.y + 2, node.z + dz)
      const blockB = this.getBlock(node.x + dx, node.y + 1, node.z + dz)
      const blockC = this.getBlock(node.x + dx, node.y, node.z + dz)
      const blockD = this.getBlock(node.x + dx, node.y - 1, node.z + dz)

      if (ceilingClear && blockB.safe && blockC.safe && blockD.physical) {
        const positionsOccupiedForMove = [];
        // [...positionsOccupied, ...ceilingPositions, blockB.position, blockC.position]
        // Forward
        neighbors.push(new Move(blockC.position.x, blockC.position.y, blockC.position.z, node.remainingBlocks, 1, [], [], true, positionsOccupiedForMove, node.allBroken, node.allPlaced, node.actionChain, node.mutatedBlockStateMap, node.costToCome, node.priorPosHashes, node.mutations))
        break
      } else if (ceilingClear && blockB.safe && blockC.physical) {
        // Up
        if (blockA.safe) {
          if (blockC.height - block0.height > 1.2) break // Too high to jump
          const positionsOccupiedForMove = [];
          // [...positionsOccupied, ...ceilingPositions, blockB.position, blockA.position]
          neighbors.push(new Move(blockB.position.x, blockB.position.y, blockB.position.z, node.remainingBlocks, 1, [], [], true, positionsOccupiedForMove, node.allBroken, node.allPlaced, node.actionChain, node.mutatedBlockStateMap, node.costToCome, node.priorPosHashes, node.mutations))
          break
        }
      } else if ((ceilingClear || d === 2) && blockB.safe && blockC.safe && blockD.safe && floorCleared) {
        // Down
        const blockE = this.getBlock(node.x + dx, node.y - 2, node.z + dz)
        if (blockE.physical) {
          const positionsOccupiedForMove = [];
          //[...positionsOccupied, ...ceilingPositions, ...floorPositions, blockB.position, blockC.position, blockD.position]
          neighbors.push(new Move(blockD.position.x, blockD.position.y, blockD.position.z, node.remainingBlocks, 1, [], [], true, positionsOccupiedForMove, node.allBroken, node.allPlaced, node.actionChain, node.mutatedBlockStateMap, node.costToCome, node.priorPosHashes, node.mutations))
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
    const positionsOccupied = [];
    // [new Vec3(node.x, node.y, node.z), new Vec3(node.x, node.y, node.z).offset(0, 1, 0)]
    const blockBOrC = this.getBlock(node.x + dir.x, node.y + yOffset, node.z + dir.z)
    if (blockBOrC.physical) {
      return
    }
    const targetBlockPos = node.offset(0, yOffset, 0).plus(directionVector)
    cardinalDirectionVectors.some((direction) => {
      const inverseDirection = direction.scaled(-1)
      if (directionVector.equals(inverseDirection)) {
        return false
      }
      const refBlock = this.getBlock(targetBlockPos.x + direction.x, targetBlockPos.y + direction.y, targetBlockPos.z + direction.z)
      if (refBlock.physical) {
        const toPlace = [{x: refBlock.position.x, y: refBlock.position.y, z: refBlock.position.z, dx: inverseDirection.x, dy: inverseDirection.y, dz: inverseDirection.z}]
        const cost = this.placeCost * 5
        neighbors.push(new Move(node.x, node.y, node.z, node.remainingBlocks - toPlace.length, cost, undefined, toPlace, undefined, positionsOccupied, node.allBroken, node.allPlaced, node.actionChain, node.mutatedBlockStateMap, node.costToCome, node.priorPosHashes, node.mutations))
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
    for (const dir of cardinalDirections) {
      this.getMoveForward(node, dir, neighbors)
      this.getMoveJumpUp(node, dir, neighbors)
      this.getMoveDropDown(node, dir, neighbors)
      if (this.allowParkour) {
        this.getMoveParkourForward(node, dir, neighbors)
      }
      // this.getPlaceBlock(node, dir, 1, neighbors)
    }

    // Diagonals
    for (const dir of diagonalDirections) {
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

  *getRandomNeighborsGenerator(node) {
    const neighborSuppliers = [];

    neighborSuppliers.push((neighbors) => {
      this.getMoveDown(node, neighbors)
      // if (neighbors.length === 0) {
      //   console.log('down failed');
      // } else {
      //   console.log({'down created': neighbors});
      // }
    });
    neighborSuppliers.push((neighbors) => this.getMoveUp(node, neighbors));

    const cardinalDirectionsClone = cardinalDirections.slice();
    shuffle(cardinalDirectionsClone);
    // Simple moves in 4 cardinal points
    for (const dir of cardinalDirectionsClone) {
      neighborSuppliers.push((neighbors) => this.getMoveForward(node, dir, neighbors));
      neighborSuppliers.push((neighbors) => this.getMoveJumpUp(node, dir, neighbors));
      neighborSuppliers.push((neighbors) => this.getMoveDropDown(node, dir, neighbors));
      if (this.allowParkour) {
        neighborSuppliers.push((neighbors) => this.getMoveParkourForward(node, dir, neighbors));
      }
      // neighborSuppliers.push((neighbors) => this.getPlaceBlock(node, dir, 1, neighbors));
    }

    const diagonalDirectionsClone = diagonalDirections.slice();
    shuffle(diagonalDirectionsClone);
    // Diagonals
    for (const dir of diagonalDirectionsClone) {
      neighborSuppliers.push((neighbors) => this.getMoveDiagonal(node, dir, neighbors));
    }

    // neighbors.forEach((neighbor) => {
    //   neighbor.cost = neighbor.cost + (neighbor.cost * this.occupyCost(neighbor.positionsOccupied));
    // });

    shuffle(neighborSuppliers);

    while (neighborSuppliers.length > 0) {
      const neighborSupplier = neighborSuppliers.pop();
      const neighbors = [];
      neighborSupplier.call(this, neighbors);
      shuffle(neighbors);
      while (neighbors.length > 0) {
        yield neighbors.pop();
      }
    }
    return;
  }
}

module.exports = Movements
