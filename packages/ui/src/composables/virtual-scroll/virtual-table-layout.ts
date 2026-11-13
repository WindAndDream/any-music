import type { FixedVirtualListItem } from './use-fixed-virtual-list'

export interface VirtualTableRowPosition {
  /** One-based physical table row, including the caller's header rows. */
  firstRowIndex: number
  rowCount: number
}

function rowCount(value: number, name: string, minimum = 0) {
  if (!Number.isSafeInteger(value) || value < minimum) throw new RangeError(`Invalid ${name}`)
  return value
}

/** Full-collection physical row positions; rebuild only when semantic row counts change. */
export function createVirtualTableRowIndex<T>(
  items: readonly T[],
  getItemRowCount: (item: T, index: number) => number,
  headerRowCount = 0,
  footerRowCount = 0,
) {
  let count = rowCount(headerRowCount, 'header row count')
  const positions = items.map((item, index) => {
    const size = rowCount(getItemRowCount(item, index), 'item row count', 1)
    const position = { firstRowIndex: count + 1, rowCount: size }
    count = rowCount(count + size, 'table row count')
    return position
  })
  return {
    positions,
    rowCount: rowCount(count + rowCount(footerRowCount, 'footer row count'), 'table row count'),
  }
}

/** Every omitted interval gets a natural-flow spacer, including gaps around retained rows. */
export function createVirtualTableLayout<T>(
  items: readonly FixedVirtualListItem<T>[],
  totalSize: number,
) {
  let end = 0
  const rows = items.map((row) => {
    const gapBefore = Math.max(0, row.start - end)
    end = row.end
    return { row, gapBefore }
  })
  return { rows, trailingGap: Math.max(0, totalSize - end) }
}
