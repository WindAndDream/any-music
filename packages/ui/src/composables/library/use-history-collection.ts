import type { PlaybackHistoryEntry, Track } from '@any-music/core'
import { computed, getCurrentInstance, shallowRef, toValue, watch } from 'vue'
import type { MaybeRefOrGetter, ShallowRef } from 'vue'

import type {
  CatalogTrackDisplayMode,
  MobileTrackColumns,
} from '../../components/music-sources/catalog-track-display-mode'
import { useUiContributionAvailability } from '../../product/ui-contributions'
import { useCatalogSelectionOperator } from '../music-sources/use-catalog-selection-operator'
import {
  cloneCatalogTrackFilterState,
  createCatalogTrackFilterState,
  getCatalogTagStats,
} from '../music-sources/use-catalog-track-filters'
import type { CatalogTrackFilterState } from '../music-sources/use-catalog-track-filters'
import { filterQueueTracks } from '../music-sources/use-queue-list-controls'
import { editingStateKey, provideEditingSession, useEditingSession } from '../use-editing-session'

/** A history row is identified by its playback, even when another row has the same track. */
export function useHistoryCollection(options: {
  entries: MaybeRefOrGetter<readonly PlaybackHistoryEntry[]>
  tracks: MaybeRefOrGetter<readonly Track[]>
  names: MaybeRefOrGetter<ReadonlyMap<string, string>>
  customTags?: MaybeRefOrGetter<ReadonlyMap<string, readonly string[]>>
}) {
  const contribution = useUiContributionAvailability('trackList.filters')
  const editing = useEditingSession('history:tracks')
  if (getCurrentInstance()) provideEditingSession(editing)
  const state = editing.state(historyCollectionKey, () => ({
    filters: shallowRef(createCatalogTrackFilterState()),
    draft: shallowRef<CatalogTrackFilterState | null>(null),
    selectedIds: shallowRef<readonly string[]>([]),
    arrangement: shallowRef<'flat' | 'platform'>('flat'),
    activePlatform: shallowRef<string | null>(null),
    operatorOpen: shallowRef(false),
    displayMode: shallowRef<CatalogTrackDisplayMode>('standard'),
    mobileColumns: shallowRef<MobileTrackColumns>(1),
  }))
  const rows = computed(() => {
    const tracks = new Map(toValue(options.tracks).map((track) => [track.id, track]))
    return toValue(options.entries).flatMap((entry) => {
      const track = tracks.get(entry.trackId)
      return track ? [{ entry, track }] : []
    })
  })
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
  const scopedRows = computed(() =>
    rows.value.filter(
      ({ track }) =>
        state.activePlatform.value === null || track.source.pluginId === state.activePlatform.value,
    ),
  )
  const tagStats = computed(() =>
    getCatalogTagStats(
      scopedRows.value.map(({ track }) => track),
      toValue(options.customTags) ?? new Map(),
    ),
  )
  function filterRows(filters: CatalogTrackFilterState) {
    return rows.value.filter(
      ({ entry, track }) =>
        filterQueueTracks(
          [track],
          filters,
          new Map([[track.id, entry.startedAtMs]]),
          toValue(options.names),
          toValue(options.customTags) ?? new Map(),
          contribution.allows('tag-filter'),
        ).length > 0,
    )
  }
  const filtered = computed(() => filterRows(state.filters.value))
  const visible = computed(() =>
    state.activePlatform.value === null
      ? filtered.value
      : filtered.value.filter(({ track }) => track.source.pluginId === state.activePlatform.value),
  )
  const selected = computed(() =>
    visible.value.filter(({ entry }) => state.selectedIds.value.includes(entry.id)),
  )
  const allSelected = computed(
    () => visible.value.length > 0 && selected.value.length === visible.value.length,
  )
  useCatalogSelectionOperator({
    context: 'history:tracks',
    open: state.operatorOpen,
    clearSelection: () => {
      state.selectedIds.value = []
    },
  })
  watch(rows, (items) => {
    const ids = new Set(items.map(({ entry }) => entry.id))
    state.selectedIds.value = state.selectedIds.value.filter((id) => ids.has(id))
  })
  function select(id: string) {
    if (!state.operatorOpen.value) return
    const ids = new Set(state.selectedIds.value)
    if (ids.has(id)) ids.delete(id)
    else ids.add(id)
    state.selectedIds.value = [...ids]
  }
  function toggleAll() {
    if (!state.operatorOpen.value) return
    const ids = new Set(state.selectedIds.value)
    for (const { entry } of visible.value) {
      if (allSelected.value) ids.delete(entry.id)
      else ids.add(entry.id)
    }
    state.selectedIds.value = [...ids]
  }
  function togglePlatform(platformId: string) {
    if (!state.operatorOpen.value) return
    const entries = filtered.value.filter(({ track }) => track.source.pluginId === platformId)
    const ids = new Set(state.selectedIds.value)
    const all = entries.every(({ entry }) => ids.has(entry.id))
    for (const { entry } of entries) {
      if (all) ids.delete(entry.id)
      else ids.add(entry.id)
    }
    state.selectedIds.value = [...ids]
  }
  function setArrangement(mode: 'flat' | 'platform') {
    state.arrangement.value = mode
    state.activePlatform.value = null
  }
  function applyFilters() {
    if (!state.draft.value) return
    state.filters.value = cloneCatalogTrackFilterState(state.draft.value)
    state.draft.value = null
    const ids = new Set(filterRows(state.filters.value).map(({ entry }) => entry.id))
    state.selectedIds.value = state.selectedIds.value.filter((id) => ids.has(id))
  }
  return {
    editing,
    ...state,
    rows,
    scopedRows,
    tagStats,
    filtered,
    visible,
    selected,
    allSelected,
    filterRows,
    select,
    toggleAll,
    togglePlatform,
    setArrangement,
    applyFilters,
  }
}

const historyCollectionKey = editingStateKey<{
  filters: ShallowRef<CatalogTrackFilterState>
  draft: ShallowRef<CatalogTrackFilterState | null>
  selectedIds: ShallowRef<readonly string[]>
  arrangement: ShallowRef<'flat' | 'platform'>
  activePlatform: ShallowRef<string | null>
  operatorOpen: ShallowRef<boolean>
  displayMode: ShallowRef<CatalogTrackDisplayMode>
  mobileColumns: ShallowRef<MobileTrackColumns>
}>('history-collection')
