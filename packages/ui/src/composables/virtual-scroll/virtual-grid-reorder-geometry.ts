import type {
  GridReorderGeometryInput,
  GridReorderGeometrySession,
  GridReorderRect,
} from '../grid-reorder-geometry'
import type { QueueReorderSlot } from '../music-sources/queue-reorder-geometry'
import type { VirtualItemKey } from './virtual-row-geometry'

/** Structural subset of the immutable useMeasuredVirtualGrid geometry snapshot. */
export interface VirtualGridReorderItem {
  key: VirtualItemKey
  index: number
  rowIndex: number
  columnIndex: number
  start: number
  size: number
  inlineStart: number
  inlineSize: number
}

export interface VirtualGridReorderGeometry {
  count: number
  getItem: (index: number) => VirtualGridReorderItem | undefined
}

export interface VirtualGridReorderOptions {
  geometry: VirtualGridReorderGeometry
  /** Opt into refreshed, same-identity measured geometry during this drag. */
  getGeometry?: () => VirtualGridReorderGeometry
  /** Spatial generation avoids rebuilding the index for metadata-only snapshots. */
  getGeometryRevision?: () => unknown
  columns: number
  direction?: 'ltr' | 'rtl'
  listWidth: number
  /**
   * List-local (0, 0) in capture-root coordinates at pointer down. The caller applies
   * its header/listOffset and current scroll offset exactly once when deriving this.
   */
  origin: { left: number; top: number }
  sourceElement: HTMLElement
  /** Only current mounted/pinned cells need preview styles; identities remain complete. */
  mountedIds: () => readonly string[]
  getMountedElement?: (id: string) => HTMLElement | undefined
  includeOtherGroups?: boolean
  vertical?: boolean
  domain?: GridReorderRect
  getRevision?: () => unknown
  /** Compare the grid's spatial layoutRevision, not item-bearing geometry object identity. */
  isValid?: () => boolean
}

interface Point {
  index: number
  x: number
  y: number
}

interface Row {
  points: Point[]
}

interface Node {
  left: number
  right: number
  top: number
  bottom: number
  firstIndex: number
  row?: Row
  before?: Node
  after?: Node
}

function createRowTree(rows: readonly Row[], start = 0, end = rows.length): Node | undefined {
  if (start === end) return undefined
  if (end - start === 1) {
    const row = rows[start]!
    return {
      left: row.points[0]!.x,
      right: row.points[row.points.length - 1]!.x,
      top: row.points[0]!.y,
      bottom: row.points[0]!.y,
      firstIndex: row.points.reduce((first, point) => Math.min(first, point.index), Infinity),
      row,
    }
  }
  const middle = Math.floor((start + end) / 2)
  const before = createRowTree(rows, start, middle)!
  const after = createRowTree(rows, middle, end)!
  return {
    left: Math.min(before.left, after.left),
    right: Math.max(before.right, after.right),
    top: Math.min(before.top, after.top),
    bottom: Math.max(before.bottom, after.bottom),
    firstIndex: Math.min(before.firstIndex, after.firstIndex),
    before,
    after,
  }
}

function distanceToNode(node: Node, x: number, y: number) {
  const dx = Math.max(node.left - x, 0, x - node.right)
  const dy = Math.max(node.top - y, 0, y - node.bottom)
  return dx * dx + dy * dy
}

/** Exact nearest-center lookup, pruning whole row subtrees and binary-searching leaf columns. */
function findNearest(tree: Node, x: number, y: number): number | undefined {
  let nearest: number | undefined
  let distance = Infinity
  function consider(point: Point | undefined) {
    if (!point) return
    const dx = x - point.x,
      dy = y - point.y
    const next = dx * dx + dy * dy
    if (next < distance || (nearest !== undefined && next === distance && point.index < nearest)) {
      distance = next
      nearest = point.index
    }
  }
  function visit(node: Node) {
    const bound = distanceToNode(node, x, y)
    if (bound > distance || (bound === distance && node.firstIndex >= (nearest ?? Infinity))) return
    if (node.row) {
      const points = node.row.points
      let low = 0,
        high = points.length
      while (low < high) {
        const middle = Math.floor((low + high) / 2)
        if (points[middle]!.x < x) low = middle + 1
        else high = middle
      }
      consider(points[low])
      consider(points[low - 1])
      return
    }
    const before = node.before!,
      after = node.after!
    if (distanceToNode(before, x, y) <= distanceToNode(after, x, y)) {
      visit(before)
      visit(after)
    } else {
      visit(after)
      visit(before)
    }
  }
  visit(tree)
  return nearest
}

/**
 * Spatial index over a complete immutable measured row-major snapshot. Preparation
 * reads the collection once per spatial generation; pointer queries use that index
 * rather than enumerate DOM or rebuild the complete slot array. Live measured
 * adapters opt in explicitly and keep their structural layout guards current.
 * Cells must have P09's uniform stretched height within each logical row. The tree
 * is derived geometry, with no independent heights or measurement lifecycle.
 * Spatial pruning depends on candidate distribution; it is not a universal O(log N) bound.
 */
export function createVirtualGridReorderGeometry<Kind extends string>(
  input: GridReorderGeometryInput<Kind>,
  options: VirtualGridReorderOptions,
): GridReorderGeometrySession | undefined {
  const initial = createSnapshot(input, options)
  if (!initial || !options.getGeometry) return initial
  const initialSourceSlot = initial.sourceSlot
  let session: GridReorderGeometrySession | undefined = initial
  let revision = options.getGeometryRevision?.() ?? options.geometry
  let invalid = false
  function current() {
    if (invalid || options.isValid?.() === false) return
    const snapshot = options.getGeometry!()
    const next = options.getGeometryRevision?.() ?? snapshot
    if (next !== revision) {
      // Measurements publish immutable batches. Rebuild only at that boundary, never
      // per pointer query or mounted-window change; identity mismatches end the session.
      revision = next
      session = createSnapshot(input, { ...options, geometry: snapshot })
      if (
        session &&
        (session.sourceSlot.left !== initialSourceSlot.left ||
          session.sourceSlot.width !== initialSourceSlot.width)
      )
        session = undefined
      invalid = !session
    }
    return session
  }
  return {
    get sourceSlot() {
      return current()?.sourceSlot ?? initial.sourceSlot
    },
    sourceElement: initial.sourceElement,
    getMountedElement: options.getMountedElement,
    domain: initial.domain,
    allowsHeightChanges: true,
    getLayoutRevision: () => options.getGeometryRevision?.() ?? options.getGeometry!(),
    getRevision: () => [
      options.getRevision?.(),
      options.getGeometryRevision?.() ?? options.getGeometry!(),
    ],
    isValid: () => Boolean(current()),
    findSlot: (x, y) => current()?.findSlot(x, y),
    getOffsets: (targetId) => current()?.getOffsets(targetId) ?? new Map(),
  }
}

function createSnapshot<Kind extends string>(
  input: GridReorderGeometryInput<Kind>,
  options: VirtualGridReorderOptions,
): GridReorderGeometrySession | undefined {
  const { geometry, columns, listWidth, origin } = options
  const ids = [...input.ids]
  const sourceId = input.sourceId
  const originLeft = origin.left,
    originTop = origin.top,
    isRtl = options.direction === 'rtl'
  if (!Number.isSafeInteger(columns) || columns < 1) throw new RangeError('Invalid column count')
  if (!Number.isFinite(listWidth) || listWidth < 0) throw new RangeError('Invalid list width')
  if (!Number.isFinite(origin.left) || !Number.isFinite(origin.top))
    throw new RangeError('Invalid reorder origin')
  if (ids.length !== geometry.count || !input.eligibleIds.has(sourceId)) return
  const indexes = new Map<string, number>()
  const eligibleIndexes: number[] = []
  const eligibleRanks = new Map<string, number>()
  const rows = new Map<number, Row>()
  function getSlot(index: number, item = geometry.getItem(index)): QueueReorderSlot | undefined {
    if (!item || item.key !== ids[index]) return
    return {
      id: ids[index]!,
      left:
        originLeft + (isRtl ? listWidth - item.inlineStart - item.inlineSize : item.inlineStart),
      top: originTop + item.start,
      width: item.inlineSize,
      height: item.size,
    }
  }
  for (let index = 0; index < ids.length; index++) {
    const id = ids[index]!
    const item = geometry.getItem(index)
    if (
      indexes.has(id) ||
      !item ||
      item.key !== id ||
      item.index !== index ||
      item.rowIndex !== Math.floor(index / columns) ||
      item.columnIndex !== index % columns
    )
      return
    indexes.set(id, index)
    const eligible = input.eligibleIds.has(id)
    if (eligible) {
      eligibleRanks.set(id, eligibleIndexes.length)
      eligibleIndexes.push(index)
    }
    if (!eligible && !options.includeOtherGroups) continue
    const slot = getSlot(index, item)!
    if (
      ![slot.left, slot.top, slot.width, slot.height].every(Number.isFinite) ||
      slot.width < 0 ||
      slot.height < 0
    )
      throw new RangeError('Invalid virtual reorder slot')
    const row = rows.get(item.rowIndex) ?? { points: [] }
    const centerY = slot.top + slot.height / 2
    if (row.points.length && row.points[0]!.y !== centerY)
      throw new RangeError('Virtual reorder cells must share their row geometry')
    row.points.push({
      index,
      x: slot.left + slot.width / 2,
      y: centerY,
    })
    rows.set(item.rowIndex, row)
  }
  const sourceIndex = indexes.get(sourceId)
  if (sourceIndex === undefined || options.sourceElement.isConnected === false) return
  const sourceSlot = getSlot(sourceIndex)
  if (!sourceSlot) return
  const candidateRows = [...rows.values()]
  for (const row of candidateRows) {
    row.points.sort((a, b) => a.x - b.x || a.index - b.index)
    // Zero-width overlapping columns still choose the first original identity on a tie.
    row.points = row.points.filter(
      (point, index, points) => !index || point.x !== points[index - 1]!.x,
    )
  }
  const tree = createRowTree(candidateRows)
  if (!tree) return
  return {
    sourceSlot,
    sourceElement: options.sourceElement,
    getMountedElement: options.getMountedElement,
    domain: options.domain,
    getRevision: options.getRevision,
    isValid: options.isValid,
    findSlot(x, y) {
      if (!Number.isFinite(x) || !Number.isFinite(y)) return
      const index = findNearest(tree, x, y)
      return index === undefined ? undefined : getSlot(index)
    },
    getOffsets(targetId) {
      const offsets = new Map<string, { x: number; y: number }>()
      const sourceRank = eligibleRanks.get(sourceId)!
      const targetRank = targetId === undefined ? sourceRank : eligibleRanks.get(targetId)
      if (targetRank === undefined || targetRank === sourceRank) return offsets
      const direction = targetRank > sourceRank ? 1 : -1
      const adjacent = getSlot(eligibleIndexes[sourceRank + direction]!)!
      const groupShift =
        direction > 0
          ? sourceSlot.top - adjacent.top
          : sourceSlot.top + sourceSlot.height - adjacent.top - adjacent.height
      for (const id of options.mountedIds()) {
        const rank = eligibleRanks.get(id)
        if (
          rank === undefined ||
          direction * (rank - sourceRank) <= 0 ||
          direction * (rank - targetRank) > 0 ||
          offsets.has(id)
        )
          continue
        const slot = getSlot(eligibleIndexes[rank]!)!
        const destination = getSlot(eligibleIndexes[rank - direction]!)!
        offsets.set(
          id,
          options.vertical
            ? { x: 0, y: groupShift }
            : { x: destination.left - slot.left, y: destination.top - slot.top },
        )
      }
      return offsets
    },
  }
}
