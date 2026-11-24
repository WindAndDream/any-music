import type {
  PresentationContinuityAdapter,
  PresentationContinuitySnapshot,
} from '@any-music/ui/theme'
import type { GridReorderGeometryFactory } from '@any-music/ui/virtual-scroll'

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
