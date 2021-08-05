const {Vec3} = require('vec3')

const cloneBreak = (breakElement) => {
  return breakElement.clone();
};
const clonePlace = (placeElement) => {
  return {
    x: placeElement.x,
    y: placeElement.y,
    z: placeElement.z,
    dx: placeElement.dx,
    dy: placeElement.dy,
    dz: placeElement.dz,
    jump: placeElement?.jump,
    returnPos: placeElement?.returnPos?.clone(),
  };
};
const cloneChain = (chainLink) => {
  return {
    break: chainLink.break.map(cloneBreak),
    place: chainLink.place.map(clonePlace),
  };
};
const toPlaceToString = (place) => `x:${place.x + place.dx},y:${place.y + place.dy},z:${place.z + place.dz}`;

class Move extends Vec3 {
  constructor(x, y, z, remainingBlocks, cost, toBreak = [], toPlace = [], parkour = false, positionsOccupied = [], haveBroken = [], havePlaced = [], actionChain = [], costToCome = 0, priorPosHashes) {
    super(Math.floor(x), Math.floor(y), Math.floor(z))

    this.remainingBlocks = remainingBlocks;
    this.costToCome = costToCome + cost;
    this.cost = cost;
    this.toBreak = [...toBreak];
    this.haveBroken = haveBroken.map(cloneBreak);
    this.allBroken = this.haveBroken.concat(this.toBreak);
    this.toPlace = [...toPlace];
    this.havePlaced = havePlaced.map(clonePlace);
    this.allPlaced = this.havePlaced.concat(this.toPlace);
    this.parkour = parkour;
    this.positionsOccupied = positionsOccupied;
    this.actionChain = [...actionChain].map(cloneChain);
    if (toBreak.length > 0 || toPlace.length > 0) {
      this.actionChain.push({break: this.toBreak, place: this.toPlace});
    }
    this.mutatedBlockStateMap = this.actionChain.reduce((map, chainLink) => {
      chainLink.break.forEach((breakPos) => {
        map.set(breakPos.toString(), 'air');
      });
      chainLink.place.map((place) => new Vec3(place.x + place.dx, place.y + place.dy, place.z + place.dz))
        .forEach((placePos) => {
          map.set(placePos.toString(), 'scaffold');
        });
      return map;
    }, new Map());
    // TODO: consider adding a way to identify how the move was created.

    const allPlacedPositions = this.allPlaced.map(toPlaceToString);

    this.worldHash = '{' + 'break:' + this.allBroken.toString() + 'place:' + allPlacedPositions.toString() + '}';
    this.posHash = this.x + ',' + this.y + ',' + this.z;
    this.hash = this.posHash;
    this.extnededHash = this.posHash + this.worldHash;
    this.priorPosHashes = new Set(priorPosHashes);
    this.priorPosHashes.add(this.posHash);
  }
}

module.exports = Move
