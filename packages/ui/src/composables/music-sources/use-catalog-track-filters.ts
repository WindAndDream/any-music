import type { Track } from '@any-music/core'
import type { ShallowRef } from 'vue'
import { computed, shallowRef, toValue, watch } from 'vue'
import type { MaybeRefOrGetter } from 'vue'

import { useUiContributionAvailability } from '../../product/ui-contributions'
import { editingStateKey, useEditingSession, type EditingSession } from '../use-editing-session'

/** 搜索只有一个关键词，始终同时匹配歌曲名称、作者名称和用户 ID。 */
export interface CatalogTrackSearchFilter {
  query: string
}

export interface CatalogTrackPublishedRangeFilter {
  from: string
  to: string
}

export interface CatalogTrackDurationRangeFilter {
  minMs?: number
  maxMs?: number
}

/** 命名状态互斥；“all”不计入已设置条件。与自定义拼接歌曲的来源类型无关。 */
export type CatalogNamingFilter = 'all' | 'custom' | 'original'

export interface CatalogPlatformStat {
  id: string
  name: string
  count: number
}

/**
 * 搜索数组至多保留一个关键词；其他数组元素可独立添加、展示和移除。同一维度内取并集，
 * 不同维度之间取交集，使多个不相交时间段仍能共同服从搜索、标签和时长条件。
 */
export interface CatalogTrackFilterState {
  searchFilters: readonly CatalogTrackSearchFilter[]
  tags: readonly string[]
  /** Retained user conditions require explicit restoration after feature suspension. */
  tagsDormant?: boolean
  publishedRanges: readonly CatalogTrackPublishedRangeFilter[]
  durationRanges: readonly CatalogTrackDurationRangeFilter[]
  /** 旧持久化快照缺失新字段时等价于不筛选。 */
  platformIds?: readonly string[]
  naming?: CatalogNamingFilter
}

export interface CatalogTrackFilterCounts {
  search: number
  tags: number
  published: number
  duration: number
  platforms: number
  naming: number
  total: number
}

/** 标签筛选器用于展示当前已加载歌曲中的可选标签及命中数量。 */
export interface CatalogTagStat {
  name: string
  count: number
}

/** Count only the supplied identities, including scoped tracks, history rows and playlists. */
export function getCatalogTagStats(
  tracks: readonly Pick<Track, 'id'>[],
  customTagsByTrackId: ReadonlyMap<string, readonly string[]>,
): readonly CatalogTagStat[] {
  const counts = new Map<string, { name: string; count: number }>()
  for (const track of tracks) {
    for (const tag of customTagsByTrackId.get(track.id) ?? []) {
      const key = createSearchKey(tag)
      if (!key) continue
      const existing = counts.get(key)
      if (existing) existing.count += 1
      else counts.set(key, { name: tag, count: 1 })
    }
  }
  return [...counts.values()].toSorted((left, right) => {
    return right.count - left.count || left.name.localeCompare(right.name, 'zh-CN')
  })
}

export function createCatalogTrackFilterState(): CatalogTrackFilterState {
  return {
    searchFilters: [],
    tags: [],
    publishedRanges: [],
    durationRanges: [],
    platformIds: [],
    naming: 'all',
  }
}

/** 创建筛选状态的独立副本，供底部面板安全编辑草稿而不提前改写可见列表。 */
export function cloneCatalogTrackFilterState(
  filters: CatalogTrackFilterState,
): CatalogTrackFilterState {
  return {
    searchFilters: filters.searchFilters.slice(0, 1).map((filter) => ({ query: filter.query })),
    tags: [...filters.tags],
    ...(filters.tagsDormant ? { tagsDormant: true } : {}),
    publishedRanges: filters.publishedRanges.map((range) => ({ ...range })),
    durationRanges: filters.durationRanges.map((range) => ({ ...range })),
    ...(filters.platformIds ? { platformIds: [...filters.platformIds] } : {}),
    ...(filters.naming ? { naming: filters.naming } : {}),
  }
}

export function countCatalogTrackFilters(
  filters: CatalogTrackFilterState,
): CatalogTrackFilterCounts {
  const search = filters.searchFilters[0]?.query.trim() ? 1 : 0
  const tags = filters.tagsDormant ? 0 : filters.tags.length
  const published = filters.publishedRanges.length
  const duration = filters.durationRanges.length
  const platforms = filters.platformIds?.length ?? 0
  const naming = filters.naming && filters.naming !== 'all' ? 1 : 0
  return {
    search,
    tags,
    published,
    duration,
    platforms,
    naming,
    total: search + tags + published + duration + platforms + naming,
  }
}

export function matchesCatalogNaming(
  hasCustomName: boolean,
  naming: CatalogNamingFilter = 'all',
): boolean {
  return naming === 'all' || hasCustomName === (naming === 'custom')
}

/**
 * 纯筛选函数同时服务正式列表和面板草稿预览，确保“预览命中数”与最终应用结果
 * 使用完全相同的并集/交集规则。
 */
export function filterCatalogTracks(
  tracks: readonly Track[],
  customTagsByTrackId: ReadonlyMap<string, readonly string[]>,
  filters: CatalogTrackFilterState,
  customNamesByTrackId: ReadonlyMap<string, string> = new Map(),
  userTagsEnabled = true,
): readonly Track[] {
  const selectedTags = new Set(
    (userTagsEnabled && !filters.tagsDormant ? filters.tags : []).map(createSearchKey),
  )
  const selectedPlatforms = new Set(filters.platformIds)
  const query = createSearchKey(filters.searchFilters[0]?.query ?? '')
  if (
    !query &&
    selectedTags.size === 0 &&
    selectedPlatforms.size === 0 &&
    (!filters.naming || filters.naming === 'all') &&
    filters.publishedRanges.length === 0 &&
    filters.durationRanges.length === 0
  )
    return tracks
  // 与歌曲数量无关的解析只做一次；预览和应用共用同一条短路筛选路径。
  const matchesPublishedDate = createCatalogDateRangeMatcher(filters.publishedRanges)

  return tracks.filter((track) => {
    const customName = customNamesByTrackId.get(track.id)
    if (selectedPlatforms.size > 0 && !selectedPlatforms.has(track.source.pluginId)) return false
    if (!matchesCatalogNaming(Boolean(customName), filters.naming)) return false
    if (
      query &&
      !matchesSearchFilter(
        track,
        query,
        customName,
        userTagsEnabled ? customTagsByTrackId.get(track.id) : [],
      )
    ) {
      return false
    }

    if (selectedTags.size > 0) {
      const trackTags = customTagsByTrackId.get(track.id) ?? []
      if (!trackTags.some((tag) => selectedTags.has(createSearchKey(tag)))) return false
    }

    if (filters.publishedRanges.length > 0 && !matchesPublishedDate(track.publishedAtMs)) {
      return false
    }

    if (
      filters.durationRanges.length > 0 &&
      !filters.durationRanges.some((range) => isWithinDurationRange(track.durationMs, range))
    ) {
      return false
    }

    return true
  })
}

/**
 * 搜索或导入结果只在已加载 Track 上即时派生可见集合；状态不会写回来源配方，
 * 因而筛选不会改变分页身份、来源顺序或短时媒体解析契约。
 */
export function useCatalogTrackFilters(
  trackSource: MaybeRefOrGetter<readonly Track[]>,
  customTagSource: MaybeRefOrGetter<ReadonlyMap<string, readonly string[]>>,
  customNameSource: MaybeRefOrGetter<ReadonlyMap<string, string>> = new Map(),
  editing: EditingSession = useEditingSession(),
) {
  const contribution = useUiContributionAvailability('trackList.filters')
  const filters = editing.state(filtersKey, () =>
    shallowRef<CatalogTrackFilterState>(createCatalogTrackFilterState()),
  )
  watch(
    [() => contribution.allows('tag-filter'), filters],
    ([available]) => {
      if (!available && filters.value.tags.length && !filters.value.tagsDormant)
        filters.value = { ...filters.value, tagsDormant: true }
    },
    { immediate: true, flush: 'sync' },
  )
  const filterCounts = computed(() => countCatalogTrackFilters(filters.value))
  const visibleTracks = computed(() =>
    filterCatalogTracks(
      toValue(trackSource),
      toValue(customTagSource),
      filters.value,
      toValue(customNameSource),
      contribution.allows('tag-filter'),
    ),
  )
  const tagStats = computed<readonly CatalogTagStat[]>(() => {
    if (!contribution.allows('tag-filter')) return []
    return getCatalogTagStats(toValue(trackSource), toValue(customTagSource))
  })

  return {
    filters,
    filterCounts,
    visibleTracks,
    tagStats,
    userTagsEnabled: computed(() => contribution.allows('tag-filter')),
  }
}

function matchesSearchFilter(
  track: Track,
  query: string,
  customName?: string,
  userTags: readonly string[] = [],
): boolean {
  return (
    [...(track.sourceTags ?? []), ...userTags].some((tag) =>
      createSearchKey(tag).includes(query),
    ) ||
    createSearchKey(track.title).includes(query) ||
    createSearchKey(customName ?? '').includes(query) ||
    track.artists.some(
      (artist) =>
        createSearchKey(artist.name).includes(query) ||
        createSearchKey(artist.id ?? '').includes(query),
    )
  )
}

/** 歌曲发布时间和列表搜索时间共用本地日历边界；结束日期包含当天，未知时间不匹配。 */
export function isWithinCatalogDateRange(
  publishedAtMs: number | undefined,
  range: CatalogTrackPublishedRangeFilter,
): boolean {
  return isWithinDateBounds(publishedAtMs, {
    fromMs: readLocalDateStart(range.from),
    beforeMs: readLocalDateEnd(range.to),
  })
}

/** 每次筛选先编译日期边界，避免为每个候选项重复解析同一组日期。 */
export function createCatalogDateRangeMatcher(
  ranges: readonly CatalogTrackPublishedRangeFilter[],
): (timestamp: number | undefined) => boolean {
  const bounds = ranges.map((range) => ({
    fromMs: readLocalDateStart(range.from),
    beforeMs: readLocalDateEnd(range.to),
  }))
  return (timestamp) =>
    bounds.length === 0 || bounds.some((range) => isWithinDateBounds(timestamp, range))
}

function isWithinDateBounds(
  publishedAtMs: number | undefined,
  { fromMs, beforeMs }: { fromMs?: number; beforeMs?: number },
): boolean {
  if (publishedAtMs === undefined || !Number.isFinite(publishedAtMs)) return false
  if (fromMs !== undefined && publishedAtMs < fromMs) return false
  if (beforeMs !== undefined && publishedAtMs >= beforeMs) return false
  return fromMs !== undefined || beforeMs !== undefined
}

function isWithinDurationRange(
  durationMs: number | undefined,
  range: CatalogTrackDurationRangeFilter,
): boolean {
  if (durationMs === undefined || !Number.isFinite(durationMs)) return false
  if (range.minMs !== undefined && durationMs < range.minMs) return false
  if (range.maxMs !== undefined && durationMs > range.maxMs) return false
  return range.minMs !== undefined || range.maxMs !== undefined
}

function createSearchKey(value: string): string {
  return value.normalize('NFKC').trim().toLocaleLowerCase()
}

function readLocalDateStart(input: string): number | undefined {
  const parts = readDateParts(input)
  return parts ? new Date(parts.year, parts.monthIndex, parts.day).getTime() : undefined
}

function readLocalDateEnd(input: string): number | undefined {
  const parts = readDateParts(input)
  return parts ? new Date(parts.year, parts.monthIndex, parts.day + 1).getTime() : undefined
}

function readDateParts(
  input: string,
): { year: number; monthIndex: number; day: number } | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(input)
  if (!match) return undefined
  return {
    year: Number(match[1]),
    monthIndex: Number(match[2]) - 1,
    day: Number(match[3]),
  }
}

const filtersKey = editingStateKey<ShallowRef<CatalogTrackFilterState>>(
  'composables/music-sources/use-catalog-track-filters.ts:filters',
)
