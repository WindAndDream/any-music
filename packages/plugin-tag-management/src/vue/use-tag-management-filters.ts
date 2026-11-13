import type { LibraryTrackRecord } from '@any-music/core'
import { CUSTOM_TRACK_PLATFORM_ID, editingStateKey, useEditingSession } from '@any-music/ui'
import type { EditingSession, MusicPlatformOption } from '@any-music/ui'
import type {
  TagManagementFilterState,
  TagEntityKind,
  TagPlaylistRecord,
  TagManagementTag,
  TagPlatformOption,
} from '@any-music/ui/theme'
import { computed, shallowRef, toValue, watch } from 'vue'
import type { MaybeRefOrGetter, ShallowRef } from 'vue'

export type { TagManagementFilterState, TagOption, TagPlatformOption } from '@any-music/ui/theme'

export function tagKey(value: string): string {
  return value.normalize('NFKC').trim().toLocaleLowerCase()
}

export function createTagManagementFilterState(
  selectedPlatformIds: readonly string[] = [],
): TagManagementFilterState {
  return {
    selectedPlatformIds,
    searchQuery: '',
    usage: [],
    platformScope: [],
    sortMode: [],
  }
}

/** Index each association once. Detail lookup never scans the library for every rendered tag. */
export function useTagManagementFilters(
  recordSource: MaybeRefOrGetter<readonly LibraryTrackRecord[]>,
  platformSource: MaybeRefOrGetter<readonly MusicPlatformOption[]>,
  editing: EditingSession = useEditingSession(),
  definitions: MaybeRefOrGetter<readonly { name: string; updatedAtMs: number }[]> = [],
  entities: {
    kind: MaybeRefOrGetter<TagEntityKind>
    playlists: MaybeRefOrGetter<readonly TagPlaylistRecord[]>
  } = { kind: 'tracks', playlists: [] },
) {
  const taggedPlaylists = computed(() =>
    toValue(entities.playlists).filter((record) => record.customTags.length),
  )
  const taggedRecords = computed(() =>
    toValue(recordSource).filter((record) => record.customTags.length),
  )
  const index = computed(() => {
    const tags = new Map<string, TagManagementTag>()
    const records = new Map<string, LibraryTrackRecord[]>()
    const playlists = new Map<string, TagPlaylistRecord[]>()
    const platforms = new Map<string, Set<string>>()
    const platformCounts = new Map<string, number>()
    for (const { name, updatedAtMs } of toValue(definitions)) {
      const key = tagKey(name)
      tags.set(key, { key, name, count: 0, platformIds: [], updatedAtMs })
      records.set(key, [])
      playlists.set(key, [])
      platforms.set(key, new Set())
    }
    const associations =
      toValue(entities.kind) === 'playlists'
        ? taggedPlaylists.value.map((record) => ({
            record,
            platformIds: record.platformIds,
            updatedAtMs: record.playlist.updatedAtMs,
          }))
        : taggedRecords.value.map((record) => ({
            record,
            platformIds: [
              record.track.source.mediaKind === 'custom'
                ? CUSTOM_TRACK_PLATFORM_ID
                : record.track.source.pluginId,
            ],
            updatedAtMs: record.updatedAtMs,
          }))
    for (const { record, platformIds, updatedAtMs } of associations) {
      for (const id of new Set(platformIds))
        platformCounts.set(id, (platformCounts.get(id) ?? 0) + 1)
      // Historical casing/Unicode duplicates on one item still count as one association.
      const seen = new Set<string>()
      for (const name of record.customTags) {
        const key = tagKey(name)
        if (!key || seen.has(key)) continue
        seen.add(key)
        let tag = tags.get(key)
        if (!tag) {
          tag = { key, name, count: 0, platformIds: [], updatedAtMs }
          tags.set(key, tag)
          records.set(key, [])
          playlists.set(key, [])
          platforms.set(key, new Set())
        }
        tag.count++
        tag.updatedAtMs = Math.max(tag.updatedAtMs, updatedAtMs)
        for (const id of platformIds) platforms.get(key)!.add(id)
        if ('playlist' in record) playlists.get(key)!.push(record)
        else records.get(key)!.push(record)
      }
    }
    for (const [key, tag] of tags) tag.platformIds = [...platforms.get(key)!]
    return { tags, records, playlists, platformCounts }
  })
  const allTagOptions = computed(() => [...index.value.tags.values()])
  const platformOptions = computed<readonly TagPlatformOption[]>(() => {
    const known = new Map(toValue(platformSource).map((platform) => [platform.id, platform]))
    for (const id of index.value.platformCounts.keys())
      if (!known.has(id)) known.set(id, { id, name: id })
    known.set(CUSTOM_TRACK_PLATFORM_ID, { id: CUSTOM_TRACK_PLATFORM_ID, name: '自定义拼接音乐' })
    return [...known.values()].map((platform) =>
      Object.assign({}, platform, {
        count: index.value.platformCounts.get(platform.id) ?? 0,
        isCustom: platform.id === CUSTOM_TRACK_PLATFORM_ID,
      }),
    )
  })
  const filters = editing.state(filtersKey, () => shallowRef(createTagManagementFilterState()))
  const filterDraft = editing.state(filterDraftKey, () =>
    shallowRef<TagManagementFilterState | null>(null),
  )
  watch(
    platformOptions,
    (next) => {
      const available = new Set(next.map(({ id }) => id))
      const refresh = (value: TagManagementFilterState): TagManagementFilterState => ({
        ...value,
        selectedPlatformIds: value.selectedPlatformIds.filter((id) => available.has(id)),
      })
      filters.value = refresh(filters.value)
      if (filterDraft.value) filterDraft.value = refresh(filterDraft.value)
    },
    { immediate: true },
  )
  const tagOptions = computed(() => filterTags(allTagOptions.value, filters.value))
  const filterPreviewCount = computed(() => {
    const matches = createTagPredicate(filterDraft.value ?? filters.value)
    return allTagOptions.value.reduce((count, tag) => count + Number(matches(tag)), 0)
  })
  const hasFilters = computed(() => {
    return Boolean(
      filters.value.searchQuery.trim() ||
      filters.value.usage.length ||
      filters.value.platformScope.length ||
      filters.value.sortMode.length ||
      filters.value.selectedPlatformIds.length,
    )
  })
  function beginFilters(): void {
    filterDraft.value = {
      ...filters.value,
      selectedPlatformIds: [...filters.value.selectedPlatformIds],
      usage: [...filters.value.usage],
      platformScope: [...filters.value.platformScope],
      sortMode: [...filters.value.sortMode],
    }
  }
  function applyFilters(): void {
    if (!filterDraft.value) return
    const available = new Set(platformOptions.value.map(({ id }) => id))
    filters.value = {
      ...filterDraft.value,
      selectedPlatformIds: filterDraft.value.selectedPlatformIds.filter((id) => available.has(id)),
    }
    filterDraft.value = null
  }
  function resetFilters(): void {
    filters.value = createTagManagementFilterState()
  }
  return {
    filters,
    filterDraft,
    filterPreviewCount,
    beginFilters,
    applyFilters,
    resetFilters,
    taggedRecords,
    taggedPlaylists,
    platformOptions,
    allTagOptions,
    tagOptions,
    hasFilters,
    index,
  }
}

function filterTags(
  tags: readonly TagManagementTag[],
  filters: TagManagementFilterState,
): readonly TagManagementTag[] {
  return tags.filter(createTagPredicate(filters)).toSorted((left, right) => {
    const modes = filters.sortMode.length ? filters.sortMode : ['updated-desc']
    for (const mode of modes) {
      const difference =
        mode === 'name-asc'
          ? left.name.localeCompare(right.name, 'zh-CN')
          : mode === 'usage-desc'
            ? right.count - left.count
            : right.updatedAtMs - left.updatedAtMs
      if (difference) return difference
    }
    return left.name.localeCompare(right.name, 'zh-CN')
  })
}

function createTagPredicate(filters: TagManagementFilterState): (tag: TagManagementTag) => boolean {
  const platforms = new Set(filters.selectedPlatformIds)
  const query = tagKey(filters.searchQuery)
  return (tag) => {
    if (
      (platforms.size > 0 &&
        tag.platformIds.length > 0 &&
        !tag.platformIds.some((id) => platforms.has(id))) ||
      (query && !tag.key.includes(query))
    )
      return false
    if (
      filters.usage.length &&
      !filters.usage.some((value) => (value === 'single' ? tag.count === 1 : tag.count >= 2))
    )
      return false
    if (
      filters.platformScope.length &&
      !filters.platformScope.some((value) =>
        value === 'single' ? tag.platformIds.length === 1 : tag.platformIds.length >= 2,
      )
    )
      return false
    return true
  }
}

const filtersKey = editingStateKey<ShallowRef<TagManagementFilterState>>('tags:directory-filters')
const filterDraftKey = editingStateKey<ShallowRef<TagManagementFilterState | null>>(
  'tags:directory-filter-draft',
)
