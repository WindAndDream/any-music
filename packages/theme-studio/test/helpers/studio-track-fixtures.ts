import type { Track } from '@any-music/core'
import { createFavoriteFilterState } from '@any-music/ui'
import type { UiThemeFeatureMap } from '@any-music/ui/theme'
import type { UiThemeTrackListActions, UiThemeTrackListState } from '@any-music/ui/theme'
import { vi } from 'vitest'

const track: Track = {
  id: 'source:track:one',
  title: '歌曲',
  artists: [],
  source: { pluginId: 'source', mediaKind: 'audio', resourceId: 'one' },
}
export function createStudioFavoritesFeature(
  count: number,
  styled: boolean,
): UiThemeFeatureMap['favorites'] {
  const state = createStudioTrackList(false)
  state.tracks = Array.from({ length: count }, (_, index) => ({
    ...track,
    id: `track-${index}`,
    title: `歌曲 ${index}`,
  }))
  state.itemStyle = styled ? 'minimal' : 'default'
  return {
    state: {
      ...state,
      arrangementMode: 'flat',
      mobileLayout: false,
      totalCount: count,
      platformOrder: [],
      platformTrackCounts: new Map(),
      favoriteFilters: createFavoriteFilterState([]),
      favoriteFilterDraft: null,
    },
    actions: {
      ...createStudioTrackActions(),
      setArrangementMode: vi.fn(),
      moveTrack: vi.fn(),
      movePlatform: vi.fn(),
      setFavoriteFilterDraft: vi.fn(),
      applyFavoriteFilters: vi.fn(),
      cancelFavoriteFilters: vi.fn(),
      reorderPlatforms: vi.fn(),
    },
    availability: { status: 'available' },
    status: { status: 'ready' },
  }
}
export function createStudioTrackList(queued: boolean): UiThemeTrackListState {
  return {
    tracks: [track],
    selectedTrackIds: [],
    invalidTrackIds: [],
    favoriteTrackIds: [],
    queuedTrackIds: queued ? [track.id] : [],
    downloadedTrackIds: [],
    platformNames: new Map(),
    customNamesByTrackId: new Map(),
    customTagsByTrackId: new Map(),
    addedAtMsByTrackId: new Map(),
    displayMode: 'standard',
    mobileColumns: 1,
    filters: { searchFilters: [], tags: [], publishedRanges: [], durationRanges: [] },
    filterDraft: null,
  }
}
export function createStudioTrackActions(): UiThemeTrackListActions {
  return {
    play: vi.fn(),
    download: vi.fn(),
    toggleFavorite: vi.fn(),
    select: vi.fn(),
    setFilterDraft: vi.fn(),
    applyFilters: vi.fn(),
    cancelFilters: vi.fn(),
    showTrackActions: vi.fn(),
    enqueue: vi.fn(),
    rename: vi.fn(),
    addToPlaylist: vi.fn(),
    useAsMaterial: vi.fn(),
    addTag: vi.fn(),
    removeTag: vi.fn(),
    setDisplayMode: vi.fn(),
    setMobileColumns: vi.fn(),
  }
}
