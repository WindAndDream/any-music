import { formatAppErrorMessage, toAppErrorState } from '@any-music/core'
import type { AppErrorState, LibraryTrackRecord } from '@any-music/core'
import { computed, readonly, shallowRef, toValue, watch } from 'vue'
import type { MaybeRefOrGetter } from 'vue'

import { readStored, writeStored } from '../../runtime/storage'
import { reorderQueueIds } from '../player/playback-queue-state'

const STORAGE_KEY = 'favorite-collection:v1'
type ArrangementMode = 'flat' | 'platform'

/** 只保存喜欢页的稳定 ID 顺序和排列偏好，不改写喜欢时间，也不改写待听。 */
export function useFavoriteCollection(source: MaybeRefOrGetter<readonly LibraryTrackRecord[]>) {
  const errorState = shallowRef<AppErrorState>()
  let initial: { trackIds?: unknown; arrangementMode?: unknown } = {}
  try {
    const stored = readStored<unknown>(STORAGE_KEY)
    if (
      stored &&
      typeof stored === 'object' &&
      'schemaVersion' in stored &&
      stored.schemaVersion === 1
    ) {
      initial = {
        trackIds: 'trackIds' in stored ? stored.trackIds : undefined,
        arrangementMode: 'arrangementMode' in stored ? stored.arrangementMode : undefined,
      }
    }
  } catch (error) {
    errorState.value = toAppErrorState(error, 'storage-read-failed', '喜欢列表读取失败。')
  }
  const arrangementMode = shallowRef<ArrangementMode>(
    initial.arrangementMode === 'platform' ? 'platform' : 'flat',
  )
  const trackIds = shallowRef<readonly string[]>(
    Array.isArray(initial.trackIds)
      ? [
          ...new Set(
            initial.trackIds.filter(
              (id): id is string => typeof id === 'string' && id.length > 0 && id.length <= 1_000,
            ),
          ),
        ]
      : [],
  )
  const favoriteRecords = computed(() =>
    toValue(source)
      .filter((record) => record.favoritedAtMs !== undefined)
      .toSorted(
        (a, b) => (b.favoritedAtMs ?? 0) - (a.favoritedAtMs ?? 0) || b.addedAtMs - a.addedAtMs,
      ),
  )
  const records = computed(() => {
    const byId = new Map(favoriteRecords.value.map((record) => [record.track.id, record]))
    return trackIds.value.flatMap((id) => byId.get(id) ?? [])
  })
  function groupIds(ids: readonly string[]): readonly string[] {
    const byId = new Map(
      favoriteRecords.value.map((record) => [record.track.id, record.track.source.pluginId]),
    )
    const groups = new Map<string, string[]>()
    for (const id of ids) {
      const platform = byId.get(id)
      if (platform === undefined) continue
      const group = groups.get(platform) ?? []
      group.push(id)
      groups.set(platform, group)
    }
    return [...groups.values()].flat()
  }
  let initialized = false
  watch(
    favoriteRecords,
    (next) => {
      const currentIds = new Set(next.map((record) => record.track.id))
      const savedIds = new Set(trackIds.value)
      const ids = [
        ...next.filter((record) => !savedIds.has(record.track.id)).map((record) => record.track.id),
        ...trackIds.value.filter((id) => currentIds.has(id)),
      ]
      const reconciled = arrangementMode.value === 'platform' ? groupIds(ids) : ids
      const changed =
        reconciled.length !== trackIds.value.length ||
        reconciled.some((id, index) => id !== trackIds.value[index])
      trackIds.value = reconciled
      if (initialized && changed) persist()
      initialized = true
    },
    { immediate: true, flush: 'sync' },
  )

  function persist(): void {
    try {
      writeStored(STORAGE_KEY, {
        schemaVersion: 1,
        trackIds: trackIds.value,
        arrangementMode: arrangementMode.value,
      })
      errorState.value = undefined
    } catch (error) {
      errorState.value = toAppErrorState(error, 'storage-write-failed', '喜欢列表保存失败。')
    }
  }
  function setArrangementMode(mode: ArrangementMode): void {
    if (arrangementMode.value === mode) return
    arrangementMode.value = mode
    if (mode === 'platform') trackIds.value = groupIds(trackIds.value)
    persist()
  }
  function move(id: string, target: string, visibleIds: readonly string[]): void {
    const byId = new Map(
      records.value.map((record) => [record.track.id, record.track.source.pluginId]),
    )
    if (arrangementMode.value === 'platform' && byId.get(id) !== byId.get(target)) return
    const eligible =
      arrangementMode.value === 'platform'
        ? visibleIds.filter((candidate) => byId.get(candidate) === byId.get(id))
        : visibleIds
    const next = reorderQueueIds(trackIds.value, id, target, eligible)
    if (next === trackIds.value) return
    trackIds.value = next
    persist()
  }
  function pin(id: string, visibleIds: readonly string[]): void {
    const platform = records.value.find((record) => record.track.id === id)?.track.source.pluginId
    const visible = new Set(visibleIds)
    const first = records.value.find(
      (record) =>
        visible.has(record.track.id) &&
        (arrangementMode.value === 'flat' || record.track.source.pluginId === platform),
    )
    if (first) move(id, first.track.id, visibleIds)
  }
  function movePlatform(id: string, target: string, visibleIds: readonly string[]): void {
    if (arrangementMode.value !== 'platform') return
    const groups = new Map<string, string[]>()
    for (const record of records.value) {
      const platform = record.track.source.pluginId
      const group = groups.get(platform) ?? []
      group.push(record.track.id)
      groups.set(platform, group)
    }
    const ids = [...groups.keys()]
    const next = reorderQueueIds(ids, id, target, visibleIds)
    if (next === ids) return
    trackIds.value = next.flatMap((platform) => groups.get(platform) ?? [])
    persist()
  }
  return {
    records,
    arrangementMode: readonly(arrangementMode),
    setArrangementMode,
    move,
    pin,
    movePlatform,
    persistenceError: computed(() =>
      errorState.value ? formatAppErrorMessage(errorState.value) : '',
    ),
  }
}
