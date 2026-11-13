import type { Track } from '@any-music/core'
import {
  cloneCatalogTrackFilterState,
  filterCatalogTracks,
  useEditingSession,
  provideEditingSession,
  provideTrackNames,
  useTrackBatchActions,
  useCatalogSelectionOperator,
} from '@any-music/ui/catalog'
import type { CatalogTrackFilterState } from '@any-music/ui/catalog'
import { catalogRootEditingKey, createCatalogRootEditing } from '@any-music/ui/catalog'
import type { UiThemeFeatureMap } from '@any-music/ui/theme'
import { computed, shallowRef, useTemplateRef, watch } from 'vue'
/** Complete-root catalog consumes values and named actions; mounting never starts source/media work. */
export function useClassicCatalog(props: { readonly feature: UiThemeFeatureMap['catalog'] }) {
  const state = computed(() => props.feature.state)
  const editing = useEditingSession('catalog-root')
  provideEditingSession(editing)
  provideTrackNames(computed(() => state.value.customNamesByTrackId))
  const modalTarget = useTemplateRef<HTMLElement>('modalTarget')
  const operatorTarget = useTemplateRef<HTMLElement>('operatorTarget')
  const {
    discoveryOpen,
    sourcePickerOpen,
    listFilterOpen,
    operatorOpen,
    displayOpen,
    contextOpen,
    actionDrawerId,
    errorDrawerId,
    actionTrackId,
    filterPreview,
    filterDetailOpen,
  } = editing.state(catalogRootEditingKey, createCatalogRootEditing)
  const drawerSelectedCount = shallowRef(0)
  function updateDrawerSummary(summary: { selectedCount: number }) {
    drawerSelectedCount.value = summary.selectedCount
  }
  const drawer = computed(() =>
    state.value.drawers.find(({ id }) => id === state.value.activeDrawerId),
  )
  const source = computed(() => state.value.sources.find(({ id }) => id === state.value.sourceId))
  const sources = computed(() => state.value.sources.filter(({ enabled }) => enabled))
  const actionDrawer = computed(() =>
    state.value.drawers.find(({ id }) => id === actionDrawerId.value),
  )
  const errorDrawer = computed(() =>
    state.value.drawers.find(({ id }) => id === errorDrawerId.value),
  )
  function viewLoadedTracks(id: string): void {
    errorDrawerId.value = undefined
    props.feature.actions.openDrawer(id)
  }
  function closeError(): void {
    if (errorDrawerId.value) props.feature.actions.cancelVerification(errorDrawerId.value)
    errorDrawerId.value = undefined
  }
  const actionTrack = computed(() =>
    drawer.value?.tracks.find(({ id }) => id === actionTrackId.value),
  )
  const invalidIds = computed(() => new Set(state.value.invalidTrackIds))
  const favoriteIds = computed(() => new Set(state.value.favoriteTrackIds))
  const selectedIds = computed(() => new Set(state.value.selectedTrackIds))
  const selectedTracks = computed(
    () => drawer.value?.tracks.filter(({ id }) => selectedIds.value.has(id)) ?? [],
  )
  const selectedTracksInOrder = computed(() =>
    state.value.selectedTrackIds.flatMap((id) => {
      const track = drawer.value?.tracks.find((entry) => entry.id === id)
      return track ? [track] : []
    }),
  )
  const batchActions = useTrackBatchActions({
    pickerEditing: editing,
    tracks: selectedTracks,
    queueTracks: selectedTracksInOrder,
    queuedTrackIds: () => new Set(state.value.queuedTrackIds),
    favoriteTrackIds: favoriteIds,
    downloadedTrackIds: () => new Set(state.value.downloadedTrackIds),
    playlists: () => state.value.playlists,
    downloadBusy: () => Boolean(state.value.downloadBusy),
    active: () => props.feature.availability.status === 'available',
    contextKey: () => state.value.activeDrawerId,
    clearSelection: () => props.feature.actions.select([]),
    addToQueue: (tracks) => props.feature.actions.enqueue(tracks.map(({ id }) => id)),
    addToFavorites: (tracks) => {
      for (const { id } of tracks) void props.feature.actions.toggleFavorite(id)
    },
    download,
    addToPlaylist: (playlistId, tracks) =>
      props.feature.actions.addToPlaylist(
        playlistId,
        tracks.map(({ id }) => id),
      ),
  })
  const playlistPickerOpen = batchActions.isPlaylistPickerOpen
  const modalOpen = computed(
    () =>
      discoveryOpen.value ||
      sourcePickerOpen.value ||
      listFilterOpen.value ||
      displayOpen.value ||
      contextOpen.value ||
      Boolean(actionDrawer.value) ||
      Boolean(errorDrawer.value) ||
      Boolean(actionTrack.value) ||
      playlistPickerOpen.value ||
      state.value.filterDraft !== null,
  )
  useCatalogSelectionOperator({
    context: () => state.value.activeDrawerId ?? 'drawers',
    open: operatorOpen,
    clearSelection: () => props.feature.actions.select([]),
  })
  const draft = computed({
    get: () => cloneCatalogTrackFilterState(state.value.filterDraft ?? state.value.filters),
    set: (value: CatalogTrackFilterState) => props.feature.actions.setFilterDraft(value),
  })
  const previewTracks = computed(() =>
    filterCatalogTracks(
      drawer.value?.tracks ?? [],
      state.value.customTagsByTrackId,
      filterPreview.value ?? draft.value,
      state.value.customNamesByTrackId,
    ),
  )
  watch(
    () => state.value.filterDraft,
    () => {
      filterPreview.value = null
    },
  )
  const tagStats = computed(() => {
    const counts = new Map<string, number>()
    for (const track of drawer.value?.tracks ?? [])
      for (const name of state.value.customTagsByTrackId.get(track.id) ?? [])
        counts.set(name, (counts.get(name) ?? 0) + 1)
    return [...counts].map(([name, count]) => ({ name, count }))
  })
  const allVisibleSelected = computed(
    () =>
      state.value.tracks.length > 0 &&
      state.value.tracks.every(({ id }) => selectedIds.value.has(id)),
  )
  function toggleSelected(id: string): void {
    if (!operatorOpen.value) return
    const next = new Set(state.value.selectedTrackIds)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    props.feature.actions.select([...next])
  }
  function toggleAll(): void {
    if (!operatorOpen.value) return
    const next = new Set(state.value.selectedTrackIds)
    for (const { id } of state.value.tracks) {
      if (allVisibleSelected.value) next.delete(id)
      else next.add(id)
    }
    props.feature.actions.select([...next])
  }
  function submit(kind: 'search' | 'import-url'): void {
    if (!source.value?.enabled || props.feature.availability.status !== 'available') return
    if (
      kind === 'search' ? !source.value.capabilities.search : !source.value.capabilities.importUrl
    )
      return
    props.feature.actions.setRequestKind(kind)
    void props.feature.actions.submit()
    discoveryOpen.value = false
  }
  function openFilters(): void {
    if (drawer.value)
      props.feature.actions.setFilterDraft(cloneCatalogTrackFilterState(state.value.filters))
    else listFilterOpen.value = true
  }
  function play(track: Track): void {
    if (!invalidIds.value.has(track.id))
      void props.feature.actions.play(
        track.id,
        state.value.tracks.map(({ id }) => id),
      )
  }
  function download(tracks: readonly Track[]): void {
    const ids = tracks.filter(({ id }) => !invalidIds.value.has(id)).map(({ id }) => id)
    if (ids.length && !state.value.downloadBusy) void props.feature.actions.download(ids)
  }
  function favoriteDrawer(id: string): void {
    if (props.feature.availability.status === 'available')
      void props.feature.actions.favoriteDrawer(id)
  }
  function restoreNames(ids: readonly string[]): void {
    props.feature.actions.restoreTrackNames(ids)
  }

  return {
    state,
    drawerSelectedCount,
    updateDrawerSummary,
    modalOpen,
    editing,
    batchActions,
    discoveryOpen,
    sourcePickerOpen,
    listFilterOpen,
    operatorOpen,
    displayOpen,
    contextOpen,
    actionDrawerId,
    errorDrawerId,
    actionTrackId,
    playlistPickerOpen,
    filterPreview,
    filterDetailOpen,
    drawer,
    source,
    sources,
    actionDrawer,
    errorDrawer,
    viewLoadedTracks,
    closeError,
    actionTrack,
    invalidIds,
    favoriteIds,
    selectedIds,
    selectedTracks,
    draft,
    previewTracks,
    tagStats,
    allVisibleSelected,
    modalTarget,
    operatorTarget,
    toggleSelected,
    toggleAll,
    submit,
    openFilters,
    play,
    download,
    favoriteDrawer,
    restoreNames,
  }
}
