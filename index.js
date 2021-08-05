const AStar = require('./lib/astar')
const Move = require('./lib/move')
const Movements = require('./lib/movements')
const gotoUtil = require('./lib/goto')

const {logger} = require('./lib/logger')

const nbt = require('prismarine-nbt')

function inject(bot) {
  const mcData = require('minecraft-data')(bot.version)
  let stateMovements = new Movements(bot, mcData)
  let stateGoal = null
  let astarContext = null
  let dynamicGoal = false
  // This is an array of moves.
  let path = []

  bot.pathfinder = {}

  bot.pathfinder.thinkTimeout = 5000 // ms
  bot.pathfinder.tickTimeout = 40 // ms, amount of thinking per tick (max 50 ms)
  bot.pathfinder.searchRadius = -1 // in blocks, limits of the search area, -1: don't limit the search

  bot.pathfinder.goal = () => stateGoal;
  bot.pathfinder.goal = () => stateMovements;

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
    logger.info({pathfinder: {event: 'get path to end'}})
    return result
  }

  function resetPath(reason, clearStates = true) {
    if (path.length > 0) bot.emit('path_reset', reason)
    // logger.info({pathfinder: {event: {digBlock: bot.targetDigBlock}}});
    path = []
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
  bot.pathfinder.isMining = () => {throw new Error('isBuilding is not implemented')}
  bot.pathfinder.isBuilding = () => {throw new Error('isBuilding is not implemented')};

  bot.pathfinder.goto = (goal) => {
    return gotoUtil(bot, goal)
  }

  // The other goto is callbackifyed
  bot.pathfinder.asyncGoto = (goal) => {
    return gotoUtil(bot, goal)
  }

  bot.pathfinder.goto = callbackify(bot.pathfinder.goto, 1)
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
  Move: require('./lib/move'),
  goals: require('./lib/goals')
}
