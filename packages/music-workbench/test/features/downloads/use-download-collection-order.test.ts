import type { DownloadHistoryBatch } from '@any-music/core'
import { getDownloadListEntries } from '@any-music/ui/library'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, shallowRef } from 'vue'

import { useDownloadCollectionOrder } from '#workbench/features/downloads/use-download-collection-order'

const storage = vi.hoisted(() => ({ readStored: vi.fn(), writeStored: vi.fn() }))
vi.mock('#workbench/runtime/storage', () => storage)
beforeEach(() => {
  const values = new Map<string, unknown>()
  storage.readStored.mockReset().mockImplementation((key) => values.get(key))
  storage.writeStored
    .mockReset()
    .mockImplementation((key, value) => values.set(key, structuredClone(value)))
})
function batch(batchId: string, ids: string[]): DownloadHistoryBatch {
  return {
    id: batchId,
    status: 'running',
    startedAtMs: 1,
    concurrency: 2,
    origin: { kind: 'queue', label: '待听' },
    items: ids.map((id) => ({
      id,
      track: {
        id: `song:${id}`,
        title: id,
        artists: [],
        source: { pluginId: 'source', resourceId: id, mediaKind: 'audio' },
      },
      requestedAtMs: 1,
      status: 'queued',
      attempts: [],
      maxRetryCount: 3,
    })),
  }
}

describe('download collection order', () => {
  it('moves filtered slots across batches, restores order and preserves scheduler records', () => {
    const source = shallowRef([batch('one', ['a', 'b']), batch('two', ['c', 'd'])])
    const original = structuredClone(source.value)
    const scope = effectScope()
    try {
      const order = scope.run(() => useDownloadCollectionOrder(source))!
      order.move('d', 'b', ['b', 'd'])
      expect(order.itemOrder.value).toEqual(['a', 'd', 'c', 'b'])
      expect(source.value).toEqual(original)
      const restored = scope.run(() => useDownloadCollectionOrder(source))!
      expect(
        getDownloadListEntries(source.value, restored.itemOrder.value).map(({ item }) => item.id),
      ).toEqual(['a', 'd', 'c', 'b'])
      expect(storage.writeStored).toHaveBeenCalledTimes(1)
      order.move('missing', 'b', ['missing', 'b'])
      expect(storage.writeStored).toHaveBeenCalledTimes(1)
    } finally {
      scope.stop()
    }
  })

  it('ignores progress updates, adds new tasks and prunes removed identities', () => {
    const source = shallowRef([batch('one', ['a', 'b', 'c'])])
    const scope = effectScope()
    try {
      const order = scope.run(() => useDownloadCollectionOrder(source))!
      order.move('c', 'a', ['a', 'b', 'c'])
      storage.writeStored.mockClear()
      source.value = source.value.map((entry) => ({
        ...entry,
        items: entry.items.map((item) => ({ ...item, progressMessage: '42%' })),
      }))
      expect(order.itemOrder.value).toEqual(['c', 'a', 'b'])
      expect(storage.writeStored).not.toHaveBeenCalled()
      source.value = [batch('new', ['d']), ...source.value]
      expect(order.itemOrder.value).toEqual(['d', 'c', 'a', 'b'])
      source.value = source.value.map((entry) =>
        Object.assign({}, entry, {
          items: entry.items.filter(({ id }) => id !== 'c'),
        }),
      )
      expect(order.itemOrder.value).toEqual(['d', 'a', 'b'])
      expect(storage.writeStored).toHaveBeenLastCalledWith('download-collection-order:v1', {
        schemaVersion: 1,
        itemIds: ['d', 'a', 'b'],
      })
    } finally {
      scope.stop()
    }
  })
})
