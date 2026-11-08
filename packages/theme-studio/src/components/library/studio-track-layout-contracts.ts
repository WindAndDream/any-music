import type { Track } from '@any-music/core'
import type { UiThemeTrackListState, PresentationContinuityAdapter } from '@any-music/ui/theme'
import type { DeepReadonly } from 'vue'

export interface StudioTrackLayoutProps {
  state: DeepReadonly<UiThemeTrackListState>
  continuityRegion?: string
  rowCount: number
  disabled?: boolean
}
export interface StudioTrackLayoutSlots {
  head(): unknown
  card(context: { track: Track; index: number }): unknown
  rows(context: { track: Track; index: number; rowIndex?: number }): unknown
}
export interface StudioVirtualTrackLayoutAdapter {
  continuity: PresentationContinuityAdapter
}
