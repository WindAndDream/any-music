import type { QueueReorderSlot } from './music-sources/queue-reorder-geometry'

export type GridReorderRect = Pick<QueueReorderSlot, 'left' | 'top' | 'width' | 'height'>
export type GridReorderOffsets = ReadonlyMap<string, { x: number; y: number }>

/** One drag's complete filtered identity snapshot, independent of its mounted window. */
export interface GridReorderGeometryInput<Kind extends string> {
  kind: Kind
  sourceId: string
  ids: readonly string[]
  eligibleIds: ReadonlySet<string>
  container: HTMLElement
  bounds: DOMRect
  initialScrollTop: number
}

/**
 * Slots and queries use capture-root coordinates at pointer down. The controller owns
 * pointer capture, group checks, scrolling, animation and commit/landing lifetimes.
 * Geometry sessions create no observers, listeners or interaction leases.
 */
export interface GridReorderGeometrySession {
  sourceSlot: QueueReorderSlot
  sourceElement: HTMLElement
  domain?: GridReorderRect
  findSlot: (x: number, y: number) => QueueReorderSlot | undefined
  getOffsets: (targetId: string | undefined) => GridReorderOffsets
  /** Resolve an already mounted stable slot without rescanning the complete DOM collection. */
  getMountedElement?: (id: string) => HTMLElement | undefined
  /** Reactive mounted-window revision; changing it refreshes previews without pointer input. */
  getRevision?: () => unknown
  /** A live measured adapter can absorb row-height changes; width/root changes still cancel. */
  allowsHeightChanges?: boolean
  /** Remeasure stable DOM slots after an observed height change; false rejects a spatial change. */
  refreshHeight?: () => boolean
  /** Measurement/layout generation, excluding ordinary mounted-window changes. */
  getLayoutRevision?: () => unknown
  /** A window change is valid; a stale identity/layout snapshot must cancel before querying. */
  isValid?: () => boolean
}

export type GridReorderGeometryFactory<Kind extends string> = (
  input: GridReorderGeometryInput<Kind>,
) => GridReorderGeometrySession | undefined
