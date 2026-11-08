/** Renderer-only foundation; business collections, sessions and scroll roots remain caller-owned. */
export { createVirtualGridReorderGeometry } from './composables/virtual-scroll/virtual-grid-reorder-geometry'
export type {
  VirtualGridReorderItem,
  VirtualGridReorderGeometry,
  VirtualGridReorderOptions,
} from './composables/virtual-scroll/virtual-grid-reorder-geometry'
export type {
  GridReorderGeometryFactory,
  GridReorderGeometryInput,
  GridReorderGeometrySession,
} from './composables/grid-reorder-geometry'
export { useMeasuredVirtualTable } from './composables/virtual-scroll/use-measured-virtual-table'
export type { MeasuredVirtualTableOptions } from './composables/virtual-scroll/use-measured-virtual-table'
export type { VirtualTableRowPosition } from './composables/virtual-scroll/virtual-table-layout'
export { useMeasuredVirtualGrid } from './composables/virtual-scroll/use-measured-virtual-grid'
export type {
  MeasuredVirtualGridOptions,
  MeasuredVirtualGridItem,
} from './composables/virtual-scroll/use-measured-virtual-grid'
export { useVirtualScrollAnchor } from './composables/virtual-scroll/use-virtual-scroll-anchor'
export type {
  VirtualScrollAnchor,
  VirtualScrollAnchorItem,
  VirtualScrollAnchorGeometry,
  VirtualScrollAnchorOptions,
} from './composables/virtual-scroll/use-virtual-scroll-anchor'
export { useVirtualItemRetention } from './composables/virtual-scroll/use-virtual-item-retention'
export type {
  VirtualItemRetentionReason,
  VirtualItemScrollAlignment,
  VirtualItemRetentionGeometry,
  VirtualItemRetentionOptions,
  VirtualItemFocusOptions,
} from './composables/virtual-scroll/use-virtual-item-retention'
export { useMeasuredVirtualList } from './composables/virtual-scroll/use-measured-virtual-list'
export type { MeasuredVirtualListOptions } from './composables/virtual-scroll/use-measured-virtual-list'
export { useVirtualItemMeasurements } from './composables/virtual-scroll/use-virtual-item-measurements'
export type {
  VirtualItemGeneration,
  VirtualItemMeasurementsOptions,
} from './composables/virtual-scroll/use-virtual-item-measurements'
export { useFixedVirtualList } from './composables/virtual-scroll/use-fixed-virtual-list'
export type {
  FixedVirtualListOptions,
  FixedVirtualListItem,
} from './composables/virtual-scroll/use-fixed-virtual-list'
export { useVirtualScrollContext } from './composables/virtual-scroll/use-virtual-scroll-context'
export type {
  VirtualScrollContextOptions,
  VirtualScrollMetrics,
} from './composables/virtual-scroll/use-virtual-scroll-context'
export {
  createVirtualItemIndex,
  createVirtualRowGeometry,
} from './composables/virtual-scroll/virtual-row-geometry'
export type {
  VirtualItemKey,
  VirtualLogicalRow,
  VirtualRowGeometryOptions,
} from './composables/virtual-scroll/virtual-row-geometry'
