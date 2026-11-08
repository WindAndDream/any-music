import type { Track } from '@any-music/core'
import type { CatalogTrackDisplayMode, MobileTrackColumns } from '@any-music/ui/library'
import type { CSSProperties } from 'vue'

import type { ClassicVirtualTrackGridBinding } from '../../composables/classic-virtual-favorites-canary'

/** Complete controlled platform projections; the mounted window never owns selection or order. */
export interface QueuePlatformGridGroup {
  id: string
  name: string
  tracks: readonly Track[]
  totalCount: number
  isCustom: boolean
}

export interface QueuePlatformGridProps {
  groups: readonly QueuePlatformGridGroup[]
  selectedIds: ReadonlySet<string>
  selectable?: boolean
  filtered: boolean
  draggedId?: string
  getReorderStyle: (id: string) => CSSProperties | undefined
  displayMode: CatalogTrackDisplayMode
  mobileColumns: MobileTrackColumns
  animate?: boolean
  virtual?: ClassicVirtualTrackGridBinding
  continuityKey?: string
}

export type QueuePlatformGridEmits = {
  open: [id: string]
  select: [id: string]
  dragStart: [event: PointerEvent, id: string]
  shift: [id: string, direction: -1 | 1]
  dragCancel: []
}
