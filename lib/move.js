const {Vec3} = require('vec3')

class Move extends Vec3 {
  constructor(x, y, z, remainingBlocks, cost, toBreak = [], toPlace = [], parkour = false, positionsOccupied = [], haveBroken = [], havePlaced = [], actionChain = []) {
    super(Math.floor(x), Math.floor(y), Math.floor(z))
    const cloneBreak = (breakElement) => {
      return breakElement.clone();
    };
    const clonePlace = (placeElement) => {
      const temp = {
        x: placeElement.x,
        y: placeElement.y,
        z: placeElement.z,
        dx: placeElement.dx,
        dy: placeElement.dy,
        dz: placeElement.dz,
      };
      if (placeElement.jump != null) {
        temp.jump = placeElement.jump;
      }
      if (placeElement.returnPos != null) {
        temp.returnPos = placeElement.returnPos.clone();
      }
      return temp;
    };
    const cloneChain = (chainLink) => {
      return {
        break: chainLink.break.map(cloneBreak),
        place: chainLink.place.map(clonePlace),
      };
    };

    this.remainingBlocks = remainingBlocks;
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

    const toPlaceToString = (toPlace) => `x:${toPlace.x + toPlace.dx},y:${toPlace.y + toPlace.dy},z:${toPlace.z + toPlace.dz}`;
    const allPlacedPositions = this.allPlaced.map(toPlaceToString);

    this.hash = this.x + ',' + this.y + ',' + this.z + '{' + 'break:' + this.allBroken.toString() + 'place:' + allPlacedPositions.toString() + '}';
  }
}

module.exports = Move
