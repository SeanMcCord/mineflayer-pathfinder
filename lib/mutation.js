const minY = 0;
const worldHeight = 256;
const numSections = worldHeight >> 4;
const sectionVolume = 16 * 16 * 16;

// Based on full world position
const getColumnKey = (pos) => {
  return Math.floor(pos.x / 16) + ',' + Math.floor(pos.z / 16);
};
// Based on full world position
const getSectionKey = (pos) => {
  return (pos.y - minY) >> 4;
};
// Based on position in section
const getSectionPosition = (pos) => {
  return (((pos.y - minY) & 15) << 8) | ((pos.z & 15) << 4) | (pos.x & 15);
}

class Mutation {
  constructor(columns = new Map(), previousMutation) {
    this.columns = columns;
    this.previousMutation = previousMutation;
    // this.history = previousMutation == null ? new Map() : previousMutation.cloneHistory();
    // this.history = new Map();
    this.locked = false;
    this.localCopy = new Map();
  }

  getColumns() {
    return this.columns;
  }

  setPos(pos, typeId) {
    // console.log({set: pos});
    if (this.locked) throw new Error('attempted to set position in locked mutation');
    const columnKey = getColumnKey(pos);
    const sectionKey = getSectionKey(pos);

    let localCopyColumn;
    if (this.localCopy.has(columnKey)) {
      localCopyColumn = this.localCopy.get(columnKey);
    } else {
      localCopyColumn = Array(numSections).fill(false);
      this.localCopy.set(columnKey, localCopyColumn);
    }

    let column;
    if (this.columns.has(columnKey)) {
      column = this.columns.get(columnKey);
    } else {
      column = Array(numSections);
      this.columns.set(columnKey, column);
    }
    if (column[sectionKey] == null) {
      const buffer = new ArrayBuffer(2 * sectionVolume);
      column[sectionKey] = new Int8Array(buffer).fill(-1);
      localCopyColumn[sectionKey] = true;
    } else if (!localCopyColumn[sectionKey]) {
      const temp = column[sectionKey].slice();
      column[sectionKey] = temp;
      localCopyColumn[sectionKey] = true;
    }
    // let historyColumn;
    // if (this.history.has(columnKey)) {
    //   historyColumn = this.history.get(columnKey);
    // } else {
    //   historyColumn = Array(numSections).fill(false);
    //   this.history.set(columnKey, historyColumn);
    // }
    // let section = column[getSectionKey(pos)];
    // if (section == null) {
    //   section = Array(sectionVolume);
    //   column[sectionKey] = section;
    // }
    // section[getSectionPosition(pos)] = typeId;
    const sectionPosition = getSectionPosition(pos);
    if (sectionPosition > column[sectionKey].length || sectionPosition < 0) {
      console.log({pos, sectionPosition, length: column[sectionKey].length});
    }
    column[sectionKey][sectionPosition] = typeId;
    // historyColumn[sectionKey] = true;
  }

  // mutatedHere(columnKey, sectionKey) {
  //   if (this.history.has(columnKey)) {
  //     return this.history.get(columnKey)[sectionKey];
  //   } else {
  //     return false;
  //   }
  // }

  getPos(pos) {
    const columnKey = getColumnKey(pos);
    const sectionKey = getSectionKey(pos);
    // if (!this.mutatedHere(columnKey, sectionKey)) {
    //   return null;
    // }
    const sectionPosition = getSectionPosition(pos);
    // if (this.columns.has(columnKey)) {
    // const result = this.getPosFast(columnKey, sectionKey, sectionPosition);
    return this.getPosFast(columnKey, sectionKey, sectionPosition);
    // if (result != null) return result;
    // }
    // return null;
    // return this.getParentPos(columnKey, sectionKey, sectionPosition);
  }

  getPosFast(columnKey, sectionKey, sectionPosition) {
    if (this.columns.has(columnKey)) {
      if (this.columns.get(columnKey)[sectionKey] == null) return null;
      const result = this.columns.get(columnKey)[sectionKey][sectionPosition];
      return result === -1 ? null : result;
    } else {
      return null;
    }
  }

  // getParentPos(columnKey, sectionKey, sectionPosition) {
  //   if (this.previousMutation == null) return null;
  //   // If the section was not mutated now or before then there is not point checking the parent.
  //   if (!this.previousMutation.mutatedHere(columnKey, sectionKey)) {
  //     return null;
  //   }
  //   const result = this.previousMutation.getPosFast(columnKey, sectionKey, sectionPosition);
  //   if (result == null) {
  //     return this.previousMutation.getParentPos(columnKey, sectionKey, sectionPosition);
  //   } else {
  //     return result;
  //   }
  // }

  // NOTE: to ensure copy on write does not result in incorrect data in child mutations 
  // this operation will lock the object for setPos calls.
  clone() {
    this.locked = true;
    const columnsCopy = new Map();
    for (const [columnKey, sections] of this.columns) {
      const sectionCopy = Array(sections.length);
      for (let i = 0; i < sections.length; i++) {
        if (sections[i] == null) {
          continue;
        }
        sectionCopy[i] = sections[i];
      }
      columnsCopy.set(columnKey, sectionCopy);
    }
    return new Mutation(columnsCopy, this);
  }

  // equals(other) {
  //   if (this.columns.size != other.getColumns.size) return false;
  //   for (const key of this.columns.keys()) {
  //     if (!other.getColumns.has(key)) return false;
  //   }
  //   // Other must now have the same column keys
  //   for (const [columnKey, sections] of this.columns) {
  //   }
  // }

  // cloneHistory() {
  //   const history = new Map();
  //   for (const [columnKey, sections] of this.history) {
  //     history.set(columnKey, sections.slice());
  //   }
  //   return history;
  // }
}

module.exports = Mutation;
