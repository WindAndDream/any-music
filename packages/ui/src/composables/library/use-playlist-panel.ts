import type {
  CustomTrackDefinition,
  LibraryTrackRecord,
  MusicPlaylist,
  PlaybackMode,
  Track,
} from '@any-music/core'
import type { ShallowRef } from 'vue'
import { computed, shallowRef } from 'vue'

import type { MusicPlatformOption } from '../../composables/library/use-favorite-filters'
import { editingStateKey, useEditingSession } from '../use-editing-session'

export interface PlaylistPanelProps {
  records: readonly LibraryTrackRecord[]
  playlists: readonly MusicPlaylist[]
  customTracks: readonly CustomTrackDefinition[]
  platforms: readonly MusicPlatformOption[]
  favoriteTrackIds: ReadonlySet<string>
  currentTrackId?: string
  mode: PlaybackMode
  errorMessage: string
  downloadBusy: boolean
}

export interface PlaylistPanelEmits {
  createPlaylist: [name: string]
  deletePlaylist: [playlistId: string]
  removeTrack: [playlistId: string, trackId: string]
  play: [track: Track, tracks: readonly Track[]]
  'update:mode': [mode: PlaybackMode]
  queue: [track: Track]
  compose: [trackId: string]
  favorite: [track: Track]
  unfavorite: [trackId: string]
  download: [tracks: readonly Track[], playlist: MusicPlaylist]
}

type PlaylistPanelEmit = <EventName extends keyof PlaylistPanelEmits>(
  eventName: EventName,
  ...args: PlaylistPanelEmits[EventName]
) => void

export interface UsePlaylistPanelOptions {
  props: Readonly<PlaylistPanelProps>
  emit: PlaylistPanelEmit
}

function createSearchKey(value: string): string {
  return value.normalize('NFKC').trim().toLocaleLowerCase()
}

/** 歌单总览与歌曲页共用稳定资料映射，切页时不改变曲目播放顺序。 */
export function usePlaylistPanel(options: UsePlaylistPanelOptions) {
  const { emit, props } = options

  const query = useEditingSession('playlist-overview').state(queryKey, () => shallowRef(''))
  const playlistDraft = useEditingSession('playlist-overview').state(playlistDraftKey, () =>
    shallowRef(''),
  )
  const activePlaylistId = useEditingSession('playlist-overview').state(activePlaylistIdKey, () =>
    shallowRef<string>(),
  )
  const visiblePlaylists = computed(() => {
    const searchKey = createSearchKey(query.value)
    if (!searchKey) return props.playlists
    return props.playlists.filter((playlist) => createSearchKey(playlist.name).includes(searchKey))
  })
  const recordsByPlaylistId = computed(() => {
    const recordById = new Map(props.records.map((record) => [record.track.id, record]))
    return new Map(
      props.playlists.map((playlist) => [
        playlist.id,
        playlist.trackIds
          .map((trackId) => recordById.get(trackId))
          .filter((record): record is LibraryTrackRecord => record !== undefined),
      ]),
    )
  })

  function submitPlaylist(): void {
    const name = playlistDraft.value.trim()
    if (!name) return
    emit('createPlaylist', name)
    playlistDraft.value = ''
  }

  function openPlaylist(playlistId: string): void {
    activePlaylistId.value = playlistId
  }

  function closePlaylist(): void {
    activePlaylistId.value = undefined
  }

  function deletePlaylist(playlistId: string): void {
    if (activePlaylistId.value === playlistId) closePlaylist()
    emit('deletePlaylist', playlistId)
  }

  /** 从歌单点播时保留歌单的稳定顺序，播放模式因此作用于该歌单而非待听列表。 */
  function playPlaylistTrack(track: Track, playlistId: string): void {
    const tracks = (recordsByPlaylistId.value.get(playlistId) ?? []).map((record) => record.track)
    emit('play', track, tracks.length > 0 ? tracks : [track])
  }

  return {
    activePlaylistId,
    closePlaylist,
    deletePlaylist,
    openPlaylist,
    playlistDraft,
    playPlaylistTrack,
    query,
    recordsByPlaylistId,
    submitPlaylist,
    visiblePlaylists,
  }
}

const queryKey = editingStateKey<ShallowRef<string>>(
  'composables/library/use-playlist-panel.ts:query',
)
const playlistDraftKey = editingStateKey<ShallowRef<string>>(
  'composables/library/use-playlist-panel.ts:playlistDraft',
)
const activePlaylistIdKey = editingStateKey<ShallowRef<string | undefined>>(
  'composables/library/use-playlist-panel.ts:activePlaylistId',
)
