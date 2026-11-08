import { AppError } from '@any-music/core'
import type { HttpClient, Track } from '@any-music/core'
import type { MusicCreationImplementation, MusicCreationSession } from '@any-music/ui'
import { describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick, shallowReactive, shallowRef } from 'vue'

import { createPlayerExportRecipe } from '../../../src/features/audio-export/player-export-recipe'
import { useDownloadManager } from '../../../src/features/downloads/use-download-manager'
import { useLocalMusicLibrary } from '../../../src/features/library/use-local-music-library'
import { useAudioPlayer } from '../../../src/features/player/use-audio-player'
import type { AudioPlayerProps } from '../../../src/features/player/use-audio-player'
import { useMusicCreation } from '../../../src/features/plugins/use-music-creation'
import { configureWorkbenchRuntime } from '../../../src/runtime/workbench-runtime'
import { createProductGenerationStorage } from '../../../src/storage/product-generation-store'
import { initial, memory, options } from '../../storage/product-storage-fixtures'

const leaf: Track = {
  id: 'source:new',
  title: '新素材',
  artists: [{ id: 'artist', name: '署名' }],
  durationMs: 10_000,
  source: { pluginId: 'source', resourceId: 'new', mediaKind: 'audio' },
}
const recipe = [{ sourceTrackId: leaf.id, startMs: 0, endMs: 2_000 }]
const exportAudio = vi.hoisted(() =>
  vi.fn(async (_options: unknown) => ({ blob: new Blob(['test']), extension: 'mp3' })),
)
vi.mock('#workbench/features/audio-export/audio-exporter', () => ({
  exportAudioSegments: exportAudio,
}))
function fixture(loadMusicCreation: () => Promise<MusicCreationImplementation>, active = true) {
  vi.stubGlobal('window', { setTimeout, clearTimeout, location: { origin: 'https://example.com' } })
  const data = memory(initial())
  const storage = createProductGenerationStorage(data.raw, options)
  const saveBlob = vi.fn(async () => {})
  const runtime = {
    externalPlugins: 'none' as const,
    storage,
    loadMusicCreation,
    saveBlob,
    http: {} as HttpClient,
    builtInMusicSources: [],
    configureProxy() {},
    openLogin() {},
  }
  configureWorkbenchRuntime(runtime)
  const enabled = shallowRef(active)
  const scope = effectScope()
  const host = scope.run(useLocalMusicLibrary)!
  const withdraw = vi.fn()
  const feature = scope.run(() =>
    useMusicCreation(
      runtime,
      () => enabled.value,
      {
        rememberTracks: host.rememberTracks,
        publishCustomTrack: host.publishCustomTrack,
        readPublishedRecipe: (id) => host.getCustomTrack(id)?.recipe,
        deleteCreationMaterials: host.deleteCreationMaterials,
      },
      withdraw,
    ),
  )!
  return { data, storage, scope, host, feature, enabled, withdraw, saveBlob }
}
async function implementation(): Promise<MusicCreationImplementation> {
  return import('@any-music/plugin-music-creation/vue')
}
async function ready(f: ReturnType<typeof fixture>): Promise<MusicCreationSession> {
  await vi.waitFor(() => expect(f.feature.available.value).toBe(true), { timeout: 10_000 })
  return f.feature.current()
}
describe('creation host boundary', () => {
  it('plays and prepares downloads for migrated works without loading creation code', async () => {
    const loader = vi.fn(implementation)
    const f = fixture(loader, false)
    const asset = f.host.getCustomTrack('local:custom:mix')!
    expect(asset.materialCollectionId).toBe('')
    expect(asset.compiledSegments).toHaveLength(2)
    expect(f.host.getTrack(asset.trackId)?.artists[0]?.name).toBe(asset.creator.displayName)
    const track = f.host.getTrack(asset.trackId)!
    expect(createPlayerExportRecipe(track, asset.compiledSegments)).toEqual(
      asset.compiledSegments.map(({ sourceTrackId, startMs, endMs }) => ({
        sourceTrackId,
        startMs,
        endMs,
      })),
    )
    const quality = { id: 'default', label: '默认', rank: 1 }
    const resolveMedia = vi.fn(async (_track: Track) => ({
      type: 'remote-url' as const,
      url: 'https://example.com/current',
      backupUrls: [],
      loadingStrategy: 'range' as const,
      quality,
      availableQualities: [quality],
    }))
    const emit = vi.fn()
    const props = shallowReactive<AudioPlayerProps>({
      virtualSegments: asset.compiledSegments,
      repeatOne: false,
      downloadBusy: false,
      resolveTrack: f.host.getTrack,
      resolveMedia,
      canPrefetchMedia: () => false,
      loadMediaFile: vi.fn(),
      renderCustomMedia: vi.fn(),
    })
    const player = f.scope.run(() =>
      useAudioPlayer({
        props,
        audio: shallowRef(null),
        emit,
      }),
    )!
    props.track = track
    await vi.waitFor(() => expect(player.status.value, player.statusLabel.value).toBe('ready'))
    expect(resolveMedia).toHaveBeenCalledTimes(1)
    expect(resolveMedia.mock.calls[0]?.[0]).toMatchObject({
      id: asset.compiledSegments[0]!.sourceTrackId,
    })
    const manager = f.scope.run(() =>
      useDownloadManager({
        concurrency: 1,
        creatorName: '用户',
        createRecipe: (candidate) =>
          createPlayerExportRecipe(
            candidate,
            f.host.getCustomTrack(candidate.id)?.compiledSegments,
          ),
        resolveTrack: f.host.getTrack,
        resolveMedia,
      }),
    )!
    exportAudio.mockClear()
    await manager.startDownloadBatch({
      tracks: [track],
      origin: { kind: 'player', label: '播放器' },
    })
    expect(exportAudio).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        segments: createPlayerExportRecipe(track, asset.compiledSegments),
      }),
    )
    expect(f.saveBlob).toHaveBeenCalledOnce()
    expect(manager.batches.value[0]?.status).toBe('completed')
    props.track = undefined
    await nextTick()
    resolveMedia.mockRejectedValueOnce(new AppError('media-unavailable', '叶子来源已停用'))
    props.track = track
    await vi.waitFor(() => expect(player.status.value).toBe('error'))
    expect(player.statusLabel.value).toContain('叶子来源已停用')
    expect(f.host.getCustomTrack(asset.trackId)).toBeDefined()
    expect(loader).not.toHaveBeenCalled()
    f.scope.stop()
  })
  it('restores only the creation namespace, withdraws immediately and rejects old events after re-enable', async () => {
    const f = fixture(implementation)
    const session = await ready(f)
    expect(session.snapshot().materialCollections.length).toBeGreaterThan(0)
    expect(f.host).not.toHaveProperty('materialCollections')
    session.stageMaterialTrack(leaf)
    const collection = session.createMaterialCollection('合集')
    session.addTracksToMaterialCollection(collection.id, [leaf])
    session.saveDraft({
      activeCollectionId: collection.id,
      title: '草稿',
      recipe,
      exportFormat: 'mp3',
    })
    const namespace = f.storage.read('plugin:feature.composer:v1')
    f.host.createPlaylist('核心歌单')
    f.host.persistNow()
    expect(f.storage.read('plugin:feature.composer:v1')).toEqual(namespace)
    const writes = f.data.writes.length
    f.enabled.value = false
    expect(f.feature.available.value).toBe(false)
    expect(f.feature.state.value.materialCollections).toEqual([])
    expect(f.withdraw).toHaveBeenCalledTimes(2)
    expect(() => session.publish('旧确认', collection.id, recipe)).toThrow('停用')
    expect(f.storage.read('plugin:feature.composer:v1')).toEqual(namespace)
    f.enabled.value = true
    const resumed = await ready(f)
    expect(resumed.snapshot().draft?.title).toBe('草稿')
    expect(f.data.writes).toHaveLength(writes)
    expect(() => session.clearData()).toThrow('停用')
    f.scope.stop()
    expect(() => resumed.stageMaterialTrack(leaf)).toThrow('停用')
  })
  it('publishes via host recompilation, preserves nested leaves/credits and protects shared records during explicit cleanup', async () => {
    const f = fixture(implementation),
      session = await ready(f)
    const collection = session.createMaterialCollection('第一套')
    const shared = { ...leaf, id: 'source:shared' }
    const playlist = f.host.createPlaylist('保留')
    f.host.addTracksToPlaylist(playlist.id, [shared])
    session.addTracksToMaterialCollection(collection.id, [leaf, shared])
    const first = session.publish('作品', collection.id, recipe)
    const secondCollection = session.createMaterialCollection('第二套')
    session.addTracksToMaterialCollection(secondCollection.id, [first])
    const nested = session.publish('嵌套', secondCollection.id, [
      { sourceTrackId: first.id, startMs: 500, endMs: 1_500 },
    ])
    expect(f.host.getCustomTrack(nested.id)?.compiledSegments).toEqual([
      {
        sourceTrackId: leaf.id,
        startMs: 500,
        endMs: 1_500,
        virtualStartMs: 0,
        virtualEndMs: 1_000,
      },
    ])
    expect(f.host.getCustomTrack(nested.id)?.sourceCredits).toEqual([
      { pluginId: 'source', artistId: 'artist', artistName: '署名' },
    ])
    expect(() => session.publish('越界', secondCollection.id, recipe)).toThrow('不属于素材合集')
    const before = session.snapshot()
    expect(() => session.deleteMaterialCollection(collection.id, true)).toThrow('下游作品')
    expect(session.snapshot()).toEqual(before)
    session.deleteMaterialCollection(secondCollection.id, true)
    session.deleteMaterialCollection(collection.id, true)
    expect(f.host.getTrack(first.id)).toBeUndefined()
    expect(f.host.getTrack(leaf.id)).toBeUndefined()
    expect(f.host.getTrack(shared.id)).toEqual(shared)
    expect(f.host.playlists.value.find((item) => item.id === playlist.id)?.trackIds).toEqual([
      shared.id,
    ])
    f.scope.stop()
  })
  it('keeps standard works when editing data is cleared and never fabricates fallback collections on reload', async () => {
    const f = fixture(implementation),
      session = await ready(f)
    session.clearData()
    const before = f.storage.snapshot().core.library.customTracks
    expect(before).not.toHaveLength(0)
    f.host.persistNow()
    configureWorkbenchRuntime({
      externalPlugins: 'none',
      storage: f.storage,
      http: {} as HttpClient,
      builtInMusicSources: [],
      configureProxy() {},
      openLogin() {},
    })
    const scope = effectScope(),
      reloaded = scope.run(useLocalMusicLibrary)!
    expect(reloaded.customTracks.value).toHaveLength(before.length)
    expect(f.storage.read('plugin:feature.composer:v1')).toMatchObject({
      materialCollections: [],
      pendingMaterialTrackIds: [],
      materialCollectionByTrackId: {},
    })
    scope.stop()
    f.scope.stop()
  })
  it('isolates failed/late loaders and newer namespaces while host records remain readable', async () => {
    const loader = vi
      .fn<() => Promise<MusicCreationImplementation>>()
      .mockRejectedValueOnce(new Error('Chunk unavailable'))
      .mockImplementation(implementation)
    const f = fixture(loader)
    await vi.waitFor(() => expect(f.feature.error.value).toBeDefined())
    const before = f.storage.snapshot()
    await f.feature.retry()
    expect(f.feature.available.value).toBe(true)
    expect(f.storage.snapshot()).toEqual(before)
    f.enabled.value = false
    const future = f.storage.snapshot()
    future.namespaces = future.namespaces.map((entry) =>
      entry.pluginId === 'feature.composer' ? { ...entry, schemaVersion: 99 } : entry,
    )
    f.storage.replace(future, f.storage.revision())
    f.enabled.value = true
    await vi.waitFor(() => expect(f.feature.error.value).toBeDefined())
    expect(f.host.getCustomTrack('local:custom:mix')).toBeDefined()
    f.scope.stop()
    let resolve!: (value: MusicCreationImplementation) => void
    const late = fixture(
      () =>
        new Promise((done) => {
          resolve = done
        }),
    )
    late.scope.stop()
    resolve(await implementation())
    await Promise.resolve()
    expect(late.feature.available.value).toBe(false)
  })
})
