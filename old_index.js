const {performance} = require('perf_hooks')

const AStar = require('./lib/astar')
const Move = require('./lib/move')
const Movements = require('./lib/movements')
const gotoUtil = require('./lib/goto')

const {logger} = require('./lib/logger')

const Vec3 = require('vec3').Vec3

const Physics = require('./lib/physics')
const nbt = require('prismarine-nbt')

function inject(bot) {
  const mcData = require('minecraft-data')(bot.version)
  const waterType = mcData.blocksByName.water.id
  const ladderId = mcData.blocksByName.ladder.id
  const vineId = mcData.blocksByName.vine.id
  let stateMovements = new Movements(bot, mcData)
  let stateGoal = null
  let astarContext = null
  let astartTimedout = false
  let dynamicGoal = false
  let expectedUpdatePositions = new Set()
  // This is an array of moves.
  let path = []
  let pathUpdated = false
  // TODO: pull apart the roles of digging and diggingOperationOngoing.
  // On one hand we need to know what the bot should be doing. On the other we need to handle the bot digging state.
  let digging = false
  let diggingOperationOngoing = false
  let diggingAbortedListenerCount = 0
  let diggingCompletedListenerCount = []
  let placing = false
  let placingBlock = null
  let digErrorCount = 0
  let zeroLengthPathCount = 0
  let lastMoveTime = performance.now()
  let completeMoveTime = performance.now()
  let returningPos = null
  const physics = new Physics(bot)
  const minimumThinkTime = 100;

  bot.pathfinder = {}

  bot.pathfinder.showState = () => {
    return {
      stateGoal,
      astarContext,
      astartTimedout,
      dynamicGoal,
      expectedUpdatePositions,
      path,
      pathUpdated,
      digging,
      placing,
      placingBlock,
      returningPos
    }
  }

  bot.pathfinder.thinkTimeout = 5000 // ms
  bot.pathfinder.tickTimeout = 40 // ms, amount of thinking per tick (max 50 ms)
  bot.pathfinder.searchRadius = -1 // in blocks, limits of the search area, -1: don't limit the search
  bot.pathfinder.enablePathShortcut = false // disabled by default as it can cause bugs in specific configurations
  // TODO: what the heck does LOS mean? LeanOverSide?
  bot.pathfinder.LOSWhenPlacingBlocks = true

  bot.pathfinder.bestHarvestTool = (block) => {
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

  // TODO: can this be done without ditching the previous astar context?
  // Need to think of how to handle performance impact
  bot.pathfinder.getPathTo = (movements, goal, timeout) => {
    logger.info({pathfinder: {event: 'get path to start'}})
    const p = bot.entity.position
    const dy = p.y - Math.floor(p.y)
    const b = bot.blockAt(p)
    const start = new Move(p.x, p.y + (b && dy > 0.001 && bot.entity.onGround && b.type !== 0 ? 1 : 0), p.z, movements.countScaffoldingItems(), 0)
    astarContext = new AStar(start, movements, goal, timeout || bot.pathfinder.thinkTimeout, bot.pathfinder.tickTimeout, bot.pathfinder.searchRadius)
    const result = astarContext.compute()
    result.path = postProcessPath(result.path)
    logger.info({pathfinder: {event: 'get path to end'}})
    return result
  }

  Object.defineProperties(bot.pathfinder, {
    goal: {
      get() {
        return stateGoal
      }
    },
    movements: {
      get() {
        return stateMovements
      }
    }
  })

  function moveComplete(move) {
    const time = performance.now() - completeMoveTime
    completeMoveTime = performance.now()
    bot.emit('path_move_complete', move, time)
  }

  function detectDiggingStopped() {
    // digging = false
    logger.info({pathfinder: {event: {diggingMustStop: {digging, digErrorCount}, digBlock: bot.targetDigBlock}}});
    // TODO: remove the usage of removeAllListeners
    bot.removeListener('diggingAborted', detectDiggingStopped)
    diggingAbortedListenerCount -= 1;
    bot.removeListener('diggingCompleted', detectDiggingStopped)
    diggingCompletedListenerCount -= 1;
    logger.info({pathfinder: {event: {diggingAbortedListenerCount, diggingCompletedListenerCount}}});
  }
  function resetPath(reason, clearStates = true) {
    if (path.length > 0) bot.emit('path_reset', reason)
    // logger.info({pathfinder: {event: {digBlock: bot.targetDigBlock}}});
    path = []
    // TODO: expose when the bot can't find a path to a given location.
    zeroLengthPathCount = 0
    expectedUpdatePositions.clear()
    if (digging) {
      logger.info({pathfinder: {event: {digErrorCount}}});
      bot.on('diggingAborted', detectDiggingStopped)
      diggingAbortedListenerCount += 1;
      bot.on('diggingCompleted', detectDiggingStopped)
      diggingCompletedListenerCount += 1;
      logger.info({pathfinder: {event: {resetPath: 'stopDigging called'}}})
      bot.stopDigging()
      if (bot.targetDigBlock == null) {
        detectDiggingStopped()
      } else {
        logger.info({pathfinder: {event: {resetPath: {digBlock: bot.targetDigBlock}}}})
      }
    }
    placing = false
    pathUpdated = false
    astarContext = null
    if (clearStates) bot.clearControlStates()
  }

  bot.pathfinder.setGoal = (goal, dynamic = false) => {
    stateGoal = goal
    dynamicGoal = dynamic
    bot.emit('goal_updated', goal, dynamic)
    resetPath('goal_updated')
  }

  bot.pathfinder.setMovements = (movements) => {
    stateMovements = movements
    resetPath('movements_updated')
  }

  bot.pathfinder.isMoving = () => path.length > 0
  bot.pathfinder.isMining = () => digging
  bot.pathfinder.isBuilding = () => placing

  bot.pathfinder.goto = (goal) => {
    return gotoUtil(bot, goal)
  }

  // The other goto is callbackifyed
  bot.pathfinder.asyncGoto = (goal) => {
    return gotoUtil(bot, goal)
  }

  bot.pathfinder.goto = callbackify(bot.pathfinder.goto, 1)

  let tickCount = 0;
  const responseTime = () => {
    const tick = (tickCount += 1);
    const startTime = performance.now();
    monitorMovement(tick);
    // logger.info({pathfinder: {event: {tick, time: performance.now() - startTime}}});
  }

  bot.on('physicTick', responseTime)

  // TODO: Maybe unifiy what it means for a move to not be allowed to be removed from a path.
  function postProcessPath(path) {
    for (let i = 0; i < path.length; i++) {
      const curPoint = path[i]
      if (curPoint.toBreak.length > 0 || curPoint.toPlace.length > 0) break
      const b = bot.blockAt(new Vec3(curPoint.x, curPoint.y, curPoint.z))
      if (b && (b.type === waterType || ((b.type === ladderId || b.type === vineId) && i + 1 < path.length && path[i + 1].y < curPoint.y))) {
        curPoint.x = Math.floor(curPoint.x) + 0.5
        curPoint.y = Math.floor(curPoint.y)
        curPoint.z = Math.floor(curPoint.z) + 0.5
        continue
      }
      let np = getPositionOnTopOf(b)
      if (np === null) np = getPositionOnTopOf(bot.blockAt(new Vec3(curPoint.x, curPoint.y - 1, curPoint.z)))
      if (np) {
        curPoint.x = np.x
        curPoint.y = np.y
        curPoint.z = np.z
      } else {
        curPoint.x = Math.floor(curPoint.x) + 0.5
        curPoint.y = curPoint.y - 1
        curPoint.z = Math.floor(curPoint.z) + 0.5
      }
    }

    if (!bot.pathfinder.enablePathShortcut || path.length === 0) return path

    const newPath = []
    let lastMove = bot.entity.position
    for (let i = 1; i < path.length; i++) {
      const move = path[i]
      if (Math.abs(move.y - lastMove.y) > 0.5 || move.toBreak.length > 0 || move.toPlace.length > 0 || !physics.canStraightLineBetween(lastMove, move)) {
        newPath.push(path[i - 1])
        lastMove = path[i - 1]
      }
    }
    newPath.push(path[path.length - 1])
    return newPath
  }

  // Removes moves prior to closest move to player.
  // Does some checks for if blocks needed to be placed or broken.
  // Ensures that moves adding or removing blocks are not pruned
  function pathFromPlayer(path) {
    if (path.length === 0) return
    let minI = 0
    let minDistance = 1000
    for (let i = 0; i < path.length; i++) {
      const move = path[i]
      if (move.toBreak.length !== 0 || move.toPlace.length !== 0) break
      const dist = bot.entity.position.distanceSquared(move)
      if (dist < minDistance) {
        minDistance = dist
        minI = i
      }
    }
    // check if we are between 2 moves
    const n1 = path[minI]
    // check if move already reached
    const dx = n1.x - bot.entity.position.x
    const dy = n1.y - bot.entity.position.y
    const dz = n1.z - bot.entity.position.z
    // TODO: unifi what it means to have reached a move maybe
    const reached = Math.abs(dx) <= 0.35 && Math.abs(dz) <= 0.35 && Math.abs(dy) < 1
    if (minI + 1 < path.length && n1.toBreak.length === 0 && n1.toPlace.length === 0) {
      const n2 = path[minI + 1]
      const d2 = bot.entity.position.distanceSquared(n2)
      const d12 = n1.distanceSquared(n2)
      minI += d12 > d2 || reached ? 1 : 0
    }

    path.splice(0, minI)
  }

  function isPositionNearPath(pos, path) {
    for (const move of path) {
      const dx = Math.abs(move.x - pos.x - 0.5)
      const dy = Math.abs(move.y - pos.y - 0.5)
      const dz = Math.abs(move.z - pos.z - 0.5)
      if (dx <= 1 && dy <= 2 && dz <= 1) return true
    }
    return false
  }

  // Return the average x/z position of the highest standing positions
  // in the block.
  function getPositionOnTopOf(block) {
    if (!block || block.shapes.length === 0) return null
    const p = new Vec3(0.5, 0, 0.5)
    let n = 1
    for (const shape of block.shapes) {
      const h = shape[4]
      if (h === p.y) {
        p.x += (shape[0] + shape[3]) / 2
        p.z += (shape[2] + shape[5]) / 2
        n++
      } else if (h > p.y) {
        n = 2
        p.x = 0.5 + (shape[0] + shape[3]) / 2
        p.y = h
        p.z = 0.5 + (shape[2] + shape[5]) / 2
      }
    }
    p.x /= n
    p.z /= n
    return block.position.plus(p)
  }

  function fullStop() {
    bot.clearControlStates()

    // Force horizontal velocity to 0 (otherwise inertia can move us too far)
    // Kind of cheaty, but the server will not tell the difference
    bot.entity.velocity.x = 0
    bot.entity.velocity.z = 0

    const blockX = Math.floor(bot.entity.position.x) + 0.5
    const blockZ = Math.floor(bot.entity.position.z) + 0.5

    // Make sure our bounding box don't collide with neighboring blocks
    // otherwise recenter the position
    if (Math.abs(bot.entity.position.x - blockX) > 0.2) {
      // logger.info({pathfinder: {event: {cheatyBlockRecenter: {blockX}}}});
      bot.entity.position.x = blockX
    }
    if (Math.abs(bot.entity.position.z - blockZ) > 0.2) {
      // logger.info({pathfinder: {event: {cheatyBlockRecenter: {blockZ}}}});
      bot.entity.position.z = blockZ
    }
  }

  function moveToEdge(refBlockPos, edge) {
    // If allowed turn instantly should maybe be a bot option
    const allowInstantTurn = false
    function getViewVector(pitch, yaw) {
      const csPitch = Math.cos(pitch)
      const snPitch = Math.sin(pitch)
      const csYaw = Math.cos(yaw)
      const snYaw = Math.sin(yaw)
      return new Vec3(-snYaw * csPitch, snPitch, -csYaw * csPitch)
    }
    // Target viewing direction while approaching edge
    // The Bot approaches the edge while looking in the opposite direction from where it needs to go
    // The target Pitch angle is roughly the angle the bot has to look down for when it is in the position
    // to place the next block
    const targetBlockPos = refBlockPos.offset(edge.x + 0.5, edge.y, edge.z + 0.5)
    const targetPosDelta = bot.entity.position.clone().subtract(targetBlockPos)
    const targetYaw = Math.atan2(-targetPosDelta.x, -targetPosDelta.z)
    const targetPitch = -1.421
    const viewVector = getViewVector(targetPitch, targetYaw)
    // While the bot is not in the right position rotate the view and press back while crouching
    if (bot.entity.position.distanceTo(refBlockPos.clone().offset(edge.x + 0.5, 1, edge.z + 0.5)) > 0.4) {
      bot.lookAt(bot.entity.position.offset(viewVector.x, viewVector.y, viewVector.z), allowInstantTurn)
      bot.setControlState('sneak', true)
      bot.setControlState('back', true)
      return false
    }
    bot.setControlState('back', false)
    return true
  }

  // Returns true if the player is near the given position
  function moveToBlock(pos) {
    // minDistanceSq = Min distance sqrt to the target pos were the bot is centered enough to place blocks around him
    const minDistanceSq = 0.2 * 0.2
    const targetPos = pos.clone().offset(0.5, 0, 0.5)
    if (bot.entity.position.distanceSquared(targetPos) > minDistanceSq) {
      bot.lookAt(targetPos)
      bot.setControlState('forward', true)
      return false
    }
    bot.setControlState('forward', false)
    return true
  }

  bot.on('blockUpdate', (oldBlock, newBlock) => {
    if (isPositionNearPath(oldBlock.position, path) && oldBlock.type !== newBlock.type) {
      if (expectedUpdatePositions.has(oldBlock.position.toString())) {
        expectedUpdatePositions.delete(oldBlock.position.toString())
        logger.info({pathfinder: {event: `ignoreing block update ${oldBlock.position}`}});
        return
      }
      // ignore expected updates.
      resetPath('block_updated', false)
    }
  })

  bot.on('chunkColumnLoad', (chunk) => {
    resetPath('chunk_loaded', false)
  })

  function monitorMovement(tick) {
    logger.info({pathfinder: {tick, event: {pathLength: path.length, move: path[0]}}});
    // Handle trigging path regeneration on goal hasChanged
    if (stateGoal && stateGoal.hasChanged()) {
      // HACK: seems fine with this clearing state
      resetPath('goal_moved')
    }

    // Handle compute extention if timed out
    if (astarContext && astartTimedout) {
      const results = astarContext.compute()
      results.path = postProcessPath(results.path)
      pathFromPlayer(results.path)
      bot.emit('path_update', results)
      path = results.path
      astartTimedout = results.status === 'partial'
    }

    // Handle return to center if returnPos
    if (bot.pathfinder.LOSWhenPlacingBlocks && returningPos) {
      // logger.info({pathfinder: {event: {returningToPos: returningPos}}});
      if (!moveToBlock(returningPos)) {
        logger.info({pathfinder: {tick, event: 'pathfinder|monitorMovement moving to edge of block'}});
        return
      }
      returningPos = null
    }

    // Handle goal reached and path generation when reset
    if (path.length === 0) {
      lastMoveTime = performance.now()
      if (stateGoal && stateMovements) {
        if (stateGoal.isEnd(bot.entity.position.floored())) {
          if (!dynamicGoal) {
            bot.emit('goal_reached', stateGoal)
            stateGoal = null
            fullStop()
          }
        } else if (!pathUpdated) {
          const results = bot.pathfinder.getPathTo(stateMovements, stateGoal)
          bot.emit('path_update', results)
          path = results.path
          astartTimedout = results.status === 'partial'
          pathUpdated = true
        }
      }
    }

    // Handle path has nothing to execute
    if (path.length === 0) {
      zeroLengthPathCount += 1;
      logger.info({pathfinder: {tick, event: {message: 'pathfinder|monitorMovement path length 0', zeroLengthPathCount}}});
      // HACK
      // number is just a guess for what would work well
      if (zeroLengthPathCount > 150) {
        resetPath('stuck')
      }
      return
    }

    let nextPoint = path[0]
    const p = bot.entity.position

    // Handle digging
    if (digging || nextPoint.toBreak.length > 0) {
      if (!digging && bot.entity.onGround) {
        digging = true
        const b = nextPoint.toBreak.shift()
        // logger.info({pathfinder: {event: {timeToDig: {digging, b}}}});
        const blockPosition = new Vec3(b.x, b.y, b.z)
        logger.info({pathfinder: {tick, event: {toBreak: blockPosition, targetDigBlock: bot.targetDigBlock}}});
        expectedUpdatePositions.add(blockPosition.toString())
        const block = bot.blockAt(blockPosition, false)
        const tool = bot.pathfinder.bestHarvestTool(block)
        fullStop()
        bot.equip(tool, 'hand', function () {
          logger.info({pathfinder: {tick, event: 'equip done dig to begin', blockPosition, targetDigBlock: bot.targetDigBlock}});
          bot.dig(block, function (err) {
            lastMoveTime = performance.now()
            // TODO: Idea: Give each path an id. Only reset the path if the id this action came from is the same as the current path id.
            if (err) {
              digErrorCount += 1;
              logger.info({pathfinder: {tick, event: {diggingError: err, blockPosition, digErrorCount, targetDigBlock: bot.targetDigBlock}}});
              resetPath('dig_error')
            }
            if (bot.targetDigBlock == null) {
              digging = false
            }
          })
        })
      }
      logger.info({pathfinder: {tick, event: 'pathfinder|monitorMovement digging'}});
      return
    }
    // Handle block placement
    // TODO: sneak when placing or make sure the block is not interactive
    if (placing || nextPoint.toPlace.length > 0) {
      if (!placing) {
        placing = true
        // logger.info({pathfinder: {event: {nextPoint}}});
        placingBlock = nextPoint.toPlace.shift()
        const placingBlockPosition = new Vec3(placingBlock.x, placingBlock.y, placingBlock.z)
        expectedUpdatePositions.add(placingBlockPosition.toString())
        fullStop()
      }
      const block = stateMovements.getScaffoldingItem()
      if (!block) {
        resetPath('no_scaffolding_blocks')
        logger.info({pathfinder: {tick, event: 'pathfinder|monitorMovement no scaffolding blocks to place'}});
        return
      }
      // Lean over side of block and place block
      if (bot.pathfinder.LOSWhenPlacingBlocks && placingBlock.y === bot.entity.position.floored().y - 1 && placingBlock.dy === 0) {
        if (!moveToEdge(new Vec3(placingBlock.x, placingBlock.y, placingBlock.z), new Vec3(placingBlock.dx, 0, placingBlock.dz))) {
          logger.info({pathfinder: {tick, event: 'pathfinder|monitorMovement begin move to edge'}});
          return
        }
      }
      let canPlace = true
      if (placingBlock.jump) {
        bot.setControlState('jump', true)
        canPlace = placingBlock.y + 1 < bot.entity.position.y
      }
      if (canPlace) {
        bot.equip(block, 'hand', function () {
          const refBlock = bot.blockAt(new Vec3(placingBlock.x, placingBlock.y, placingBlock.z), false)
          bot.placeBlock(refBlock, new Vec3(placingBlock.dx, placingBlock.dy, placingBlock.dz), function (err) {
            placing = false
            lastMoveTime = performance.now()
            if (err) {
              resetPath('place_error')
            } else {
              // Dont release Sneak if the block placement was not successful
              bot.setControlState('sneak', false)
              if (bot.pathfinder.LOSWhenPlacingBlocks && placingBlock.returnPos) returningPos = placingBlock.returnPos.clone()
            }
          })
        })
      }
      logger.info({pathfinder: {tick, event: 'pathfinder|monitorMovement placing block'}});
      return
    }

    // Handle bot reached move position. 
    let dx = nextPoint.x - p.x
    const dy = nextPoint.y - p.y
    let dz = nextPoint.z - p.z
    if (Math.abs(dx) <= 0.35 && Math.abs(dz) <= 0.35 && Math.abs(dy) < 1) {
      // arrived at next point
      lastMoveTime = performance.now()
      move = path.shift()
      moveComplete(move)
      // TODO: maybe logic unifiy for what it means to reach the end goal.
      if (path.length === 0) { // done
        if (!dynamicGoal && stateGoal && stateGoal.isEnd(p.floored())) {
          bot.emit('goal_reached', stateGoal)
          stateGoal = null
        } else {
          // block just for debug
          logger.info({pathfinder: {tick, event: {stateGoal, position: p.floored(), isEnd: stateGoal.isEnd(p.floored()), pos: bot.entity.position}}});
        }
        fullStop()
        logger.info({pathfinder: {tick, event: 'pathfinder|monitorMovement near move position and path length is 0'}});
        return
      }
      // not done yet
      nextPoint = path[0]
      // logger.info({pathfinder: {event: {toBreak: nextPoint.toBreak, toPlace: nextPoint.toPlace}}});
      if (nextPoint.toBreak.length > 0 || nextPoint.toPlace.length > 0) {
        fullStop()
        logger.info({pathfinder: {tick, event: 'pathfinder|monitorMovement near move position and either blocks left to break or place'}});
        return
      }
      dx = nextPoint.x - p.x
      dz = nextPoint.z - p.z
    }

    bot.look(Math.atan2(-dx, -dz), 0)
    bot.setControlState('forward', true)
    bot.setControlState('jump', false)

    if (bot.entity.isInWater) {
      bot.setControlState('jump', true)
      bot.setControlState('sprint', false)
    } else if (stateMovements.allowSprinting && physics.canStraightLine(path, true)) {
      bot.setControlState('jump', false)
      bot.setControlState('sprint', true)
    } else if (stateMovements.allowSprinting && physics.canSprintJump(path)) {
      bot.setControlState('jump', true)
      bot.setControlState('sprint', true)
    } else if (physics.canStraightLine(path)) {
      bot.setControlState('jump', false)
      bot.setControlState('sprint', false)
    } else if (physics.canWalkJump(path)) {
      bot.setControlState('jump', true)
      bot.setControlState('sprint', false)
    } else {
      bot.setControlState('forward', false)
      bot.setControlState('sprint', false)
    }

    // check for futility
    if (performance.now() - lastMoveTime > 1500) {
      // should never take this long to go to the next move
      resetPath('stuck')
    }
    logger.info({pathfinder: {tick, event: 'pathfinder|monitorMovement end of function'}});
  }
}

function callbackify(f) {
  return function (...args) {
    const cb = args[f.length]
    return f(...args).then(r => {if (cb) {cb(null, r)} return r}, err => {if (cb) {cb(err)} else throw err})
  }
}

module.exports = {
  pathfinder: inject,
  Movements: require('./lib/movements'),
  goals: require('./lib/goals')
}
