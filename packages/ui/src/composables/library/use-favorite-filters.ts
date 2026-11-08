import { filterFavoriteRecords } from '@any-music/core'
import type { CustomTrackDefinition, LibraryTrackRecord } from '@any-music/core'
import { computed, shallowRef, toValue, watch } from 'vue'
import type { MaybeRefOrGetter } from 'vue'

import { useUiContributionAvailability } from '../../product/ui-contributions'

export const CUSTOM_TRACK_PLATFORM_ID = 'local-custom'

export type FavoriteArrangementMode = 'collapsed' | 'mixed'

export interface FavoriteFilterState {
  selectedPlatformIds: readonly string[]
  arrangementMode: FavoriteArrangementMode
  titleQuery: string
  artistQuery: string
  regularPublishedFrom: string
  regularPublishedTo: string
  tagsDormant?: boolean
  regularTag: string
  customCreatedFrom: string
  customCreatedTo: string
}

export interface MusicPlatformOption {
  id: string
  name: string
}

export interface FavoritePlatformOption extends MusicPlatformOption {
  count: number
  isCustom: boolean
}

export interface FavoritePlatformDrawer {
  platform: FavoritePlatformOption
  records: readonly LibraryTrackRecord[]
}

/**
 * “我的喜欢”以平台多选为唯一入口，并从同一筛选状态派生混合列表和平台抽屉。
 * 拼接作品的创建者与来源博主分开检索，跨平台片段不会被错误折叠为一个虚假账号。
 */
export function useFavoriteFilters(
  recordSource: MaybeRefOrGetter<readonly LibraryTrackRecord[]>,
  platformSource: MaybeRefOrGetter<readonly MusicPlatformOption[]>,
  customTrackSource: MaybeRefOrGetter<readonly CustomTrackDefinition[]>,
) {
  const platformOptions = computed<readonly FavoritePlatformOption[]>(() => {
    const records = toValue(recordSource).filter((record) => record.favoritedAtMs !== undefined)
    const counts = new Map<string, number>()
    for (const record of records) {
      const pluginId = getFavoritePlatformId(record)
      counts.set(pluginId, (counts.get(pluginId) ?? 0) + 1)
    }

    const options: FavoritePlatformOption[] = []
    const knownIds = new Set<string>()
    for (const platform of toValue(platformSource)) {
      if (platform.id === CUSTOM_TRACK_PLATFORM_ID || knownIds.has(platform.id)) continue
      knownIds.add(platform.id)
      options.push({ ...platform, count: counts.get(platform.id) ?? 0, isCustom: false })
    }
    for (const record of records) {
      const pluginId = getFavoritePlatformId(record)
      if (pluginId === CUSTOM_TRACK_PLATFORM_ID || knownIds.has(pluginId)) continue
      knownIds.add(pluginId)
      options.push({
        id: pluginId,
        name: pluginId,
        count: counts.get(pluginId) ?? 0,
        isCustom: false,
      })
    }
    options.push({
      id: CUSTOM_TRACK_PLATFORM_ID,
      name: '自定义拼接音乐',
      count: counts.get(CUSTOM_TRACK_PLATFORM_ID) ?? 0,
      isCustom: true,
    })
    return options
  })

  const tagContribution = useUiContributionAvailability('trackList.filters')
  const filters = shallowRef<FavoriteFilterState>(
    createFavoriteFilterState(platformOptions.value.map((platform) => platform.id)),
  )

  watch(platformOptions, (nextOptions, previousOptions) => {
    const nextIds = new Set(nextOptions.map((platform) => platform.id))
    const previousIds = new Set(previousOptions.map((platform) => platform.id))
    const selectedIds = new Set(
      filters.value.selectedPlatformIds.filter((pluginId) => nextIds.has(pluginId)),
    )
    // 新安装或首次出现的平台默认加入选择；用户主动取消的平台不会被重新勾选。
    for (const platform of nextOptions) {
      if (!previousIds.has(platform.id)) selectedIds.add(platform.id)
    }
    filters.value = { ...filters.value, selectedPlatformIds: [...selectedIds] }
  })

  watch(
    [() => tagContribution.allows('tag-filter'), filters],
    ([available]) => {
      if (!available && filters.value.regularTag && !filters.value.tagsDormant)
        filters.value = { ...filters.value, tagsDormant: true }
    },
    { immediate: true, flush: 'sync' },
  )
  const hasCustomSelection = computed(() =>
    filters.value.selectedPlatformIds.includes(CUSTOM_TRACK_PLATFORM_ID),
  )
  const selectedRegularPlatformIds = computed(() =>
    filters.value.selectedPlatformIds.filter((pluginId) => pluginId !== CUSTOM_TRACK_PLATFORM_ID),
  )
  const hasRegularSelection = computed(() => selectedRegularPlatformIds.value.length > 0)
  const customTrackById = computed(
    () => new Map(toValue(customTrackSource).map((definition) => [definition.trackId, definition])),
  )

  const regularRecords = computed(() => {
    if (!hasRegularSelection.value) return []
    const selectedIds = new Set(selectedRegularPlatformIds.value)
    return filterFavoriteRecords(
      toValue(recordSource).filter((record) => selectedIds.has(record.track.source.pluginId)),
      {
        kind: 'regular',
        titleQuery: filters.value.titleQuery,
        artistQuery: filters.value.artistQuery,
        requiredTags:
          tagContribution.allows('tag-filter') &&
          !filters.value.tagsDormant &&
          filters.value.regularTag
            ? [filters.value.regularTag]
            : [],
        occurredFromMs: readLocalDateStart(filters.value.regularPublishedFrom),
        occurredBeforeMs: readLocalDateEnd(filters.value.regularPublishedTo),
      },
    )
  })

  const customRecords = computed(() => {
    if (!hasCustomSelection.value) return []
    const records = filterFavoriteRecords(toValue(recordSource), {
      kind: 'custom',
      titleQuery: filters.value.titleQuery,
      occurredFromMs: readLocalDateStart(filters.value.customCreatedFrom),
      occurredBeforeMs: readLocalDateEnd(filters.value.customCreatedTo),
    })
    const artistQuery = createSearchKey(filters.value.artistQuery)
    if (!artistQuery) return records
    return records.filter((record) => {
      const definition = customTrackById.value.get(record.track.id)
      const searchableValues = [
        ...record.track.artists.flatMap((artist) => [artist.name, artist.id ?? '']),
        ...(definition?.sourceCredits.flatMap((credit) => [
          credit.pluginId,
          credit.artistName,
          credit.artistId ?? '',
        ]) ?? []),
      ]
      return searchableValues.some((value) => createSearchKey(value).includes(artistQuery))
    })
  })

  const visibleRecords = computed(() =>
    [...regularRecords.value, ...customRecords.value].toSorted(compareFavoriteRecords),
  )
  const platformDrawers = computed<readonly FavoritePlatformDrawer[]>(() => {
    const selectedIds = new Set(filters.value.selectedPlatformIds)
    return platformOptions.value
      .filter((platform) => selectedIds.has(platform.id))
      .map((platform) => ({
        platform,
        records: visibleRecords.value.filter(
          (record) => getFavoritePlatformId(record) === platform.id,
        ),
      }))
  })
  const tagStats = computed(() => {
    const selectedIds = new Set(selectedRegularPlatformIds.value)
    const counts = new Map<string, { name: string; count: number }>()
    for (const record of filterFavoriteRecords(toValue(recordSource), { kind: 'regular' })) {
      if (!selectedIds.has(record.track.source.pluginId)) continue
      for (const tag of record.customTags) {
        const key = createSearchKey(tag)
        const existing = counts.get(key)
        if (existing) existing.count += 1
        else counts.set(key, { name: tag, count: 1 })
      }
    }
    return [...counts.values()].toSorted((left, right) => {
      return right.count - left.count || left.name.localeCompare(right.name, 'zh-CN')
    })
  })

  function togglePlatform(pluginId: string): void {
    const selectedIds = new Set(filters.value.selectedPlatformIds)
    if (selectedIds.has(pluginId)) selectedIds.delete(pluginId)
    else selectedIds.add(pluginId)
    filters.value = { ...filters.value, selectedPlatformIds: [...selectedIds] }
  }

  function selectAllPlatforms(): void {
    filters.value = {
      ...filters.value,
      selectedPlatformIds: platformOptions.value.map((platform) => platform.id),
    }
  }

  function clearPlatforms(): void {
    filters.value = { ...filters.value, selectedPlatformIds: [] }
  }

  return {
    filters,
    regularRecords,
    customRecords,
    visibleRecords,
    platformOptions,
    platformDrawers,
    tagStats,
    hasRegularSelection,
    hasCustomSelection,
    customTrackById,
    togglePlatform,
    selectAllPlatforms,
    clearPlatforms,
  }
}

export function createFavoriteFilterState(
  selectedPlatformIds: readonly string[] = [],
): FavoriteFilterState {
  return {
    selectedPlatformIds,
    arrangementMode: 'collapsed',
    titleQuery: '',
    artistQuery: '',
    regularPublishedFrom: '',
    regularPublishedTo: '',
    regularTag: '',
    customCreatedFrom: '',
    customCreatedTo: '',
  }
}

function getFavoritePlatformId(record: LibraryTrackRecord): string {
  return record.track.source.mediaKind === 'custom'
    ? CUSTOM_TRACK_PLATFORM_ID
    : record.track.source.pluginId
}

function compareFavoriteRecords(left: LibraryTrackRecord, right: LibraryTrackRecord): number {
  return (right.favoritedAtMs ?? 0) - (left.favoritedAtMs ?? 0) || right.addedAtMs - left.addedAtMs
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
