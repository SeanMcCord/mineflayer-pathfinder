const {performance} = require('perf_hooks')

const Heap = require('./heap.js')

class PathNode {
  constructor() {
    this.data = null
    this.g = 0
    this.h = 0
    this.f = 0
    this.parent = null
  }

  set(data, g, h, parent = null) {
    this.data = data
    this.g = g
    this.h = h
    this.f = g + h
    this.parent = parent
    return this
  }
}

function reconstructPath(node) {
  const path = []
  while (node.parent) {
    path.push(node.data)
    node = node.parent
  }
  return path.reverse()
}

class AStar {
  constructor(start, movements, goal, timeout, tickTimeout = 40, searchRadius = -1) {
    this.startTime = performance.now()

    this.movements = movements
    this.goal = goal
    this.timeout = timeout
    this.tickTimeout = tickTimeout

    this.closedNodeSet = new Set()
    this.openHeap = new Heap()
    this.openNodeMap = new Map()

    const startNode = new PathNode().set(start, 0, goal.heuristic(start))
    this.openHeap.push(startNode)
    this.openNodeMap.set(startNode.data.hash, startNode)
    this.bestNode = startNode

    this.maxCost = searchRadius < 0 ? -1 : startNode.h + searchRadius
  }

  makeResult(status, node) {
    return {
      status,
      cost: node.g,
      time: performance.now() - this.startTime,
      visitedNodes: this.closedNodeSet.size,
      generatedNodes: this.closedNodeSet.size + this.openHeap.size(),
      path: reconstructPath(node),
      finalHash: node.data.hash,
      context: this
    }
  }

  compute() {
    const computeStartTime = performance.now()
    while (!this.openHeap.isEmpty()) {
      if (performance.now() - computeStartTime > this.tickTimeout) { // compute time per tick
        return this.makeResult('partial', this.bestNode)
      }
      if (performance.now() - this.startTime > this.timeout) { // total compute time
        return this.makeResult('timeout', this.bestNode)
      }
      const node = this.openHeap.pop()
      if (this.goal.isEnd(node.data)) {
        return this.makeResult('success', node)
      }
      // not done yet
      this.openNodeMap.delete(node.data.hash)
      this.closedNodeSet.add(node.data.hash)

      const neighbors = this.movements.getNeighbors(node.data)
      for (const neighborData of neighbors) {
        if (this.closedNodeSet.has(neighborData.hash)) {
          continue // skip closed neighbors
        }
        const gFromThisNode = node.g + neighborData.cost
        let neighborNode = this.openNodeMap.get(neighborData.hash)
        let update = false

        const heuristic = this.goal.heuristic(neighborData)
        if (this.maxCost > 0 && gFromThisNode + heuristic > this.maxCost) continue

        if (neighborNode === undefined) {
          // add neighbor to the open set
          neighborNode = new PathNode()
          // properties will be set later
          this.openNodeMap.set(neighborData.hash, neighborNode)
        } else {
          if (neighborNode.g < gFromThisNode) {
            // skip this one because another route is faster
            continue
          }
          update = true
        }
        // found a new or better route.
        // update this neighbor with this node as its new parent
        neighborNode.set(neighborData, gFromThisNode, heuristic, node)
        if (neighborNode.h < this.bestNode.h) this.bestNode = neighborNode
        if (update) {
          this.openHeap.update(neighborNode)
        } else {
          this.openHeap.push(neighborNode)
        }
      }
    }
    // all the neighbors of every accessible node have been exhausted
    return this.makeResult('noPath', this.bestNode)
  }
}

module.exports = AStar
