import type { DownloadHistoryBatch } from '@any-music/core'
import { getDownloadListEntries } from '@any-music/ui/library'
import { computed, shallowRef, toValue, watch } from 'vue'
import type { MaybeRefOrGetter } from 'vue'

import { readStored, writeStored } from '../../runtime/storage'
import { reorderQueueIds } from '../player/playback-queue-state'

const STORAGE_KEY = 'download-collection-order:v1'

/** Display order is independent of batch membership and the active scheduler's work queue. */
export function useDownloadCollectionOrder(
  batches: MaybeRefOrGetter<readonly DownloadHistoryBatch[]>,
) {
  const sourceIds = computed(() =>
    getDownloadListEntries(toValue(batches)).map(({ item }) => item.id),
  )
  const savedIds = shallowRef<readonly string[]>(load())
  const itemOrder = computed(() => {
    const available = new Set(sourceIds.value)
    const saved = new Set(savedIds.value)
    return [
      ...sourceIds.value.filter((id) => !saved.has(id)),
      ...savedIds.value.filter((id) => available.has(id)),
    ]
  })
  function load(): readonly string[] {
    try {
      const stored = readStored<unknown>(STORAGE_KEY)
      if (
        !stored ||
        typeof stored !== 'object' ||
        !('schemaVersion' in stored) ||
        stored.schemaVersion !== 1 ||
        !('itemIds' in stored) ||
        !Array.isArray(stored.itemIds)
      )
        return []
      return [
        ...new Set(
          stored.itemIds.filter(
            (id): id is string => typeof id === 'string' && id.length > 0 && id.length <= 1_000,
          ),
        ),
      ]
    } catch (error) {
      console.warn('[Any Music] 无法读取下载列表顺序，已使用默认顺序。', error)
      return []
    }
  }
  function persist(ids: readonly string[]): void {
    savedIds.value = ids
    try {
      writeStored(STORAGE_KEY, { schemaVersion: 1, itemIds: ids })
    } catch (error) {
      console.warn('[Any Music] 无法保存下载列表顺序，本次会话中的顺序仍然有效。', error)
    }
  }
  function move(id: string, targetId: string, visibleIds: readonly string[]): void {
    const current = itemOrder.value
    const next = reorderQueueIds(current, id, targetId, visibleIds)
    if (next !== current) persist(next)
  }
  watch(
    () => JSON.stringify(sourceIds.value),
    () => {
      if (
        savedIds.value.length &&
        JSON.stringify(itemOrder.value) !== JSON.stringify(savedIds.value)
      )
        persist(itemOrder.value)
    },
    { flush: 'sync' },
  )
  return { itemOrder, move }
}
