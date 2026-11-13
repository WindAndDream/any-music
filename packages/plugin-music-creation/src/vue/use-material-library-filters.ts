import type { LibraryTrackRecord, MaterialCollection } from '@any-music/core'
import { editingStateKey, useEditingSession, type EditingSession } from '@any-music/ui'
import { CUSTOM_TRACK_PLATFORM_ID, useUiContributionAvailability } from '@any-music/ui'
import type { MusicPlatformOption } from '@any-music/ui'
import type { ShallowRef } from 'vue'
import { computed, shallowRef, watch } from 'vue'

export type MaterialMembershipFilter = 'all' | 'included' | 'available'
export type MaterialTrackKindFilter = 'all' | 'regular' | 'custom'
export type MaterialSortMode = 'updated' | 'title' | 'duration'

import type { MaterialLibraryFilterState } from '@any-music/ui/theme'
export type { MaterialLibraryFilterState } from '@any-music/ui/theme'

/** 素材筛选独立于编辑器，避免筛选状态与时间线配方互相污染。 */
export function useMaterialLibraryFilters(
  getRecords: () => readonly LibraryTrackRecord[],
  getCollection: () => MaterialCollection | undefined,
  getPlatforms: () => readonly MusicPlatformOption[],
  editing: EditingSession = useEditingSession(),
) {
  const tagContribution = useUiContributionAvailability('trackList.filters')
  const filters = editing.state(filtersKey, () =>
    shallowRef<MaterialLibraryFilterState>({
      query: '',
      platformId: '',
      tag: '',
      // 进入合集后优先回答“当前可创作的素材有哪些”，全部资料库仍可由筛选项显式切换。
      membership: 'included',
      trackKind: 'all',
      sortMode: 'updated',
    }),
  )

  watch(
    [() => tagContribution.allows('tag-filter'), filters],
    ([available]) => {
      if (!available && filters.value.tag && !filters.value.tagsDormant)
        filters.value = { ...filters.value, tagsDormant: true }
    },
    { immediate: true, flush: 'sync' },
  )
  const collectionTrackIds = computed<ReadonlySet<string>>(
    () => new Set(getCollection()?.trackIds ?? []),
  )
  const platformOptions = computed(() => {
    const names = new Map(getPlatforms().map((platform) => [platform.id, platform.name]))
    names.set(CUSTOM_TRACK_PLATFORM_ID, '自定义拼接音乐')
    const counts = new Map<string, number>()
    for (const record of getRecords()) {
      const platformId = record.track.source.pluginId
      names.set(platformId, names.get(platformId) ?? platformId)
      counts.set(platformId, (counts.get(platformId) ?? 0) + 1)
    }
    return [...names].map(([id, name]) => ({ id, name, count: counts.get(id) ?? 0 }))
  })
  const tagStats = computed(() => {
    const counts = new Map<string, { name: string; count: number }>()
    for (const record of getRecords()) {
      for (const tag of record.customTags) {
        const key = createSearchKey(tag)
        const current = counts.get(key)
        if (current) current.count += 1
        else counts.set(key, { name: tag, count: 1 })
      }
    }
    return [...counts.values()].toSorted(
      (left, right) => right.count - left.count || left.name.localeCompare(right.name, 'zh-CN'),
    )
  })
  const visibleRecords = computed(() => {
    const state = filters.value
    const searchKey = createSearchKey(state.query)
    return getRecords()
      .filter((record) => {
        const isIncluded = collectionTrackIds.value.has(record.track.id)
        const isCustom = record.track.source.mediaKind === 'custom'
        if (state.membership === 'included' && !isIncluded) return false
        if (state.membership === 'available' && isIncluded) return false
        if (state.trackKind === 'regular' && isCustom) return false
        if (state.trackKind === 'custom' && !isCustom) return false
        if (state.platformId && record.track.source.pluginId !== state.platformId) return false
        if (
          tagContribution.allows('tag-filter') &&
          !state.tagsDormant &&
          state.tag &&
          !record.customTags.some((tag) => createSearchKey(tag) === createSearchKey(state.tag))
        ) {
          return false
        }
        if (!searchKey) return true
        return createSearchKey(
          [
            record.track.title,
            record.customName ?? '',
            ...record.track.artists.map((artist) => artist.name),
            ...(tagContribution.allows('tag-filter') ? record.customTags : []),
            ...(record.track.sourceTags ?? []),
          ].join('\n'),
        ).includes(searchKey)
      })
      .toSorted((left, right) => compareRecords(left, right, state.sortMode))
  })

  /** 程序化归档或切换合集时只清除搜索词，不覆盖用户主动选择的平台、标签和素材类型。 */
  function showCurrentCollectionRecords(): void {
    filters.value = { ...filters.value, query: '', membership: 'included' }
  }

  return {
    filters,
    visibleRecords,
    collectionTrackIds,
    platformOptions,
    tagStats,
    showCurrentCollectionRecords,
  }
}

function compareRecords(
  left: LibraryTrackRecord,
  right: LibraryTrackRecord,
  mode: MaterialSortMode,
): number {
  if (mode === 'title')
    return (left.customName ?? left.track.title).localeCompare(
      right.customName ?? right.track.title,
      'zh-CN',
    )
  if (mode === 'duration') {
    return (right.track.durationMs ?? -1) - (left.track.durationMs ?? -1)
  }
  return right.updatedAtMs - left.updatedAtMs
}

function createSearchKey(value: string): string {
  return value.normalize('NFKC').trim().toLocaleLowerCase()
}

const filtersKey = editingStateKey<ShallowRef<MaterialLibraryFilterState>>(
  'use-material-library-filters.ts:filters',
)
