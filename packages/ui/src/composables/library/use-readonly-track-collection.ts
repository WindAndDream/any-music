import type { LibraryTrackRecord } from '@any-music/core'
import { computed, reactive, toValue, watch } from 'vue'
import type { MaybeRefOrGetter } from 'vue'

import type {
  CatalogTrackDisplayMode,
  MobileTrackColumns,
} from '../../components/music-sources/catalog-track-display-mode'
import type {
  CollectionItemStyle,
  TrackDisplayPreferences,
} from '../../product/track-display-preferences'
import { useUiContributionAvailability } from '../../product/ui-contributions'
import {
  cloneCatalogTrackFilterState,
  countCatalogTrackFilters,
  createCatalogTrackFilterState,
  filterCatalogTracks,
  getCatalogTagStats,
} from '../music-sources/use-catalog-track-filters'
import type { CatalogTrackFilterState } from '../music-sources/use-catalog-track-filters'
import { useTrackNames } from '../tracks/use-track-name'
import { editingStateKey, provideEditingSession, useEditingSession } from '../use-editing-session'

interface ReadonlyCollectionState {
  filters: CatalogTrackFilterState
  filterDraft: CatalogTrackFilterState | null
  displayMode: CatalogTrackDisplayMode
  mobileColumns: MobileTrackColumns
  itemStyle: CollectionItemStyle
  displayChosen: boolean
  displayOpen: boolean
}
const collectionKey = editingStateKey<ReadonlyCollectionState>('readonly-track-collection')

/** Browsing cells live in the owning editor; filtering never mutates library records. */
export function useReadonlyTrackCollection(
  records: MaybeRefOrGetter<readonly LibraryTrackRecord[]>,
  defaultDisplayPreferences?: MaybeRefOrGetter<TrackDisplayPreferences | undefined>,
) {
  const editing = useEditingSession('tag-detail-tracks')
  provideEditingSession(editing)
  const view = editing.state(collectionKey, () =>
    reactive<ReadonlyCollectionState>({
      filters: createCatalogTrackFilterState(),
      filterDraft: null,
      displayMode: 'standard',
      mobileColumns: 1,
      itemStyle: 'minimal',
      displayChosen: false,
      displayOpen: false,
    }),
  )
  // Local display choices belong to the browsing session, above either theme's lifetime.
  watch(
    () => toValue(defaultDisplayPreferences),
    (preferences) => {
      if (view.displayChosen) return
      view.displayMode = preferences?.displayMode ?? 'standard'
      view.mobileColumns = preferences?.mobileColumns ?? 1
      view.itemStyle = preferences?.itemStyle ?? 'minimal'
    },
    { immediate: true, flush: 'sync' },
  )
  const { customNamesByTrackId, getDisplayName } = useTrackNames()
  const contribution = useUiContributionAvailability('trackList.filters')
  watch(
    () => contribution.allows('tag-filter'),
    (enabled) => {
      if (enabled) return
      for (const filters of [view.filters, view.filterDraft])
        if (filters?.tags.length) filters.tagsDormant = true
    },
    { immediate: true, flush: 'sync' },
  )
  const tracks = computed(() => toValue(records).map(({ track }) => track))
  const customTags = computed(
    () => new Map(toValue(records).map((record) => [record.track.id, record.customTags])),
  )
  const tagStats = computed(() => getCatalogTagStats(tracks.value, customTags.value))
  const visibleTracks = computed(() => filter(view.filters))
  const filterCount = computed(() => countCatalogTrackFilters(view.filters).total)
  function filter(filters: CatalogTrackFilterState) {
    return filterCatalogTracks(
      tracks.value,
      customTags.value,
      filters,
      customNamesByTrackId.value,
      contribution.allows('tag-filter'),
    )
  }
  function beginFilters() {
    editing.clearScope('filter-panel')
    view.filterDraft = cloneCatalogTrackFilterState(view.filters)
  }
  const actions = {
    setFilterDraft: (value: CatalogTrackFilterState | null) => {
      view.filterDraft = value
    },
    applyFilters: () => {
      if (view.filterDraft) view.filters = cloneCatalogTrackFilterState(view.filterDraft)
      view.filterDraft = null
    },
    cancelFilters: () => {
      view.filterDraft = null
    },
    setDisplayMode: (value: CatalogTrackDisplayMode) => {
      view.displayMode = value
      view.displayChosen = true
    },
    setMobileColumns: (value: MobileTrackColumns) => {
      view.mobileColumns = value
      view.displayChosen = true
    },
    setItemStyle: (value: CollectionItemStyle) => {
      view.itemStyle = value
      view.displayChosen = true
    },
  }
  return {
    editing,
    view,
    tracks,
    customTags,
    tagStats,
    visibleTracks,
    filterCount,
    filter,
    beginFilters,
    actions,
    getDisplayName,
  }
}
