import type {
  DownloadHistoryBatch,
  LibraryTrackRecord,
  MusicPlaylist,
  PlaybackHistoryEntry,
  Track,
} from '@any-music/core'

import type {
  CatalogTrackDisplayMode,
  MobileTrackColumns,
} from '../components/music-sources/catalog-track-display-mode'
import type { PlaybackHistoryTimeRange } from '../composables/library/playback-history-filters'
import type { QueueListSummary } from '../composables/music-sources/use-queue-list-controls'
import type { TrackCollectionProps, TrackCollectionEvents } from './track-collection'

export interface QueuePanelProps extends TrackCollectionProps {
  arrangementMode: 'flat' | 'platform'
}
export interface QueuePanelEmits extends TrackCollectionEvents {
  'update:arrangementMode': [mode: 'flat' | 'platform']
}
export interface FavoritePanelProps extends Omit<
  TrackCollectionProps,
  'items' | 'context' | 'addedAtMsByTrackId' | 'favoriteTrackIds'
> {
  records: readonly LibraryTrackRecord[]
  arrangementMode: 'flat' | 'platform'
}
export interface FavoritePanelEmits extends Omit<
  TrackCollectionEvents,
  'select' | 'removeMany' | 'favorite' | 'playCollection'
> {
  'update:arrangementMode': [mode: 'flat' | 'platform']
  play: [track: Track, tracks: readonly Track[]]
  unfavorite: [trackId: string]
  unfavoriteMany: [trackIds: readonly string[]]
}
export interface HistoryPanelProps {
  history: readonly PlaybackHistoryEntry[]
  records: readonly LibraryTrackRecord[]
  platformNames: ReadonlyMap<string, string>
  query?: string
  platformId?: string
  timeRange?: PlaybackHistoryTimeRange
  startedAfterMs?: number | null
}
export interface HistoryPanelEmits {
  queue: [track: Track]
  openOperator: []
}
export interface HistoryOperatorProps {
  platforms: readonly { id: string; label: string }[]
  resultCount: number
  totalCount: number
  query: string
  platformId: string
  timeRange: PlaybackHistoryTimeRange
}
export interface HistoryOperatorEmits {
  clearHistory: []
  'update:query': [query: string]
  'update:platformId': [id: string]
  'update:timeRange': [range: PlaybackHistoryTimeRange]
}
export interface ActiveDownloadProps {
  playlists?: readonly MusicPlaylist[]
  batches: readonly DownloadHistoryBatch[]
  concurrency: number
  mobileLayout: boolean
  platformNames: ReadonlyMap<string, string>
  statusMessage: string
  errorMessage?: string
  cancelling: boolean
  filterOpen: boolean
  operatorOpen: boolean
  operatorAutoFocus?: boolean
  panelsSuspended: boolean
  overlayTarget: HTMLElement | null
  operatorOverlayTarget: HTMLElement | null
  displayMode: CatalogTrackDisplayMode
  mobileColumns: MobileTrackColumns
  currentTrackId?: string
  favoriteTrackIds: ReadonlySet<string>
  queuedTrackIds: ReadonlySet<string>
  invalidTrackIds: ReadonlySet<string>
  customTagsByTrackId: ReadonlyMap<string, readonly string[]>
}
export interface ActiveDownloadEmits {
  addToPlaylist: [playlistId: string, tracks: readonly Track[]]
  pause: [itemIds: readonly string[]]
  resume: [itemIds: readonly string[]]
  cancel: [itemIds: readonly string[]]
  remove: [itemIds: readonly string[]]
  play: [track: Track]
  favorite: [track: Track]
  queue: [track: Track]
  compose: [track: Track]
  addTag: [track: Track, tag: string]
  removeTag: [track: Track, tag: string]
  rename: [track: Track, name: string]
  summaryChange: [summary: QueueListSummary]
  closeFilter: []
  closeOperator: []
  modalOpenChange: [open: boolean]
  selectAllChange: [count: number]
  updateDisplayMode: [mode: CatalogTrackDisplayMode]
  updateMobileColumns: [columns: MobileTrackColumns]
}
