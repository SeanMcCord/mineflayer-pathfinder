const {Vec3} = require('vec3')
const Mutation = require('./mutation');

class Move extends Vec3 {
  constructor(x, y, z, remainingBlocks, cost, toBreak = [], toPlace = [], parkour = false, positionsOccupied = [], haveBroken = [], havePlaced = [], actionChain = [], mutatedBlockStateMap, costToCome = 0, priorPosHashes, mutations) {
    super(Math.floor(x), Math.floor(y), Math.floor(z))

    this.remainingBlocks = remainingBlocks;
    this.costToCome = costToCome + cost;
    this.cost = cost;
    this.toBreak = [...toBreak];
    // this.haveBroken = haveBroken.map(cloneBreak);
    this.haveBroken = [];
    // this.allBroken = this.haveBroken.concat(this.toBreak);
    this.allBroken = [];
    this.toPlace = [...toPlace];
    // this.havePlaced = havePlaced.map(clonePlace);
    this.havePlaced = [];
    // this.allPlaced = this.havePlaced.concat(this.toPlace);
    this.allPlaced = [];
    this.parkour = parkour;
    this.positionsOccupied = positionsOccupied;
    // this.actionChain = [...actionChain].map(cloneChain);
    this.actionChain = [];
    // this.mutatedBlockStateMap = new Map(mutatedBlockStateMap);
    this.mutatedBlockStateMap = new Map();
    this.mutations = mutations == null ? new Mutation() : mutations.clone();
    // this.mutations = new Mutation(undefined, mutations);
    if (this.toBreak.length > 0) {
      for (let i = 0; i < this.toBreak.length; i++) {
        this.mutations.setPos(this.toBreak[i], 0);
      }
    }
    if (this.toPlace.length > 0) {
      for (let i = 0; i < this.toPlace.length; i++) {
        this.mutations.setPos(
          {
            x: this.toPlace[i].x + this.toPlace[i].dx,
            y: this.toPlace[i].y + this.toPlace[i].dy,
            z: this.toPlace[i].z + this.toPlace[i].dz
          },
          12,
        );
      }
    }
    // if (toBreak.length > 0 || toPlace.length > 0) {
    //   const newLink = {break: this.toBreak, place: this.toPlace}
    //   this.actionChain.push(newLink);
    //   applyLink(this.mutatedBlockStateMap, newLink);
    // }
    // TODO: consider adding a way to identify how the move was created.

    // const allPlacedPositions = this.allPlaced.map(toPlaceToString);

    // this.worldHash = '{' + 'break:' + this.allBroken.toString() + 'place:' + allPlacedPositions.toString() + '}';
    this.worldHash = '';
    this.posHash = this.x + ',' + this.y + ',' + this.z;
    this.hash = this.posHash;
    this.extnededHash = this.posHash;
    //  + this.worldHash;
    // this.priorPosHashes = new Set(priorPosHashes);
    this.priorPosHashes = new Set();
    // this.priorPosHashes.add(this.posHash);
  }
}
// const cloneBreak = (breakElement) => {
//   return breakElement.clone();
// };
// const clonePlace = (placeElement) => {
//   return {
//     x: placeElement.x,
//     y: placeElement.y,
//     z: placeElement.z,
//     dx: placeElement.dx,
//     dy: placeElement.dy,
//     dz: placeElement.dz,
//     jump: placeElement?.jump,
//     returnPos: placeElement?.returnPos?.clone(),
//   };
// };
// const toPlaceToString = (place) => `x:${place.x + place.dx},y:${place.y + place.dy},z:${place.z + place.dz}`;
// 
// const cloneChain = (chainLink) => {
//   return {
//     break: chainLink.break.map(cloneBreak),
//     place: chainLink.place.map(clonePlace),
//   };
// };
// const applyLink = (stateMap, chainLink) => {
//   chainLink.break.forEach((breakPos) => {
//     stateMap.set(breakPos.toString(), 'air');
//   });
//   chainLink.place.map((place) => new Vec3(place.x + place.dx, place.y + place.dy, place.z + place.dz))
//     .forEach((placePos) => {
//       stateMap.set(placePos.toString(), 'scaffold');
//     });
// }

module.exports = Move
