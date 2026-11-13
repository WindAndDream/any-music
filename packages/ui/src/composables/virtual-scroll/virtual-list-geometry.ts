import type { createVirtualItemIndex, createVirtualRowGeometry } from './virtual-row-geometry'

/** Immutable occurrence projection shared by anchoring and keyed interaction navigation. */
export function createVirtualListGeometry(
  identity: ReturnType<typeof createVirtualItemIndex>,
  rows: ReturnType<typeof createVirtualRowGeometry>,
) {
  const keys = identity.keys
  function getItem(index: number) {
    const position = rows.getItemPosition(index)
    if (!position) return undefined
    const row = rows.getRow(position.rowIndex)!
    return { key: keys[index]!, index, start: row.start, end: row.end, size: row.size }
  }
  return {
    count: keys.length,
    totalSize: rows.totalSize,
    getItem,
    indexOf: identity.indexOf,
    findItemAtOffset: (offset: number) => {
      const row = rows.findRowAtOffset(offset)
      return row ? getItem(row.startIndex) : undefined
    },
  }
}
