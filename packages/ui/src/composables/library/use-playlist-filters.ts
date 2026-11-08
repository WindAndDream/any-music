import type { CustomTrackDefinition, LibraryTrackRecord } from '@any-music/core'
import type { ShallowRef } from 'vue'
import { computed, shallowRef, toValue, watch } from 'vue'
import type { MaybeRefOrGetter } from 'vue'

import { useUiContributionAvailability } from '../../product/ui-contributions'
import { editingStateKey, useEditingSession, type EditingSession } from '../use-editing-session'
import { createFavoriteFilterState, CUSTOM_TRACK_PLATFORM_ID } from './use-favorite-filters'
import type {
  FavoriteFilterState,
  FavoritePlatformDrawer,
  FavoritePlatformOption,
  MusicPlatformOption,
} from './use-favorite-filters'

/** 歌单额外支持收藏状态和时长；排列保留为独立视图偏好。 */
export interface PlaylistFilterState extends FavoriteFilterState {
  favoriteOnly: boolean
  durationRange: 'any' | 'short' | 'medium' | 'long'
}

/**
 * 歌单详情复用“我的喜欢”的平台与筛选契约，但保留歌单自己的曲目顺序，
 * 并且不会因为歌曲尚未喜欢而把它从结果中排除。
 */
export function usePlaylistFilters(
  recordSource: MaybeRefOrGetter<readonly LibraryTrackRecord[]>,
  platformSource: MaybeRefOrGetter<readonly MusicPlatformOption[]>,
  customTrackSource: MaybeRefOrGetter<readonly CustomTrackDefinition[]>,
  editing: EditingSession = useEditingSession(),
) {
  const tagContribution = useUiContributionAvailability('trackList.filters')
  const platformOptions = computed<readonly FavoritePlatformOption[]>(() => {
    const counts = new Map<string, number>()
    for (const record of toValue(recordSource)) {
      const pluginId = getPlatformId(record)
      counts.set(pluginId, (counts.get(pluginId) ?? 0) + 1)
    }

    const options: FavoritePlatformOption[] = []
    const knownIds = new Set<string>()
    for (const platform of toValue(platformSource)) {
      if (platform.id === CUSTOM_TRACK_PLATFORM_ID || knownIds.has(platform.id)) continue
      knownIds.add(platform.id)
      options.push({ ...platform, count: counts.get(platform.id) ?? 0, isCustom: false })
    }
    for (const record of toValue(recordSource)) {
      const pluginId = getPlatformId(record)
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
  const filters = editing.state(filtersKey, () =>
    shallowRef<PlaylistFilterState>({
      ...createFavoriteFilterState(platformOptions.value.map((platform) => platform.id)),
      arrangementMode: 'mixed',
      favoriteOnly: false,
      durationRange: 'any',
    }),
  )

  watch(platformOptions, (nextOptions, previousOptions) => {
    const nextIds = new Set(nextOptions.map((platform) => platform.id))
    const previousIds = new Set(previousOptions.map((platform) => platform.id))
    const selectedIds = new Set(
      filters.value.selectedPlatformIds.filter((pluginId) => nextIds.has(pluginId)),
    )
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
  const visibleRecords = computed(() => {
    const selectedIds = new Set(filters.value.selectedPlatformIds)
    return toValue(recordSource).filter((record) => {
      const platformId = getPlatformId(record)
      if (!selectedIds.has(platformId)) return false
      if (filters.value.favoriteOnly && record.favoritedAtMs === undefined) return false
      const durationMs = record.track.durationMs
      if (filters.value.durationRange !== 'any') {
        if (durationMs === undefined) return false
        if (filters.value.durationRange === 'short' && durationMs >= 4 * 60_000) return false
        if (
          filters.value.durationRange === 'medium' &&
          (durationMs < 4 * 60_000 || durationMs >= 15 * 60_000)
        )
          return false
        if (filters.value.durationRange === 'long' && durationMs < 15 * 60_000) return false
      }
      const isCustom = platformId === CUSTOM_TRACK_PLATFORM_ID
      const titleQuery = createSearchKey(filters.value.titleQuery)
      if (
        titleQuery &&
        ![record.track.title, record.customName ?? ''].some((name) =>
          createSearchKey(name).includes(titleQuery),
        )
      )
        return false
      if (!matchesArtist(record, filters.value.artistQuery, customTrackById.value)) return false
      if (
        !isCustom &&
        tagContribution.allows('tag-filter') &&
        !filters.value.tagsDormant &&
        !matchesTag(record, filters.value.regularTag)
      )
        return false

      const occurredAtMs = isCustom
        ? (customTrackById.value.get(record.track.id)?.createdAtMs ??
          record.track.publishedAtMs ??
          record.addedAtMs)
        : record.track.publishedAtMs
      const fromMs = readLocalDateStart(
        isCustom ? filters.value.customCreatedFrom : filters.value.regularPublishedFrom,
      )
      const beforeMs = readLocalDateEnd(
        isCustom ? filters.value.customCreatedTo : filters.value.regularPublishedTo,
      )
      if (fromMs !== undefined && (occurredAtMs === undefined || occurredAtMs < fromMs)) {
        return false
      }
      if (beforeMs !== undefined && (occurredAtMs === undefined || occurredAtMs >= beforeMs)) {
        return false
      }
      return true
    })
  })
  const platformDrawers = computed<readonly FavoritePlatformDrawer[]>(() =>
    platformOptions.value
      .filter((platform) => filters.value.selectedPlatformIds.includes(platform.id))
      .map((platform) => ({
        platform,
        records: visibleRecords.value.filter((record) => getPlatformId(record) === platform.id),
      })),
  )
  const tagStats = computed(() => {
    const selectedIds = new Set(selectedRegularPlatformIds.value)
    const counts = new Map<string, { name: string; count: number }>()
    for (const record of toValue(recordSource)) {
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

function getPlatformId(record: LibraryTrackRecord): string {
  return record.track.source.mediaKind === 'custom'
    ? CUSTOM_TRACK_PLATFORM_ID
    : record.track.source.pluginId
}

function matchesArtist(
  record: LibraryTrackRecord,
  query: string,
  customTrackById: ReadonlyMap<string, CustomTrackDefinition>,
): boolean {
  const searchKey = createSearchKey(query)
  if (!searchKey) return true
  const definition = customTrackById.get(record.track.id)
  return [
    ...record.track.artists.flatMap((artist) => [artist.name, artist.id ?? '']),
    ...(definition?.sourceCredits.flatMap((credit) => [
      credit.pluginId,
      credit.artistName,
      credit.artistId ?? '',
    ]) ?? []),
  ].some((value) => createSearchKey(value).includes(searchKey))
}

function matchesTag(record: LibraryTrackRecord, tag: string): boolean {
  const tagKey = createSearchKey(tag)
  return !tagKey || record.customTags.some((candidate) => createSearchKey(candidate) === tagKey)
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

const filtersKey = editingStateKey<ShallowRef<PlaylistFilterState>>(
  'composables/library/use-playlist-filters.ts:filters',
)
