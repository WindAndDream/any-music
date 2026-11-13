import type { LibraryTrackRecord, MaterialCollection } from '@any-music/core'
import { createEditingSession } from '@any-music/ui'
import { describe, expect, it, vi } from 'vitest'
import { effectScope } from 'vue'

import { useSegmentComposer } from '../../src/vue/use-segment-composer'

describe('useSegmentComposer', () => {
  it.each([false, true])(
    'retains unfinished title, recipe, format and material filters through presentation scopes without replaying draft writes (collection=%s)',
    async (hasCollection) => {
      const editing = createEditingSession()
      const record = createRecord()
      const collection = createCollection(record.track.id)
      const emit = vi.fn()
      const props = {
        editing,
        records: [record],
        pendingRecords: [],
        materialCollections: hasCollection ? [collection] : [],
        platforms: [],
        errorMessage: '',
        exportBusy: false,
        exportMessage: '',
      }
      const bind = () => {
        const scope = effectScope()
        const composer = scope.run(() =>
          useSegmentComposer({ props, emit, confirm: vi.fn(async () => true) }),
        )!
        return { scope, composer }
      }
      const first = bind()
      first.composer.title.value = '未发布草稿'
      first.composer.exportFormat.value = 'wav'
      if (hasCollection)
        first.composer.addSegment({ sourceTrackId: record.track.id, startMs: 0, endMs: 1_000 })
      first.composer.filters.value = {
        ...first.composer.filters.value,
        query: '未提交素材查询',
        membership: 'available',
      }
      const writes = emit.mock.calls.length
      first.scope.stop()
      const second = bind()
      try {
        expect(second.composer.title.value).toBe('未发布草稿')
        expect(second.composer.exportFormat.value).toBe('wav')
        expect(second.composer.recipe.value).toHaveLength(hasCollection ? 1 : 0)
        expect(second.composer.filters.value.query).toBe('未提交素材查询')
        expect(second.composer.filters.value.membership).toBe('available')
        expect(emit).toHaveBeenCalledTimes(writes)
      } finally {
        second.scope.stop()
        editing.dispose()
      }
    },
  )
  it('clears only the material query and membership when explicitly switching collections or filing pending material', async () => {
    const record = createRecord()
    const current = createCollection(record.track.id)
    const next = createCollection(record.track.id, 'material-collection:next')
    const emit = vi.fn()
    const scope = effectScope()
    const composer = scope.run(() =>
      useSegmentComposer({
        confirm: vi.fn(async () => true),
        emit,
        props: {
          records: [record],
          pendingRecords: [record],
          materialCollections: [current, next],
          platforms: [],
          errorMessage: '',
          exportBusy: false,
          exportMessage: '',
        },
      }),
    )!
    try {
      composer.filters.value = {
        ...composer.filters.value,
        query: '选择前的查询',
        membership: 'available',
        platformId: 'test',
        trackKind: 'regular',
        sortMode: 'title',
      }
      await composer.selectCollection(next.id)
      expect(composer.activeCollectionId.value).toBe(next.id)
      expect(composer.filters.value).toMatchObject({
        query: '',
        membership: 'included',
        platformId: 'test',
        trackKind: 'regular',
        sortMode: 'title',
      })
      composer.filters.value = {
        ...composer.filters.value,
        query: '归档前的查询',
        membership: 'available',
      }
      composer.addPendingMaterial(record.track.id)
      expect(emit).toHaveBeenCalledWith('addMaterial', next.id, record.track)
      expect(composer.filters.value).toMatchObject({
        query: '',
        membership: 'included',
        platformId: 'test',
        trackKind: 'regular',
        sortMode: 'title',
      })
    } finally {
      scope.stop()
    }
  })
  it('restores a draft without writing and ignores a collection confirmation after disposal', async () => {
    const record = createRecord()
    const first = createCollection(record.track.id)
    const second = createCollection(record.track.id, 'second')
    const emit = vi.fn()
    let finish!: (value: boolean) => void
    const scope = effectScope()
    const composer = scope.run(() =>
      useSegmentComposer({
        confirm: () =>
          new Promise((resolve) => {
            finish = resolve
          }),
        props: {
          records: [record],
          pendingRecords: [],
          materialCollections: [first, second],
          platforms: [],
          errorMessage: '',
          exportBusy: false,
          exportMessage: '',
          draft: {
            activeCollectionId: first.id,
            title: '已保存草稿',
            recipe: [{ sourceTrackId: record.track.id, startMs: 0, endMs: 1_000 }],
            exportFormat: 'wav',
          },
        },
        emit,
      }),
    )!
    expect(composer.title.value).toBe('已保存草稿')
    expect(composer.exportFormat.value).toBe('wav')
    expect(composer.recipe.value).toHaveLength(1)
    expect(emit).not.toHaveBeenCalled()
    composer.title.value = '新草稿'
    expect(emit).toHaveBeenLastCalledWith(
      'updateDraft',
      expect.objectContaining({ title: '新草稿' }),
    )
    const pending = composer.selectCollection(second.id)
    scope.stop()
    emit.mockClear()
    finish(true)
    await pending
    expect(composer.activeCollectionId.value).toBe(first.id)
    expect(emit).not.toHaveBeenCalled()
  })
  it('owns the draft timeline and emits a normalized save request without rendering UI', () => {
    const record = createRecord()
    const collection = createCollection(record.track.id)
    const emit = vi.fn()
    const scope = effectScope()
    const composer = scope.run(() =>
      useSegmentComposer({
        confirm: vi.fn(async () => true),
        props: {
          records: [record],
          pendingRecords: [],
          materialCollections: [collection],
          platforms: [{ id: 'test', name: '测试源' }],
          errorMessage: '',
          exportBusy: false,
          exportMessage: '',
        },
        emit,
      }),
    )!

    composer.addSegment({ sourceTrackId: record.track.id, startMs: 1_000, endMs: 3_500 })
    composer.title.value = '  测试作品  '
    composer.submit()

    expect(composer.virtualDurationMs.value).toBe(2_500)
    expect(emit).toHaveBeenCalledWith('save', '测试作品', collection.id, [
      { sourceTrackId: record.track.id, startMs: 1_000, endMs: 3_500 },
    ])
    scope.stop()
  })

  it('keeps invalid material outside the timeline and exposes a user-facing error', () => {
    const record = createRecord()
    const scope = effectScope()
    const composer = scope.run(() =>
      useSegmentComposer({
        confirm: vi.fn(async () => true),
        props: {
          records: [record],
          pendingRecords: [],
          materialCollections: [createCollection('another-track')],
          platforms: [],
          errorMessage: '',
          exportBusy: false,
          exportMessage: '',
        },
        emit: vi.fn(),
      }),
    )!

    composer.addSegment({ sourceTrackId: record.track.id, startMs: 0, endMs: 1_000 })

    expect(composer.recipe.value).toEqual([])
    expect(composer.localError.value).toBe('请先把歌曲加入当前素材合集。')
    scope.stop()
  })

  it('keeps the draft intact when the asynchronous collection switch is cancelled', async () => {
    const record = createRecord()
    const currentCollection = createCollection(record.track.id, 'material-collection:current')
    const nextCollection = createCollection(record.track.id, 'material-collection:next')
    const confirm = vi.fn(async () => false)
    const scope = effectScope()
    const composer = scope.run(() =>
      useSegmentComposer({
        confirm,
        props: {
          records: [record],
          pendingRecords: [],
          materialCollections: [currentCollection, nextCollection],
          platforms: [],
          errorMessage: '',
          exportBusy: false,
          exportMessage: '',
        },
        emit: vi.fn(),
      }),
    )!

    composer.addSegment({ sourceTrackId: record.track.id, startMs: 0, endMs: 1_000 })
    await composer.selectCollection(nextCollection.id)

    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({ title: '切换素材合集', tone: 'danger' }),
    )
    expect(composer.activeCollectionId.value).toBe(currentCollection.id)
    expect(composer.recipe.value).toHaveLength(1)
    scope.stop()
  })
})

function createRecord(): LibraryTrackRecord {
  return {
    track: {
      id: 'test:audio:1',
      title: '测试歌曲',
      artists: [{ name: '测试歌手' }],
      durationMs: 10_000,
      source: { pluginId: 'test', mediaKind: 'audio', resourceId: '1' },
    },
    customTags: [],
    addedAtMs: 1,
    updatedAtMs: 1,
  }
}

function createCollection(trackId: string, id = 'material-collection:1'): MaterialCollection {
  return {
    id,
    name: '测试素材',
    trackIds: [trackId],
    createdAtMs: 1,
    updatedAtMs: 1,
  }
}
