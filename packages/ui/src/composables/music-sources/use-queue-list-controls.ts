import type { Track } from '@any-music/core'
import type { ShallowRef } from 'vue'
import { computed, shallowRef, toValue, watch } from 'vue'
import type { MaybeRefOrGetter } from 'vue'

import { useUiContributionAvailability } from '../../product/ui-contributions'
import { useFilterDraft } from '../filters/use-filter-draft'
import { useTrackNames } from '../tracks/use-track-name'
import { editingStateKey, useEditingSession, type EditingSession } from '../use-editing-session'
import { useCatalogListControls } from './use-catalog-list-controls'
import {
  cloneCatalogTrackFilterState,
  countCatalogTrackFilters,
  createCatalogDateRangeMatcher,
  createCatalogTrackFilterState,
  filterCatalogTracks,
  getCatalogTagStats,
  type CatalogTrackFilterState,
} from './use-catalog-track-filters'

export interface QueueListSummary {
  selectedCount: number
  visibleCount: number
  totalCount: number
  filterCount: number
}

/** 待听日期指入队日期，不能用来源发布时间或资料库添加时间代替。 */
export function filterQueueTracks(
  tracks: readonly Track[],
  filters: CatalogTrackFilterState,
  addedAtMsByTrackId: ReadonlyMap<string, number>,
  customNames: ReadonlyMap<string, string> = new Map(),
  customTags: ReadonlyMap<string, readonly string[]> = new Map(),
  userTagsEnabled = true,
): readonly Track[] {
  const matching = filterCatalogTracks(
    tracks,
    customTags,
    { ...filters, publishedRanges: [] },
    customNames,
    userTagsEnabled,
  )
  if (filters.publishedRanges.length === 0) return matching
  const matchesDate = createCatalogDateRangeMatcher(filters.publishedRanges)
  return matching.filter((track) => matchesDate(addedAtMsByTrackId.get(track.id)))
}

/** 筛选只派生可见集合；选择跟随可见结果，排序仍由业务队列维护完整顺序。 */
export function useQueueListControls(options: {
  editing?: EditingSession
  items: MaybeRefOrGetter<readonly Track[]>
  addedAtMsByTrackId: MaybeRefOrGetter<ReadonlyMap<string, number>>
  platformNames: MaybeRefOrGetter<ReadonlyMap<string, string>>
  filterOpen: MaybeRefOrGetter<boolean>
  platformId?: MaybeRefOrGetter<string | undefined>
  customTags?: MaybeRefOrGetter<ReadonlyMap<string, readonly string[]>>
}) {
  const editing = options.editing ?? useEditingSession()
  const tagContribution = useUiContributionAvailability('trackList.filters')
  const { customNamesByTrackId } = useTrackNames()
  const filters = editing.state(filtersKey, () => shallowRef(createCatalogTrackFilterState()))
  watch(
    [() => tagContribution.allows('tag-filter'), filters],
    ([available]) => {
      if (!available && filters.value.tags.length && !filters.value.tagsDormant)
        filters.value = { ...filters.value, tagsDormant: true }
    },
    { immediate: true, flush: 'sync' },
  )
  const filterCounts = computed(() => countCatalogTrackFilters(filters.value))
  const visibleTracks = computed(() =>
    filterQueueTracks(
      toValue(options.items),
      filters.value,
      toValue(options.addedAtMsByTrackId),
      customNamesByTrackId.value,
      toValue(options.customTags) ?? new Map(),
      tagContribution.allows('tag-filter'),
    ),
  )
  const draft = useFilterDraft({
    editing,
    applied: filters,
    open: options.filterOpen,
    clone: cloneCatalogTrackFilterState,
    apply: (next) => {
      filters.value = next
    },
  })
  const scopeTracks = (tracks: readonly Track[]) => {
    const platformId = toValue(options.platformId)
    return platformId === undefined
      ? tracks
      : tracks.filter((track) => track.source.pluginId === platformId)
  }
  // 集合详情的选择、批量操作和摘要仅作用于当前平台；概览筛选仍保留完整匹配集合。
  const displayedTracks = computed(() => scopeTracks(visibleTracks.value))
  const scopedItems = computed(() => scopeTracks(toValue(options.items)))
  const tagStats = computed(() =>
    getCatalogTagStats(scopedItems.value, toValue(options.customTags) ?? new Map()),
  )
  const previewTracks = computed(() =>
    filterQueueTracks(
      scopedItems.value,
      draft.preview.value,
      toValue(options.addedAtMsByTrackId),
      customNamesByTrackId.value,
      toValue(options.customTags) ?? new Map(),
      tagContribution.allows('tag-filter'),
    ),
  )
  const selection = useCatalogListControls({
    editing,
    items: displayedTracks,
    getId: (track) => track.id,
    getName: (track) => track.title,
  })
  const selectedTracks = computed(() =>
    displayedTracks.value.filter((track) => selection.selectedIds.value.has(track.id)),
  )
  // 平台勾选是当前匹配歌曲选择状态的投影，与全部歌曲和详情共用同一份选择。
  const platformSelection = computed(() => {
    const groups = new Map<string, { trackIds: string[]; selectedCount: number }>()
    for (const track of displayedTracks.value) {
      const id = track.source.pluginId
      const group = groups.get(id) ?? { trackIds: [], selectedCount: 0 }
      group.trackIds.push(track.id)
      if (selection.selectedIds.value.has(track.id)) group.selectedCount += 1
      groups.set(id, group)
    }
    return new Map(
      [...groups].map(([id, group]) => [
        id,
        {
          trackIds: group.trackIds,
          selected: group.selectedCount === group.trackIds.length,
          indeterminate: group.selectedCount > 0 && group.selectedCount < group.trackIds.length,
        },
      ]),
    )
  })
  function togglePlatform(id: string): void {
    const group = platformSelection.value.get(id)
    if (!group) return
    for (const trackId of group.trackIds) {
      if (selection.selectedIds.value.has(trackId) === group.selected) selection.toggleItem(trackId)
    }
  }
  const platformStats = computed(() => {
    const groups = new Map<string, { count: number; isCustom: boolean }>()
    for (const track of toValue(options.items)) {
      const id = track.source.pluginId
      const group = groups.get(id) ?? { count: 0, isCustom: false }
      group.count += 1
      // 本地拼接身份来自媒体类型，不能用音乐源的显示名称识别。
      group.isCustom ||= track.source.mediaKind === 'custom'
      groups.set(id, group)
    }
    const names = toValue(options.platformNames)
    return [...groups].map(([id, group]) => ({
      id,
      name: group.isCustom ? '自定义音乐' : (names.get(id) ?? id),
      count: group.count,
      isCustom: group.isCustom,
    }))
  })
  const summary = computed<QueueListSummary>(() => ({
    selectedCount: selection.selectedCount.value,
    visibleCount: displayedTracks.value.length,
    totalCount: scopedItems.value.length,
    filterCount: filterCounts.value.total,
  }))
  return {
    filters,
    filterCounts,
    visibleTracks,
    displayedTracks,
    scopedItems,
    draft,
    previewTracks,
    selection,
    selectedTracks,
    platformSelection,
    togglePlatform,
    platformStats,
    tagStats,
    summary,
  }
}

const filtersKey = editingStateKey<ShallowRef<ReturnType<typeof createCatalogTrackFilterState>>>(
  'composables/music-sources/use-queue-list-controls.ts:filters',
)
