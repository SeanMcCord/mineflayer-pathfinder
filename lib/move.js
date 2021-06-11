const {Vec3} = require('vec3')

class Move extends Vec3 {
  constructor(x, y, z, remainingBlocks, cost, toBreak = [], toPlace = [], parkour = false, positionsOccupied = [], haveBroken = [], havePlaced = [], actionChain = []) {
    super(Math.floor(x), Math.floor(y), Math.floor(z))
    this.remainingBlocks = remainingBlocks
    this.cost = cost
    this.toBreak = [...toBreak]
    this.haveBroken = haveBroken
    this.allBroken = haveBroken.concat(toBreak)
    this.toPlace = [...toPlace]
    this.havePlaced = havePlaced
    this.allPlaced = havePlaced.concat(toPlace)
    this.parkour = parkour
    this.positionsOccupied = positionsOccupied;
    this.actionChain = [...actionChain]
    if (toBreak.length > 0 || toPlace.length > 0) {
      this.actionChain.push({break: this.toBreak, place: this.toPlace})
    }
    this.mutatedBlockStateMap = this.actionChain.reduce((map, chainLink) => {
      chainLink.break.forEach((breakPos) => {
        map.set(breakPos.toString(), 'air')
      })
      chainLink.place.map((place) => new Vec3(place.x, place.y, place.z))
        .forEach((placePos) => {
          map.set(placePos.toString(), 'scaffold')
        })
      return map
    }, new Map())
    // TODO: consider adding a way to identify how the move was created.

    const toPlaceToString = (toPlace) => `x:${toPlace.x},y:${toPlace.y},z:${toPlace.z}`
    const allPlacedPositions = this.allPlaced.map(toPlaceToString)

    this.hash = this.x + ',' + this.y + ',' + this.z + '{' + 'break:' + this.allBroken.toString() + 'place:' + allPlacedPositions.toString() + '}'
  }
}

module.exports = Move
