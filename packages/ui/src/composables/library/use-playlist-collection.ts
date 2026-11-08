import type { MusicPlaylist } from '@any-music/core'
import { computed, shallowRef, toValue, watch } from 'vue'
import type { MaybeRefOrGetter } from 'vue'

import { useUiContributionAvailability } from '../../product/ui-contributions'
import { useCatalogSelectionOperator } from '../music-sources/use-catalog-selection-operator'
import { editingStateKey, useEditingSession } from '../use-editing-session'
import type { EditingSession } from '../use-editing-session'
import { playlistNameKey } from './playlist-editor'

export interface PlaylistOverviewFilters {
  keyword: string
  trackCountRanges: readonly PlaylistTrackCountRange[]
  tags: readonly string[]
  tagsDormant?: boolean
  /** Empty means all cover states; selected states match with OR semantics. */
  cover: readonly ('present' | 'missing')[]
}

export interface PlaylistTrackCountRange {
  minCount?: number
  maxCount?: number
}

export function createPlaylistOverviewFilters(): PlaylistOverviewFilters {
  return { keyword: '', trackCountRanges: [], tags: [], cover: [] }
}

export function filterPlaylistOverview(
  playlists: readonly MusicPlaylist[],
  filters: PlaylistOverviewFilters,
  customTagsByPlaylistId: ReadonlyMap<string, readonly string[]> = new Map(),
  userTagsEnabled = true,
): readonly MusicPlaylist[] {
  const keyword = playlistNameKey(filters.keyword)
  return playlists.filter((playlist) => {
    if (
      keyword &&
      ![playlist.name, playlist.description ?? ''].some((text) =>
        playlistNameKey(text).includes(keyword),
      )
    )
      return false
    if (
      filters.trackCountRanges.length &&
      !filters.trackCountRanges.some(
        ({ minCount, maxCount }) =>
          (minCount === undefined || playlist.trackIds.length >= minCount) &&
          (maxCount === undefined || playlist.trackIds.length <= maxCount),
      )
    )
      return false
    if (userTagsEnabled && !filters.tagsDormant && filters.tags.length) {
      const tags = new Set((customTagsByPlaylistId.get(playlist.id) ?? []).map(playlistNameKey))
      if (!filters.tags.some((tag) => tags.has(playlistNameKey(tag)))) return false
    }
    if (filters.cover.length && !filters.cover.includes(playlist.coverId ? 'present' : 'missing'))
      return false
    return true
  })
}

/** Only visible slots move; hidden playlists keep their positions in the persisted order. */
export function reorderVisiblePlaylists(
  allIds: readonly string[],
  id: string,
  target: string,
  visibleIds: readonly string[],
): readonly string[] {
  const allowed = new Set(visibleIds)
  const order = allIds.filter((candidate) => allowed.has(candidate))
  const from = order.indexOf(id)
  const to = order.indexOf(target)
  if (from < 0 || to < 0 || from === to) return allIds
  order.splice(to, 0, ...order.splice(from, 1))
  let index = 0
  return allIds.map((candidate) => (allowed.has(candidate) ? order[index++]! : candidate))
}

/** Theme-independent, in-memory overview state; storage and mutations remain host-owned. */
export function usePlaylistCollection(options: {
  playlists: MaybeRefOrGetter<readonly MusicPlaylist[]>
  customTagsByPlaylistId?: MaybeRefOrGetter<ReadonlyMap<string, readonly string[]>>
  editing?: EditingSession
}) {
  const editing = options.editing ?? useEditingSession('playlist-overview')
  const state = editing.state(playlistCollectionKey, createState)
  const contribution = useUiContributionAvailability('trackList.filters', () => ({
    area: 'playlists',
  }))
  watch(
    [() => contribution.allows('tag-filter'), state.filters, state.draft],
    ([available]) => {
      if (available) return
      for (const cell of [state.filters, state.draft]) {
        if (cell.value?.tags.length && !cell.value.tagsDormant)
          cell.value = { ...cell.value, tagsDormant: true }
      }
    },
    { immediate: true, flush: 'sync' },
  )
  const filter = (filters: PlaylistOverviewFilters) =>
    filterPlaylistOverview(
      toValue(options.playlists),
      filters,
      toValue(options.customTagsByPlaylistId) ?? new Map(),
      contribution.allows('tag-filter'),
    )
  const visible = computed(() => filter(state.filters.value))
  const selectedIds = computed(() => new Set(state.selection.value))
  const selected = computed(() => {
    const byId = new Map(visible.value.map((item) => [item.id, item]))
    return state.selection.value.flatMap((id) => byId.get(id) ?? [])
  })
  const selectedTrackIds = computed(() => [
    ...new Set(selected.value.flatMap(({ trackIds }) => trackIds)),
  ])
  const allSelected = computed(
    () => visible.value.length > 0 && selected.value.length === visible.value.length,
  )
  const preview = computed(() => filter(state.draft.value ?? state.filters.value))
  useCatalogSelectionOperator({
    context: 'playlist-overview',
    open: state.operatorOpen,
    clearSelection: () => {
      state.selection.value = []
    },
  })
  watch(visible, (items) => {
    const ids = new Set(items.map(({ id }) => id))
    state.selection.value = state.selection.value.filter((id) => ids.has(id))
  })
  function select(id: string) {
    if (!state.operatorOpen.value || !visible.value.some((item) => item.id === id)) return
    const ids = new Set(state.selection.value)
    if (ids.has(id)) ids.delete(id)
    else ids.add(id)
    state.selection.value = [...ids]
  }
  function toggleAll() {
    if (!state.operatorOpen.value) return
    state.selection.value = allSelected.value
      ? []
      : [...new Set([...state.selection.value, ...visible.value.map(({ id }) => id)])]
  }
  function applyFilters() {
    if (!state.draft.value) return
    state.filters.value = { ...state.draft.value }
    state.draft.value = null
  }
  return {
    ...state,
    visible,
    selectedIds,
    selected,
    selectedTrackIds,
    allSelected,
    preview,
    select,
    toggleAll,
    applyFilters,
  }
}

function createState() {
  return {
    filters: shallowRef(createPlaylistOverviewFilters()),
    draft: shallowRef<PlaylistOverviewFilters | null>(null),
    selection: shallowRef<readonly string[]>([]),
    operatorOpen: shallowRef(false),
  }
}
const playlistCollectionKey = editingStateKey<ReturnType<typeof createState>>('playlist-collection')
