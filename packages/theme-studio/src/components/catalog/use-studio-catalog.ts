import { cloneCatalogTrackFilterState } from '@any-music/ui/catalog'
import type { UiThemeFeatureMap } from '@any-music/ui/theme'
import { computed } from 'vue'

/** Derived presentation only; the host retains selection, filters and request admission. */
export function useStudioCatalog(props: Readonly<{ feature: UiThemeFeatureMap['catalog'] }>) {
  const state = computed(() => props.feature.state)
  const drawer = computed(() =>
    state.value.drawers.find((entry) => entry.id === state.value.activeDrawerId),
  )
  const selectedIds = computed(() => new Set(state.value.selectedTrackIds))
  const invalidIds = computed(() => new Set(state.value.invalidTrackIds))
  const favoriteIds = computed(() => new Set(state.value.favoriteTrackIds))
  const queuedIds = computed(() => new Set(state.value.queuedTrackIds))
  const allSelected = computed(
    () =>
      state.value.tracks.length > 0 &&
      state.value.tracks.every((track) => selectedIds.value.has(track.id)),
  )
  const canLoadMore = computed(
    () =>
      props.feature.availability.status === 'available' &&
      Boolean(
        drawer.value?.isSourceEnabled &&
        drawer.value.hasMore &&
        !drawer.value.isLoading &&
        !drawer.value.errorMessage &&
        !['error', 'invalid', 'disconnected', 'missing'].includes(drawer.value.status),
      ),
  )
  function toggle(id: string): void {
    props.feature.actions.select(
      selectedIds.value.has(id)
        ? state.value.selectedTrackIds.filter((entry) => entry !== id)
        : [...state.value.selectedTrackIds, id],
    )
  }
  function toggleAll(): void {
    const visible = new Set(state.value.tracks.map((track) => track.id))
    props.feature.actions.select(
      allSelected.value
        ? state.value.selectedTrackIds.filter((id) => !visible.has(id))
        : [...new Set([...state.value.selectedTrackIds, ...visible])],
    )
  }
  function openFilters(): void {
    props.feature.actions.setFilterDraft(cloneCatalogTrackFilterState(state.value.filters))
  }
  function setFilterQuery(query: string): void {
    if (!state.value.filterDraft) return
    props.feature.actions.setFilterDraft({
      ...cloneCatalogTrackFilterState(state.value.filterDraft),
      searchFilters: query ? [{ query }] : [],
    })
  }
  function loadMore(): void {
    if (canLoadMore.value && drawer.value) void props.feature.actions.loadMore(drawer.value.id)
  }
  return {
    state,
    drawer,
    selectedIds,
    invalidIds,
    favoriteIds,
    queuedIds,
    allSelected,
    canLoadMore,
    toggle,
    toggleAll,
    openFilters,
    setFilterQuery,
    loadMore,
  }
}
