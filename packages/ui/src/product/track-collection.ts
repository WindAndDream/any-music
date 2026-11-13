import type { MusicPlaylist, Track } from '@any-music/core'

import type {
  CatalogTrackDisplayMode,
  MobileTrackColumns,
} from '../components/music-sources/catalog-track-display-mode'
import type { QueueListSummary } from '../composables/music-sources/use-queue-list-controls'
import type { TrackPlaybackState } from './track-playback-state'

/** 待听与喜欢共用展示能力，曲目顺序和时间由各自业务容器提供。 */
export interface TrackCollectionProps {
  items: readonly Track[]
  context?: 'queue' | 'favorites'
  addedAtMsByTrackId?: ReadonlyMap<string, number>
  currentTrackId?: string
  playbackState?: TrackPlaybackState
  platformNames: ReadonlyMap<string, string>
  errorMessage: string
  downloadBusy: boolean
  displayMode?: CatalogTrackDisplayMode
  mobileColumns?: MobileTrackColumns
  mobileLayout?: boolean
  filterOpen?: boolean
  operatorOpen?: boolean
  operatorAutoFocus?: boolean
  panelsSuspended?: boolean
  overlayTarget?: HTMLElement | null
  operatorOverlayTarget?: HTMLElement | null
  favoriteTrackIds?: ReadonlySet<string>
  invalidTrackIds?: ReadonlySet<string>
  customTagsByTrackId?: ReadonlyMap<string, readonly string[]>
  queuedTrackIds?: ReadonlySet<string>
  downloadedTrackIds?: ReadonlySet<string>
  playlists?: readonly MusicPlaylist[]
}

export interface TrackCollectionEvents {
  select: [trackId: string]
  removeMany: [trackIds: readonly string[]]
  pin: [trackId: string, visibleIds: readonly string[]]
  move: [draggedId: string, targetId: string, visibleIds: readonly string[]]
  movePlatform: [draggedId: string, targetId: string, visibleIds: readonly string[]]
  download: [tracks: readonly Track[]]
  summaryChange: [summary: QueueListSummary]
  operatorAvailableChange: [available: boolean]
  closeFilter: []
  closeOperator: []
  modalOpenChange: [open: boolean]
  selectAllChange: [selectedCount: number]
  updateDisplayMode: [mode: CatalogTrackDisplayMode]
  updateMobileColumns: [columns: MobileTrackColumns]
  favorite: [track: Track]
  favoriteMany: [tracks: readonly Track[]]
  requestCreatePlaylist: []
  compose: [track: Track]
  addTag: [track: Track, tag: string]
  removeTag: [track: Track, tag: string]
  rename: [track: Track, name: string]
  playCollection: [track: Track, tracks: readonly Track[]]
  queue: [track: Track]
  queueMany: [tracks: readonly Track[]]
  addToPlaylist: [playlistId: string, tracks: readonly Track[]]
}
