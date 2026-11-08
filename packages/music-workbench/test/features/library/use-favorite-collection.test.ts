import type { LibraryTrackRecord } from '@any-music/core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, shallowRef } from 'vue'

import { useFavoriteCollection } from '#workbench/features/library/use-favorite-collection'

const storage = vi.hoisted(() => ({ readStored: vi.fn(), writeStored: vi.fn() }))
vi.mock('#workbench/runtime/storage', () => storage)
const scopes: ReturnType<typeof effectScope>[] = []
beforeEach(() => {
  storage.readStored.mockReset()
  storage.writeStored.mockReset()
})
afterEach(() => {
  scopes.splice(0).forEach((scope) => scope.stop())
})

function record(id: string, platform: string, time: number): LibraryTrackRecord {
  return {
    track: {
      id,
      title: id,
      artists: [],
      source: { pluginId: platform, mediaKind: 'audio', resourceId: id },
    },
    favoritedAtMs: time,
    addedAtMs: time,
    updatedAtMs: time,
    customTags: [],
  }
}
function mount(
  records = [record('one', 'a', 30), record('two', 'b', 20), record('three', 'a', 10)],
) {
  const source = shallowRef<readonly LibraryTrackRecord[]>(records)
  const scope = effectScope()
  scopes.push(scope)
  const collection = scope.run(() => useFavoriteCollection(source))!
  return { ...collection, source, ids: () => collection.records.value.map((r) => r.track.id) }
}

describe('useFavoriteCollection', () => {
  it('restores stable order and ignores missing, duplicate and invalid stored IDs', () => {
    storage.readStored.mockReturnValue({
      schemaVersion: 1,
      trackIds: ['three', null, 'missing', 'one', 'three'],
    })
    const list = mount()
    expect(list.ids()).toEqual(['two', 'three', 'one'])
    expect(storage.writeStored).not.toHaveBeenCalled()
  })
  it('moves only matching slots, persists once and preserves favorite timestamps', () => {
    const list = mount()
    list.move('three', 'one', ['one', 'three'])
    expect(list.ids()).toEqual(['three', 'two', 'one'])
    expect(storage.writeStored).toHaveBeenCalledExactlyOnceWith('favorite-collection:v1', {
      schemaVersion: 1,
      trackIds: ['three', 'two', 'one'],
      arrangementMode: 'flat',
    })
    expect(list.source.value.map((r) => r.favoritedAtMs)).toEqual([30, 20, 10])
    const restored = storage.writeStored.mock.lastCall![1]
    storage.readStored.mockReturnValue(restored)
    expect(mount().ids()).toEqual(['three', 'two', 'one'])
  })
  it('groups sources stably, prevents cross-source song moves and moves entire platforms', () => {
    const list = mount()
    list.setArrangementMode('platform')
    expect(list.ids()).toEqual(['one', 'three', 'two'])
    list.move('one', 'two', ['one', 'three', 'two'])
    expect(list.ids()).toEqual(['one', 'three', 'two'])
    list.pin('three', ['one', 'three'])
    expect(list.ids()).toEqual(['three', 'one', 'two'])
    list.movePlatform('b', 'a', ['a', 'b'])
    expect(list.ids()).toEqual(['two', 'three', 'one'])
  })
  it('reconciles unfavorite and refavorite without changing remaining order', () => {
    const list = mount()
    list.move('three', 'one', ['one', 'two', 'three'])
    list.source.value = list.source.value.map((r) =>
      r.track.id === 'three' ? { ...r, favoritedAtMs: undefined } : r,
    )
    expect(list.ids()).toEqual(['one', 'two'])
    list.source.value = [
      ...list.source.value.filter((r) => r.track.id !== 'three'),
      record('three', 'a', 40),
    ]
    expect(list.ids()).toEqual(['three', 'one', 'two'])
  })
  it('keeps usable session state and reports read or save failures', () => {
    storage.readStored.mockImplementation(() => {
      throw new Error('read failure')
    })
    const list = mount()
    expect(list.ids()).toEqual(['one', 'two', 'three'])
    expect(list.persistenceError.value).toContain('read failure')
    storage.writeStored.mockImplementation(() => {
      throw new Error('write failure')
    })
    list.move('three', 'one', ['one', 'two', 'three'])
    expect(list.ids()).toEqual(['three', 'one', 'two'])
    expect(list.persistenceError.value).toContain('write failure')
  })
})
