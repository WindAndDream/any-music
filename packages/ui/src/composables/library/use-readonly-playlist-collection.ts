import { computed, reactive, toValue } from 'vue'
import type { MaybeRefOrGetter } from 'vue'

import type {
  CatalogTrackDisplayMode,
  MobileTrackColumns,
} from '../../components/music-sources/catalog-track-display-mode'
import type { TagPlaylistRecord } from '../../product/specialist-presentation'
import { editingStateKey, provideEditingSession, useEditingSession } from '../use-editing-session'
import { createPlaylistOverviewFilters, filterPlaylistOverview } from './use-playlist-collection'
import type { PlaylistOverviewFilters } from './use-playlist-collection'

function createState() {
  return reactive({
    filters: createPlaylistOverviewFilters(),
    draft: null as PlaylistOverviewFilters | null,
    displayOpen: false,
    displayMode: 'standard' as CatalogTrackDisplayMode,
    mobileColumns: 1 as MobileTrackColumns,
  })
}
const key = editingStateKey<ReturnType<typeof createState>>('readonly-playlists')

/** Associated playlists share filtering and density across themes without exposing mutations. */
export function useReadonlyPlaylistCollection(
  records: MaybeRefOrGetter<readonly TagPlaylistRecord[]>,
) {
  const editing = useEditingSession('tag-detail-playlists')
  provideEditingSession(editing)
  const view = editing.state(key, createState)
  const playlists = computed(() => toValue(records).map(({ playlist }) => playlist))
  const tags = computed(
    () => new Map(toValue(records).map(({ playlist, customTags }) => [playlist.id, customTags])),
  )
  function filter(filters: PlaylistOverviewFilters) {
    const ids = new Set(
      filterPlaylistOverview(playlists.value, filters, tags.value).map(({ id }) => id),
    )
    return toValue(records).filter(({ playlist }) => ids.has(playlist.id))
  }
  const visible = computed(() => filter(view.filters))
  const preview = computed(() => filter(view.draft ?? view.filters))
  const modalOpen = computed(() => view.displayOpen || view.draft !== null)
  const filterCount = computed(
    () =>
      Number(!!view.filters.keyword.trim()) +
      view.filters.trackCountRanges.length +
      (view.filters.tagsDormant ? 0 : view.filters.tags.length) +
      view.filters.cover.length,
  )
  function beginFilters() {
    view.draft = { ...view.filters }
  }
  function applyFilters() {
    if (!view.draft) return
    view.filters = { ...view.draft }
    view.draft = null
  }
  return {
    view,
    playlists,
    tags,
    visible,
    preview,
    modalOpen,
    filterCount,
    beginFilters,
    applyFilters,
  }
}
