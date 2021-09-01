const minY = 0;
const worldHeight = 256;
const numSections = worldHeight >> 4;
const sectionVolume = 16 * 16 * 16;

// 0 -1  1 -2  2 -3  chunk index
// 0  1  2  3  4  5  array index
// Based on full world position
const getColumnKey = (number) => {
  if (number >= 0) {
    return 2 * Math.floor(number / 16);
  } else {
    return (-2 * Math.floor(number / 16)) - 1;
  }
};
// Based on full world position
const getSectionKey = (y) => {
  return (y - minY) >> 4;
};
// Based on position in section
const getSectionPosition = (x, y, z) => {
  return (((y - minY) & 15) << 8) | ((z & 15) << 4) | (x & 15);
}

class PositionCache {
  constructor(columns = [], provider) {
    this.columns = columns;
    this.provider = provider;
  }

  getColumns() {
    return this.columns;
  }

  setPos(x, y, z, object) {
    // console.log({set: pos});
    const columnKeyX = getColumnKey(x);
    const columnKeyZ = getColumnKey(z);
    const sectionKey = getSectionKey(y);

    let column = this.columns[columnKeyX]?.[columnKeyZ];
    if (column == null) {
      column = Array(numSections);
      for (let i = 0; i < numSections; i++) {
        column[i] = Array(sectionVolume);
      }
      if (this.columns[columnKeyX] == null) {
        const zArray = [];
        zArray[columnKeyZ] = column;
        this.columns[columnKeyX] = zArray;
      } else {
        this.columns[columnKeyX][columnKeyZ] = column;
      }
    }
    const sectionPosition = getSectionPosition(x, y, z);
    column[sectionKey][sectionPosition] = object;
  }

  getPos(x, y, z) {
    if (this.columns[getColumnKey(x)]?.[getColumnKey(z)] == null) return null;
    return this.columns[getColumnKey(x)][getColumnKey(z)][getSectionKey(y)][getSectionPosition(x, y, z)];
  }

  writeOnMiss(x, y, z) {
    const object = this.provider(x, y, z);
    this.setPos(x, y, z, object);
    return object;
  }

  getPosWriteOnMiss(x, y, z) {
    const columnKeyX = getColumnKey(x);
    const columnKeyZ = getColumnKey(z);
    if (this.columns[columnKeyX]?.[columnKeyZ] === undefined) {
      return this.writeOnMiss(x, y, z);
    }
    const sectionKey = getSectionKey(y);
    const sectionPosition = getSectionPosition(x, y, z);
    if (this.columns[columnKeyX][columnKeyZ][sectionKey][sectionPosition] === undefined) {
      return this.writeOnMiss(x, y, z);
    }
    return this.columns[columnKeyX][columnKeyZ][sectionKey][sectionPosition];
  }
}

module.exports = PositionCache;
