import type { DownloadHistoryBatch, DownloadHistoryItem } from '@any-music/core'
import { formatAppErrorMessage, deduplicateDownloadBatches } from '@any-music/core'
import type { ShallowRef } from 'vue'
import { computed, shallowRef, toValue, watch } from 'vue'
import type { MaybeRefOrGetter } from 'vue'

import { useUiContributionAvailability } from '../../product/ui-contributions'
import { useFilterDraft } from '../filters/use-filter-draft'
import { useCatalogListControls } from '../music-sources/use-catalog-list-controls'
import {
  cloneCatalogTrackFilterState,
  countCatalogTrackFilters,
  createCatalogTrackFilterState,
  getCatalogTagStats,
} from '../music-sources/use-catalog-track-filters'
import { filterQueueTracks } from '../music-sources/use-queue-list-controls'
import { editingStateKey, useEditingSession } from '../use-editing-session'

export type DownloadListState = 'downloading' | 'paused' | 'succeeded' | 'failed'
export type DownloadListFilter = 'all' | DownloadListState
export interface DownloadListEntry {
  item: DownloadHistoryItem
  batch: DownloadHistoryBatch
  state: DownloadListState
  saving: boolean
}

export function getDownloadListState(
  item: DownloadHistoryItem,
  batch: DownloadHistoryBatch,
): DownloadListState {
  if (item.status === 'succeeded')
    return item.savedAtMs !== undefined
      ? 'succeeded'
      : batch.archiveError || batch.status === 'cancelled' || batch.status === 'interrupted'
        ? 'failed'
        : batch.status === 'running'
          ? 'downloading'
          : 'succeeded'
  if (item.status === 'queued' || item.status === 'downloading') return 'downloading'
  if (item.status === 'paused' || item.status === 'cancelled') return 'paused'
  return 'failed'
}

/** Task errors include the batch save failure only when that task is in a failed state. */
export function getDownloadEntryError(entry: DownloadListEntry): string | undefined {
  const error =
    entry.item.error ?? (entry.state === 'failed' ? entry.batch.archiveError : undefined)
  return error ? formatAppErrorMessage(error) : undefined
}

/** Canonical song deduplication and task-save projection shared by all controlled download views. */
export function getDownloadListEntries(
  batches: readonly DownloadHistoryBatch[],
  itemOrder: readonly string[] = [],
): readonly DownloadListEntry[] {
  const entries = deduplicateDownloadBatches(batches).flatMap((batch) =>
    batch.items.map((item) => ({
      item,
      batch,
      state: getDownloadListState(item, batch),
      saving:
        item.status === 'succeeded' && item.savedAtMs === undefined && batch.status === 'running',
    })),
  )
  if (!itemOrder.length) return entries
  const ranks = new Map(itemOrder.map((id, index) => [id, index]))
  return entries.toSorted((a, b) => (ranks.get(a.item.id) ?? -1) - (ranks.get(b.item.id) ?? -1))
}

/** One visible record per song; item identity stays stable across repeated submissions. */
export function useDownloadListControls(options: {
  batches: MaybeRefOrGetter<readonly DownloadHistoryBatch[]>
  filterOpen: MaybeRefOrGetter<boolean>
  platformNames: MaybeRefOrGetter<ReadonlyMap<string, string>>
  customTags?: MaybeRefOrGetter<ReadonlyMap<string, readonly string[]>>
}) {
  const editing = useEditingSession('downloads')
  const contribution = useUiContributionAvailability('trackList.filters')
  const status = editing.state(statusKey, () => shallowRef<DownloadListFilter>('all'))
  const filters = editing.state(filtersKey, () => shallowRef(createCatalogTrackFilterState()))
  watch(
    [() => contribution.allows('tag-filter'), filters],
    ([available]) => {
      if (!available && filters.value.tags.length && !filters.value.tagsDormant)
        filters.value = { ...filters.value, tagsDormant: true }
    },
    { immediate: true, flush: 'sync' },
  )
  const entries = computed(() => getDownloadListEntries(toValue(options.batches)))
  const counts = computed(() => {
    const result = { all: entries.value.length, downloading: 0, paused: 0, succeeded: 0, failed: 0 }
    for (const entry of entries.value) result[entry.state] += 1
    return result
  })
  const scopedEntries = computed(() =>
    entries.value.filter((entry) => status.value === 'all' || entry.state === status.value),
  )
  const tracks = computed(() =>
    scopedEntries.value.map(({ item }) => ({ ...item.track, id: item.id })),
  )
  const dates = computed(
    () => new Map(scopedEntries.value.map(({ item }) => [item.id, item.requestedAtMs])),
  )
  // Download predicates use task IDs; tag associations retain stable song IDs.
  const customTags = computed(
    () =>
      new Map(
        scopedEntries.value.map(({ item }) => [
          item.id,
          toValue(options.customTags)?.get(item.track.id) ?? [],
        ]),
      ),
  )
  const tagStats = computed(() => getCatalogTagStats(tracks.value, customTags.value))
  const match = (filter: typeof filters.value) => {
    const ids = new Set(
      filterQueueTracks(
        tracks.value,
        filter,
        dates.value,
        new Map(),
        customTags.value,
        contribution.allows('tag-filter'),
      ).map((track) => track.id),
    )
    return scopedEntries.value.filter(({ item }) => ids.has(item.id))
  }
  const visibleEntries = computed(() => match(filters.value))
  const draft = useFilterDraft({
    editing,
    applied: filters,
    open: options.filterOpen,
    clone: cloneCatalogTrackFilterState,
    apply: (next) => {
      filters.value = next
    },
  })
  const previewEntries = computed(() => match(draft.preview.value))
  const selection = useCatalogListControls({
    editing,
    items: visibleEntries,
    getId: ({ item }) => item.id,
    getName: ({ item }) => item.track.title,
  })
  const selectedEntries = computed(() =>
    visibleEntries.value.filter(({ item }) => selection.selectedIds.value.has(item.id)),
  )
  const resumableIds = computed(() =>
    selectedEntries.value.filter(({ state }) => state !== 'downloading').map(({ item }) => item.id),
  )
  const pausableIds = computed(() =>
    selectedEntries.value
      .filter(({ state, saving }) => state === 'downloading' && !saving)
      .map(({ item }) => item.id),
  )
  const removableIds = computed(() =>
    selectedEntries.value.filter(({ state }) => state !== 'downloading').map(({ item }) => item.id),
  )
  const cancellableIds = computed(() =>
    selectedEntries.value
      .filter(
        ({ item, state, saving }) =>
          !saving && (state === 'downloading' || item.status === 'paused'),
      )
      .map(({ item }) => item.id),
  )
  const actionLabel = computed(() => {
    const states = new Set(selectedEntries.value.map(({ state }) => state))
    if (status.value === 'paused' || (states.size === 1 && states.has('paused'))) return '继续下载'
    if (
      status.value === 'failed' ||
      status.value === 'succeeded' ||
      (states.size === 1 && (states.has('failed') || states.has('succeeded')))
    )
      return '重新下载'
    return '下载'
  })
  const filterCount = computed(() => countCatalogTrackFilters(filters.value).total)
  const summary = computed(() => ({
    selectedCount: selection.selectedCount.value,
    visibleCount: visibleEntries.value.length,
    totalCount: scopedEntries.value.length,
    filterCount: filterCount.value,
  }))
  const platformStats = computed(() => {
    const platformCounts = new Map<string, number>()
    for (const { item } of scopedEntries.value)
      platformCounts.set(
        item.track.source.pluginId,
        (platformCounts.get(item.track.source.pluginId) ?? 0) + 1,
      )
    return [...platformCounts].map(([id, count]) => ({
      id,
      count,
      name: toValue(options.platformNames).get(id) ?? id,
    }))
  })
  return {
    status,
    entries,
    counts,
    filters,
    draft,
    scopedEntries,
    visibleEntries,
    previewEntries,
    selection,
    selectedEntries,
    resumableIds,
    pausableIds,
    cancellableIds,
    removableIds,
    actionLabel,
    summary,
    platformStats,
    tagStats,
  }
}

const statusKey = editingStateKey<ShallowRef<DownloadListFilter>>(
  'composables/downloads/use-download-list-controls.ts:status',
)
const filtersKey = editingStateKey<ShallowRef<ReturnType<typeof createCatalogTrackFilterState>>>(
  'composables/downloads/use-download-list-controls.ts:filters',
)
