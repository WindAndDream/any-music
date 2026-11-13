import type {
  PresentationContinuityAdapter,
  PresentationContinuitySnapshot,
} from '@any-music/ui/theme'
import type { GridReorderGeometryFactory } from '@any-music/ui/virtual-scroll'
import type { InjectionKey } from 'vue'

/** Internal admission gate: production providers remain absent until P03/P14 acceptance. */
export const classicVirtualFavoritesCanaryKey: InjectionKey<boolean> = Symbol(
  'classic-virtual-favorites-canary',
)

/** Each consumer has its own default-closed admission; Favorites never admits its siblings. */
export const classicVirtualQueueCanaryKey: InjectionKey<boolean> = Symbol(
  'classic-virtual-queue-canary',
)
export const classicVirtualPlaylistCanaryKey: InjectionKey<boolean> = Symbol(
  'classic-virtual-playlist-canary',
)

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
