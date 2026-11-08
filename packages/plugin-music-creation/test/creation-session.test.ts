import type { SegmentRecipe, Track } from '@any-music/core'
import type { MusicCreationDraft, MusicCreationPorts, MusicCreationState } from '@any-music/ui'
import { editingStateKey } from '@any-music/ui'
import { describe, expect, it, vi } from 'vitest'

import { createMusicCreationSession } from '../src/creation-session'

const track: Track = {
  id: 'source:leaf',
  title: '素材',
  artists: [],
  durationMs: 10_000,
  source: { pluginId: 'source', resourceId: 'leaf', mediaKind: 'audio' },
}
const recipe: readonly SegmentRecipe[] = [{ sourceTrackId: track.id, startMs: 0, endMs: 1_000 }]
function fixture() {
  let value: unknown
  let enabled = true
  const ports = {
    read: () => value,
    write: vi.fn((next: unknown) => {
      value = structuredClone(next)
    }),
    rememberTracks: vi.fn(),
    changed: vi.fn(),
    isCurrent: () => enabled,
    readPublishedRecipe: vi.fn<MusicCreationPorts['readPublishedRecipe']>(),
    publishCustomTrack: vi.fn(() => ({
      ...track,
      id: 'local:custom:published',
      source: { pluginId: 'local-custom', resourceId: 'published', mediaKind: 'custom' as const },
    })),
    deleteCreationMaterials: vi.fn<MusicCreationPorts['deleteCreationMaterials']>(() => []),
  } satisfies MusicCreationPorts
  return {
    ports,
    create: () => createMusicCreationSession(ports),
    read: () => value as MusicCreationState,
    set: (next: unknown) => {
      value = next
    },
    disable: () => {
      enabled = false
    },
  }
}
describe('creation namespace session', () => {
  it('resets transient editors only after explicit successful clearing and releases them on session disposal', () => {
    const f = fixture()
    const session = f.create()
    const key = editingStateKey<{ title: string }>('creation-editor-test')
    const draft = session.editing.state(key, () => ({ title: 'unfinished' }))
    expect(session.snapshot()).not.toHaveProperty('editing')
    f.ports.write.mockImplementationOnce(() => {
      throw new Error('Disk full')
    })
    expect(() => session.clearData()).toThrow('Disk full')
    expect(session.editing.state(key, () => ({ title: '' }))).toBe(draft)
    session.clearData()
    expect(session.editing.state(key, () => ({ title: '' }))).toEqual({ title: '' })
    session.dispose()
    expect(() => session.editing.state(key, () => ({ title: '' }))).toThrow('disposed')
  })
  it('retains pending order/drafts once and restores without replaying writes or host actions', () => {
    const f = fixture()
    const session = f.create()
    expect(session.stageMaterialTrack(track)).toBe(true)
    expect(session.stageMaterialTrack(track)).toBe(false)
    expect(f.ports.rememberTracks).toHaveBeenCalledOnce()
    const collection = session.createMaterialCollection('合集')
    session.addTracksToMaterialCollection(collection.id, [track])
    expect(session.snapshot().pendingMaterialTrackIds).toEqual([])
    const draft: MusicCreationDraft = {
      activeCollectionId: collection.id,
      title: '未完成',
      recipe,
      exportFormat: 'wav',
    }
    session.saveDraft(draft)
    const before = f.read()
    const writes = f.ports.write.mock.calls.length
    session.dispose()
    const restored = f.create()
    expect(restored.snapshot()).toEqual(before)
    expect(f.ports.write).toHaveBeenCalledTimes(writes)
    expect(f.ports.publishCustomTrack).not.toHaveBeenCalled()
    expect(() => session.saveDraft(draft)).toThrow('停用')
    f.disable()
    for (const action of [
      () => restored.clearData(),
      () => restored.stageMaterialTrack(track),
      () => restored.publish('旧确认', collection.id, recipe),
      () => restored.deleteMaterialCollection(collection.id, true),
    ])
      expect(action).toThrow('停用')
    expect(f.read()).toEqual(before)
  })
  it('validates direct collection membership before invoking host publication, retaining failed drafts', () => {
    const f = fixture(),
      session = f.create()
    const collection = session.createMaterialCollection('合集')
    expect(() => session.publish('越界', collection.id, recipe)).toThrow('不属于素材合集')
    expect(f.ports.publishCustomTrack).not.toHaveBeenCalled()
    session.addTracksToMaterialCollection(collection.id, [track])
    session.saveDraft({
      activeCollectionId: collection.id,
      title: '草稿',
      recipe,
      exportFormat: 'mp3',
    })
    const before = session.snapshot()
    f.ports.publishCustomTrack.mockImplementationOnce(() => {
      throw new Error('Invalid leaf')
    })
    expect(() => session.publish('草稿', collection.id, recipe)).toThrow('Invalid leaf')
    expect(session.snapshot()).toEqual(before)
    f.ports.write.mockImplementationOnce(() => {
      throw new Error('Namespace save failed')
    })
    expect(() => session.publish('草稿', collection.id, recipe)).toThrow('Namespace save failed')
    expect(session.snapshot()).toEqual(before)
    const published = session.publish('草稿', collection.id, recipe)
    expect(session.snapshot().materialCollectionByTrackId[published.id]).toBe(collection.id)
    expect(session.snapshot().draft).toBeUndefined()
    f.ports.readPublishedRecipe.mockReturnValue(recipe)
    expect(() => session.removeTrackFromMaterialCollection(collection.id, track.id)).toThrow(
      '仍用于',
    )
    expect(() => session.deleteMaterialCollection(collection.id)).toThrow('级联清理')
  })
  it('separates clearing editing data from published assets and preserves unknown namespace fields', () => {
    const f = fixture()
    f.set({
      materialCollections: [],
      pendingMaterialTrackIds: [],
      materialCollectionByTrackId: {},
      futureField: { keep: true },
    })
    const session = f.create(),
      collection = session.createMaterialCollection('素材')
    session.addTracksToMaterialCollection(collection.id, [track])
    session.publish('作品', collection.id, recipe)
    session.clearData()
    expect(f.read()).toMatchObject({
      materialCollections: [],
      pendingMaterialTrackIds: [],
      materialCollectionByTrackId: {},
      futureField: { keep: true },
    })
    expect(f.ports.deleteCreationMaterials).not.toHaveBeenCalled()
  })
  it('does not replace the last valid draft after a failed namespace commit or load', () => {
    const f = fixture(),
      session = f.create(),
      collection = session.createMaterialCollection('合集')
    session.addTracksToMaterialCollection(collection.id, [track])
    session.saveDraft({
      activeCollectionId: collection.id,
      title: '保留',
      recipe,
      exportFormat: 'mp3',
    })
    const before = session.snapshot()
    f.ports.write.mockImplementationOnce(() => {
      throw new Error('Disk full')
    })
    expect(() => session.clearData()).toThrow('Disk full')
    expect(session.snapshot()).toEqual(before)
    expect(f.read()).toEqual(before)
    f.set({
      materialCollections: [null],
      pendingMaterialTrackIds: [],
      materialCollectionByTrackId: {},
    })
    const damaged = f.read()
    expect(() => f.create()).toThrow('原数据已保留')
    expect(f.read()).toBe(damaged)
  })
})
