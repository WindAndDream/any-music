export type VirtualItemKey = string | number

/** Build once per real collection change; scroll/drag lookup never rescans the source array. */
export function createVirtualItemIndex<T>(
  items: readonly T[],
  getKey: (item: T, index: number) => VirtualItemKey,
) {
  const indexes = new Map<VirtualItemKey, number>()
  const keys = items.map((item, index) => {
    const key = getKey(item, index)
    if (typeof key === 'number' && !Number.isFinite(key))
      throw new TypeError('Virtual item keys must be finite')
    if (indexes.has(key)) throw new TypeError(`Duplicate virtual item key: ${key}`)
    indexes.set(key, index)
    return key
  })
  return { keys: Object.freeze(keys), indexOf: (key: VirtualItemKey) => indexes.get(key) }
}

export interface VirtualLogicalRow {
  index: number
  startIndex: number
  /** Exclusive, including the final partial row. */
  endIndex: number
  start: number
  end: number
  size: number
}
export interface VirtualRowGeometryOptions {
  count: number
  columns: number
  rowGap?: number
  listOffset?: number
  paddingStart?: number
  paddingEnd?: number
  /** Highest natural cell size for each logical row; this is not masonry lane placement. */
  getRowSize: (rowIndex: number) => number
}
function nonnegative(value: number, name: string): number {
  if (!Number.isFinite(value) || value < 0) throw new RangeError(`Invalid ${name}`)
  return value
}

/** Immutable row-major geometry. O(rows) construction, O(1) item/row and O(log rows) offset lookup. */
export function createVirtualRowGeometry(options: VirtualRowGeometryOptions) {
  const { count, columns, getRowSize } = options
  if (!Number.isSafeInteger(count) || count < 0) throw new RangeError('Invalid item count')
  if (!Number.isSafeInteger(columns) || columns < 1) throw new RangeError('Invalid column count')
  const rowGap = nonnegative(options.rowGap ?? 0, 'row gap')
  const paddingStart = nonnegative(options.paddingStart ?? 0, 'start padding')
  const paddingEnd = nonnegative(options.paddingEnd ?? 0, 'end padding')
  const listOffset = options.listOffset ?? 0
  if (!Number.isFinite(listOffset)) throw new RangeError('Invalid list offset')
  const rowCount = Math.ceil(count / columns)
  const starts = new Float64Array(rowCount),
    sizes = new Float64Array(rowCount)
  let length = paddingStart
  for (let index = 0; index < rowCount; index++) {
    starts[index] = listOffset + length
    const size = nonnegative(getRowSize(index), 'row size')
    sizes[index] = size
    length += size + (index < rowCount - 1 ? rowGap : 0)
  }
  const totalSize = length + paddingEnd
  if (!Number.isFinite(totalSize) || !Number.isFinite(listOffset + totalSize))
    throw new RangeError('Virtual geometry overflow')
  function getRow(index: number): VirtualLogicalRow | undefined {
    if (!Number.isInteger(index) || index < 0 || index >= rowCount) return undefined
    const start = starts[index]!,
      size = sizes[index]!
    return {
      index,
      startIndex: index * columns,
      endIndex: Math.min(count, (index + 1) * columns),
      start,
      end: start + size,
      size,
    }
  }
  function getItemPosition(index: number) {
    if (!Number.isInteger(index) || index < 0 || index >= count) return undefined
    return { rowIndex: Math.floor(index / columns), columnIndex: index % columns }
  }
  function findRowAtOffset(offset: number): VirtualLogicalRow | undefined {
    if (!rowCount || !Number.isFinite(offset)) return undefined
    let low = 0,
      high = rowCount - 1
    // A gap belongs to its preceding row. Positions before/after the list clamp to its ends.
    while (low < high) {
      const middle = Math.ceil((low + high) / 2)
      if (starts[middle]! <= offset) low = middle
      else high = middle - 1
    }
    return getRow(low)
  }
  return { count, columns, rowCount, totalSize, getRow, getItemPosition, findRowAtOffset }
}
