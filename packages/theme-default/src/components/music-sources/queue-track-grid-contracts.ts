import type { Track } from '@any-music/core'
import type { CatalogTrackDisplayMode, MobileTrackColumns } from '@any-music/ui/library'
import type { CSSProperties } from 'vue'

import type { ClassicVirtualTrackGridBinding } from '../../composables/classic-virtual-favorites-canary'

/** Both rendering paths use the same complete collection and controlled row inputs. */
export interface QueueTrackGridProps {
  tracks: readonly Track[]
  customTagsByTrackId?: ReadonlyMap<string, readonly string[]>
  customNamesByTrackId?: ReadonlyMap<string, string>
  dateLabel?: string
  positions: ReadonlyMap<string, number>
  selectedIds: ReadonlySet<string>
  selectable?: boolean
  platformNames: ReadonlyMap<string, string>
  addedAtMsByTrackId: ReadonlyMap<string, number>
  currentTrackId?: string
  draggedId?: string
  getReorderStyle: (id: string) => CSSProperties | undefined
  favoriteTrackIds: ReadonlySet<string>
  invalidTrackIds: ReadonlySet<string>
  downloadBusy: boolean
  displayMode: CatalogTrackDisplayMode
  mobileColumns: MobileTrackColumns
  animate?: boolean
  virtual?: ClassicVirtualTrackGridBinding
  continuityKey?: string
}

export type QueueTrackGridEmits = {
  select: [id: string]
  play: [id: string]
  favorite: [track: Track]
  download: [track: Track]
  showActions: [id: string]
  dragStart: [event: PointerEvent, id: string]
  shift: [id: string, direction: -1 | 1]
  dragCancel: []
}
