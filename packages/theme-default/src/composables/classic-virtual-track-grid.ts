import type {
  PresentationContinuityAdapter,
  PresentationContinuitySnapshot,
} from '@any-music/ui/theme'
import { createVirtualGridReorderGeometry } from '@any-music/ui/virtual-scroll'
import type {
  GridReorderGeometryFactory,
  useMeasuredVirtualGrid,
  useVirtualItemRetention,
  useVirtualScrollAnchor,
} from '@any-music/ui/virtual-scroll'

export interface ClassicMeasuredTrackGrid<T> {
  element: HTMLElement | null
  result: ReturnType<typeof useMeasuredVirtualGrid<T>>
  retention?: ReturnType<typeof useVirtualItemRetention>
  anchor: ReturnType<typeof useVirtualScrollAnchor>
}

/** Presentation-only bridge; the existing collection continues owning every mutation. */
export interface ClassicVirtualTrackGridAdapter {
  continuity?: PresentationContinuityAdapter
  createGeometry: GridReorderGeometryFactory<'track' | 'platform'>
  retainItem: (kind: 'track' | 'platform', id: string) => (() => void) | undefined
  focusItem: (kind: 'track' | 'platform', id: string, signal: AbortSignal) => Promise<boolean>
  focusEntry?: (id: string, signal: AbortSignal) => Promise<boolean>
  captureOverview?: (entryId: string) => PresentationContinuitySnapshot | undefined
  restoreOverview?: (
    snapshot: PresentationContinuitySnapshot,
    signal: AbortSignal,
  ) => Promise<boolean>
  cancelNavigation: () => void
}

export interface ClassicVirtualTrackGridBinding {
  scrollElement: HTMLElement | null
  resetKey: unknown
  layoutGeneration: string
  register: (adapter: ClassicVirtualTrackGridAdapter) => () => void
}

/** Sort against the complete measured grid and translate only currently mounted cells. */
export function createClassicTrackGridGeometry<T>(
  getGrid: () => ClassicMeasuredTrackGrid<T> | null,
  getScrollRoot: () => HTMLElement | null | undefined,
  getLayoutKey: () => string,
): ClassicVirtualTrackGridAdapter['createGeometry'] {
  return (input) => {
    const grid = getGrid()
    const element = grid?.element
    const root = getScrollRoot()
    if (input.kind !== 'track' || !grid || !element || !root) return
    const { result } = grid
    const { ready, listWidth, listOffset } = result.context.metrics.value
    if (!ready) return
    const mounted = (id: string) =>
      Array.from(element.children).find(
        (cell) => (cell as HTMLElement).dataset.queueDropId === id,
      ) as HTMLElement | undefined
    const source = mounted(input.sourceId)
    if (!source) return
    const rect = element.getBoundingClientRect()
    const columns = result.columns.value
    const layout = getLayoutKey()
    const direction = () =>
      element.ownerDocument.defaultView?.getComputedStyle(element).direction === 'rtl'
        ? 'rtl'
        : 'ltr'
    const initialDirection = direction()
    return createVirtualGridReorderGeometry(input, {
      geometry: result.geometry.value,
      getGeometry: () => result.geometry.value,
      getGeometryRevision: () => result.layoutRevision.value,
      columns,
      direction: initialDirection,
      listWidth,
      origin: { left: rect.left - input.bounds.left, top: rect.top - input.bounds.top },
      sourceElement: source,
      mountedIds: () => result.virtualItems.value.map((row) => String(row.key)),
      getMountedElement: mounted,
      getRevision: () => result.virtualItems.value,
      isValid: () =>
        getGrid() === grid &&
        element.isConnected &&
        getScrollRoot() === root &&
        result.context.metrics.value.ready &&
        result.columns.value === columns &&
        result.context.metrics.value.listWidth === listWidth &&
        Math.abs(result.context.metrics.value.listOffset - listOffset) <= 1 &&
        Math.abs(
          element.getBoundingClientRect().top -
            root.getBoundingClientRect().top -
            root.clientTop +
            root.scrollTop -
            listOffset,
        ) <= 1 &&
        direction() === initialDirection &&
        getLayoutKey() === layout,
    })
  }
}
