import type { DownloadHistorySnapshot, LocalMusicLibrarySnapshot } from '@any-music/core'
import { describe, expect, it } from 'vitest'

import { exportPortableProductData } from '#workbench/storage/portable-product-data'
import { PRODUCT_DATA_LIMITS } from '#workbench/storage/product-data'
import {
  createProductGenerationStorage,
  loadProductGeneration,
  PRODUCT_COMMIT_KEY,
} from '#workbench/storage/product-generation-store'

import { initial, memory, options } from './product-storage-fixtures'

describe('S06 product ownership and generation commit', () => {
  it.each(['userscript', 'tauri'] as const)(
    'restores collection presentation preferences in %s product storage',
    (runtime) => {
      const state = memory()
      const store = createProductGenerationStorage(state.raw, { runtime })
      const views = {
        schemaVersion: 1,
        views: {
          flat: { displayMode: 'compact', mobileColumns: 2 },
          'platform:source': { displayMode: 'comfortable', mobileColumns: 1 },
        },
      }
      for (const context of ['queue', 'favorites', 'downloads'])
        store.write(`collection-display:${context}:v1`, views)
      store.write('download-collection-order:v1', { schemaVersion: 1, itemIds: ['two', 'one'] })
      const restored = createProductGenerationStorage(state.raw, { runtime })
      for (const context of ['queue', 'favorites', 'downloads'])
        expect(restored.read(`collection-display:${context}:v1`)).toEqual(views)
      expect(restored.read('download-collection-order:v1')).toEqual({
        schemaVersion: 1,
        itemIds: ['two', 'one'],
      })
      expect(restored.snapshot().namespaces).toEqual([])
    },
  )

  it('starts with current data without scanning old business keys', () => {
    const state = memory({ 'local-library:v1': { schemaVersion: 1, collections: [] } })
    const store = createProductGenerationStorage(state.raw, options)
    expect(store.read<LocalMusicLibrarySnapshot>('local-library:v1')?.tracks).toEqual([])
    expect(state.writes.every((key) => key.startsWith('product-data:'))).toBe(true)
    expect(Object.keys(store.snapshot())).toEqual(['schemaVersion', 'core', 'host', 'namespaces'])
  })

  it('routes readers and writers through one committed ownership graph', () => {
    const state = memory(initial())
    const store = createProductGenerationStorage(state.raw, options)
    expect(JSON.stringify(store.snapshot().host.filters)).not.toContain('user-tag')
    expect(store.snapshot().host.navigation).toMatchObject({
      order: [
        'feature.tags/view-tags',
        'feature.composer/view-composer',
        'feature.composer/view-custom-tracks',
        'system.sources/view-catalog',
        'system.playback/view-queue',
        'system.library/view-favorites',
        'system.library/view-playlists',
        'system.downloads/view-downloads',
        'system.library/view-history',
        'system.plugins/view-plugins',
      ],
    })
    expect(store.read('music-source-workspace:v1')).toMatchObject({
      drawers: [{ isExpanded: false }],
      disabledPluginIds: ['custom-fixture-v2'],
    })
    expect(store.read('download-history:v1')).toMatchObject({
      batches: [
        {
          status: 'running',
          items: [{ attempts: [{ status: 'failed' }, { status: 'running' }] }],
        },
      ],
    })
    expect(store.read('favorite-collection:v1')).toMatchObject({
      trackIds: ['fixture:audio:b', 'fixture:audio:a'],
    })
    const changed = store.read<LocalMusicLibrarySnapshot>('local-library:v1')!
    changed.tracks = changed.tracks.map((record) => ({ ...record, customTags: ['edited'] }))
    store.write('local-library:v1', changed)
    expect(
      store.read<LocalMusicLibrarySnapshot>('local-library:v1')?.tracks[0]?.customTags,
    ).toEqual([])
    expect(store.read('plugin:feature.tags:v1')).toMatchObject({
      associations: [expect.objectContaining({ tags: ['user-tag'] })],
    })
    const tagData = store.read<{ associations: { trackId: string; tags: string[] }[] }>(
      'plugin:feature.tags:v1',
    )!
    store.write('plugin:feature.tags:v1', {
      ...tagData,
      associations: tagData.associations.map((item) =>
        Object.assign({}, item, { tags: ['edited'] }),
      ),
    })
    expect(store.read('plugin:feature.tags:v1')).toMatchObject({
      associations: [expect.objectContaining({ tags: ['edited'] })],
    })
    expect(() => store.write('toString', {})).toThrow('Unknown product')
    expect(() => store.read('__proto__')).toThrow('Unknown product')
  })

  it('isolates runtime proxy secrets from ownership data and portable export', () => {
    const state = memory(initial())
    const store = createProductGenerationStorage(state.raw, options)
    store.write('music-source-workspace:v1', {
      schemaVersion: 1,
      proxySettings: { isEnabled: true, password: 'secret-marker' },
    })
    expect(store.read('music-source-workspace:v1')).toMatchObject({
      proxySettings: { password: 'secret-marker' },
    })
    expect(JSON.stringify(store.snapshot())).not.toContain('secret-marker')
    expect(JSON.stringify(exportPortableProductData(store))).not.toContain('secret-marker')
    const desktop = createProductGenerationStorage(memory(state.values).raw, { runtime: 'tauri' })
    expect(desktop.read('music-source-workspace:v1')).not.toHaveProperty('proxySettings.password')
  })

  it.each([false, true])(
    'recovers idempotently at every initial write, persisted-before-error=%s',
    (persistFirst) => {
      const baseline = memory()
      createProductGenerationStorage(baseline.raw, options)
      for (let point = 1; point <= baseline.writes.length; point++) {
        const state = memory()
        state.failAt(point, persistFirst)
        expect(() => createProductGenerationStorage(state.raw, options)).toThrow('Power loss')
        state.recover()
        const restored = createProductGenerationStorage(state.raw, options)
        const revision = restored.revision()
        expect(restored.read<LocalMusicLibrarySnapshot>('local-library:v1')?.tracks).toHaveLength(0)
        expect(createProductGenerationStorage(state.raw, options).revision()).toBe(revision)
      }
    },
  )

  it.each([false, true])(
    'never publishes partial updates across any write point, persisted-before-error=%s',
    (persistFirst) => {
      const original = memory(initial())
      const first = createProductGenerationStorage(original.raw, options)
      const changed = { schemaVersion: 1, trackIds: ['fixture:audio:a'], mode: 'repeat-one' }
      const clone = memory(original.values)
      const ready = createProductGenerationStorage(clone.raw, options)
      ready.write('playback-queue:v1', changed)
      for (let point = 1; point <= clone.writes.length; point++) {
        const state = memory(original.values)
        const store = createProductGenerationStorage(state.raw, options)
        state.failAt(point, persistFirst)
        expect(() => store.write('playback-queue:v1', changed)).toThrow('Power loss')
        expect(() => store.write('playback-queue:v1', changed)).toThrow('Restart required')
        state.recover()
        const result = createProductGenerationStorage(state.raw, options)
        expect(result.snapshot()).toEqual(
          result.revision() === first.revision() ? first.snapshot() : ready.snapshot(),
        )
      }
    },
  )

  it('blocks unknown root/repository/namespace schemas and stale tabs without deleting originals', () => {
    const unknown = memory()
    const current = createProductGenerationStorage(unknown.raw, options)
    expect(() => current.write('local-library:v1', { schemaVersion: 99 })).toThrow(
      'Unknown repository schema',
    )
    const state = memory(initial())
    const store = createProductGenerationStorage(state.raw, options)
    const stale = createProductGenerationStorage(state.raw, options)
    store.write('ui-theme:v1', { themeId: 'default', settingsByTheme: {} })
    expect(() => stale.write('ui-theme:v1', {})).toThrow('changed')
    state.values[PRODUCT_COMMIT_KEY] = { schemaVersion: 99 }
    expect(() => createProductGenerationStorage(state.raw, options)).toThrow('Unsupported')
  })

  it('detects corrupt staged or committed data before readers can see it', () => {
    const state = memory(initial())
    createProductGenerationStorage(state.raw, options)
    const commit = state.values[PRODUCT_COMMIT_KEY] as { slot: number; id: string }
    state.values[`product-data:g${commit.slot}:${commit.id}:core`] = {}
    expect(() => loadProductGeneration(state.raw)).toThrow('checksum')
    expect(() => createProductGenerationStorage(state.raw, options)).toThrow('checksum')
  })

  it.each(['core', 'host', 'namespaces', 'manifest'])(
    'verifies staged %s before publishing and retains the previous snapshot after failure',
    (part) => {
      const state = memory(initial())
      const store = createProductGenerationStorage(state.raw, options)
      const before = store.snapshot()
      const pointer = state.values[PRODUCT_COMMIT_KEY]
      const write = state.raw.write
      state.raw.write = (key, value) => {
        write(key, value)
        if (!key.endsWith(`:${part}`)) return
        if (part === 'manifest')
          (state.values[key] as { checksums: Record<string, string> }).checksums.core = 'c1:0:0'
        else if (part === 'namespaces')
          (state.values[key] as unknown[]).push({ pluginId: 'corrupt', schemaVersion: 1, data: {} })
        else (state.values[key] as Record<string, unknown>).corrupt = true
      }
      expect(() => store.write('ui-theme:v1', { themeId: 'studio' })).toThrow('checksum')
      expect(state.values[PRODUCT_COMMIT_KEY]).toEqual(pointer)
      expect(store.snapshot()).toEqual(before)
      expect(createProductGenerationStorage(state.raw, options).snapshot()).toEqual(before)
      expect(() => store.write('ui-theme:v1', {})).toThrow('Restart required')
    },
  )

  it('keeps the loaded snapshot isolated from caller, read and snapshot mutations', () => {
    const state = memory(initial())
    const store = createProductGenerationStorage(state.raw, options)
    const views = { schemaVersion: 1, views: { flat: { displayMode: 'compact' } } }
    store.write('collection-display:favorites:v1', views)
    views.views.flat.displayMode = 'external mutation'
    const read = store.read<typeof views>('collection-display:favorites:v1')!
    read.views.flat.displayMode = 'read mutation'
    const snapshot = store.snapshot()
    snapshot.namespaces[0]!.data = { externalMutation: true }
    snapshot.core.library.tracks.length = 0
    snapshot.host.favoritesDisplay = 'snapshot mutation'
    store.write('app-shell:v1', { schemaVersion: 1, isSidebarCollapsed: true })
    const restored = createProductGenerationStorage(state.raw, options)
    expect(restored.read('collection-display:favorites:v1')).toEqual({
      schemaVersion: 1,
      views: { flat: { displayMode: 'compact' } },
    })
    expect(restored.snapshot().core.library.tracks.length).toBeGreaterThan(0)
    expect(restored.snapshot().namespaces[0]!.data).not.toEqual({ externalMutation: true })
  })

  it('does not mutate the current host or namespaces when a projection fails', () => {
    const state = memory(initial())
    const seed = createProductGenerationStorage(state.raw, options)
    const data = seed.snapshot()
    const tags = data.namespaces.find((entry) => entry.pluginId === 'feature.tags')!
    tags.schemaVersion = 99
    seed.replace(data, seed.revision())
    const store = createProductGenerationStorage(state.raw, options)
    const before = store.snapshot()
    expect(() =>
      store.write('catalog-filter-history:v2', [
        { scopeId: 'scope', dimension: 'tracks', filters: { tags: ['changed'] } },
      ]),
    ).toThrow('newer writer')
    expect(store.snapshot()).toEqual(before)
    store.write('ui-theme:v1', { themeId: 'studio' })
    const restored = createProductGenerationStorage(state.raw, options)
    expect(restored.snapshot().namespaces).toEqual(before.namespaces)
    expect(restored.snapshot().host.filters).toEqual(before.host.filters)
  })

  it('retains total, namespace and complete-product depth budgets before staging', () => {
    const state = memory(initial())
    const store = createProductGenerationStorage(state.raw, options)
    const before = store.snapshot()
    const writes = state.writes.length
    expect(() =>
      store.write('ui-theme:v1', { payload: 'x'.repeat(PRODUCT_DATA_LIMITS.totalBytes) }),
    ).toThrow('byte budget')
    expect(() =>
      store.write('plugin:feature.tags:v1', {
        associations: [],
        payload: 'x'.repeat(PRODUCT_DATA_LIMITS.namespaceBytes),
      }),
    ).toThrow('byte budget')
    let deep: unknown = null
    for (let i = 0; i < PRODUCT_DATA_LIMITS.depth; i++) deep = { child: deep }
    expect(() => store.write('ui-theme:v1', deep)).toThrow('depth budget')
    expect(state.writes).toHaveLength(writes)
    expect(store.snapshot()).toEqual(before)
    store.write('ui-theme:v1', { themeId: 'studio' })
    expect(createProductGenerationStorage(state.raw, options).read('ui-theme:v1')).toEqual({
      themeId: 'studio',
    })
  })

  it('validates the durable read-back before canonicalization without invoking accessors', () => {
    const state = memory(initial())
    const store = createProductGenerationStorage(state.raw, options)
    const before = store.snapshot()
    const pointer = state.values[PRODUCT_COMMIT_KEY]
    const read = state.raw.read
    let getterCalls = 0
    state.raw.read = (key, fallback) => {
      const value = read(key, fallback)
      if (key.endsWith(':host'))
        Object.defineProperty(value, 'corrupt', {
          enumerable: true,
          get() {
            getterCalls++
            return true
          },
        })
      return value
    }
    expect(() => store.write('ui-theme:v1', { themeId: 'studio' })).toThrow('accessors')
    expect(getterCalls).toBe(0)
    expect(state.values[PRODUCT_COMMIT_KEY]).toEqual(pointer)
    expect(store.snapshot()).toEqual(before)
    expect(() => store.write('ui-theme:v1', {})).toThrow('Restart required')
  })

  it('rejects competing writers while the generation is staging', () => {
    const state = memory(initial())
    const first = createProductGenerationStorage(state.raw, options)
    const second = createProductGenerationStorage(state.raw, options)
    const write = state.raw.write
    let interleaved = false
    state.raw.write = (key, value) => {
      write(key, value)
      if (!interleaved && key.endsWith(':core')) {
        interleaved = true
        expect(() => second.write('ui-theme:v1', { themeId: 'studio' })).toThrow('busy')
      }
    }
    first.write('ui-theme:v1', { themeId: 'default' })
    expect(createProductGenerationStorage(state.raw, options).read('ui-theme:v1')).toMatchObject({
      themeId: 'default',
    })
  })

  it('excludes a competing commit between the final pointer check and publication', () => {
    const state = memory()
    const first = createProductGenerationStorage(state.raw, options)
    const second = createProductGenerationStorage(state.raw, options)
    const write = state.raw.write
    let interleaved = false
    state.raw.write = (key, value) => {
      if (key === PRODUCT_COMMIT_KEY && !interleaved) {
        interleaved = true
        expect(() => second.write('ui-theme:v1', { themeId: 'studio' })).toThrow('busy')
      }
      write(key, value)
    }
    first.write('playback-queue:v1', { schemaVersion: 1, trackIds: [], mode: 'repeat-one' })
    expect(interleaved).toBe(true)
    expect(() => second.write('ui-theme:v1', { themeId: 'studio' })).toThrow('changed')
    const restored = createProductGenerationStorage(state.raw, options)
    expect(restored.read('playback-queue:v1')).toMatchObject({ mode: 'repeat-one' })
    expect(restored.read('ui-theme:v1')).toBeUndefined()
    restored.write('ui-theme:v1', { themeId: 'studio' })
    expect(
      createProductGenerationStorage(state.raw, options).read('playback-queue:v1'),
    ).toMatchObject({ mode: 'repeat-one' })
  })

  it('does not change runtime proxy settings after a failed generation write', () => {
    const state = memory()
    const store = createProductGenerationStorage(state.raw, options)
    state.failAt(1)
    expect(() => store.write('ui-theme:v1', { themeId: 'studio' })).toThrow('Power loss')
    state.recover()
    const count = state.writes.length
    expect(() =>
      store.write('music-source-workspace:v1', {
        schemaVersion: 1,
        proxySettings: { password: 'must-not-save' },
      }),
    ).toThrow('Restart required')
    expect(state.writes).toHaveLength(count)
    expect(state.values['runtime:proxy:v1']).toBeUndefined()
  })

  it.each([
    ['https://cdn.example.com/cover.jpg?size=200', true],
    ['http://example.com/content/1', true],
    ['//cdn.example.com/cover.jpg', true],
    ['blob:https://example.com/expired-object', false],
    ['data:image/png;base64,aGVsbG8=', false],
    ['file:///private/cover.png', false],
    ['javascript:alert(1)', false],
    ['https://user:password@example.com/private', false],
  ])('persists only stable library/download metadata URLs: %s', (url, stable) => {
    const state = memory(initial())
    const store = createProductGenerationStorage(state.raw, options)
    const library = store.read<LocalMusicLibrarySnapshot>('local-library:v1')!
    library.tracks[0]!.track.artworkUrl = url
    library.tracks[0]!.track.source.pageUrl = url
    const downloads = store.read<DownloadHistorySnapshot>('download-history:v1')!
    downloads.batches[0]!.items[0]!.track.artworkUrl = url
    downloads.batches[0]!.items[0]!.track.source.pageUrl = url
    store.write('local-library:v1', library)
    store.write('download-history:v1', downloads)
    const restored = createProductGenerationStorage(state.raw, options)
    const record = restored.snapshot().core.library.tracks[0]!
    expect(record.track.artworkUrl).toBe(stable ? url : undefined)
    expect(record.track.source.pageUrl).toBe(stable ? url : undefined)
    const item =
      restored.read<DownloadHistorySnapshot>('download-history:v1')!.batches[0]!.items[0]!
    expect(item.track.artworkUrl).toBe(stable ? url : undefined)
    expect(item.track.source.pageUrl).toBe(stable ? url : undefined)
    expect(record.track.id).toBe(library.tracks[0]!.track.id)
    expect(restored.snapshot().namespaces).toEqual(store.snapshot().namespaces)
    if (!stable) expect(JSON.stringify(exportPortableProductData(restored))).not.toContain(url)
  })

  it('reclaims prior immutable chunks without touching the live generation', () => {
    const state = memory(initial())
    state.raw.remove = (key) => {
      delete state.values[key]
    }
    const store = createProductGenerationStorage(state.raw, options)
    for (let i = 0; i < 20; i++)
      store.write('ui-theme:v1', { themeId: 'default', settingsByTheme: {} })
    expect(
      Object.keys(state.values).filter((key) => key.startsWith('product-data:g')),
    ).toHaveLength(8)
    expect(createProductGenerationStorage(state.raw, options).snapshot()).toEqual(store.snapshot())
  })

  it.each([false, true])(
    'retains the complete current generation through every reclamation failure (%s)',
    (persistFirst) => {
      const start = memory(initial())
      const store = createProductGenerationStorage(start.raw, options)
      store.write('ui-theme:v1', { themeId: 'studio', settingsByTheme: {} })
      const before = store.snapshot()
      const baseline = memory(start.values)
      const next = createProductGenerationStorage(baseline.raw, options)
      next.write('ui-theme:v1', { themeId: 'default', settingsByTheme: {} })
      for (let point = 1; point <= baseline.writes.length; point++) {
        const state = memory(start.values)
        const current = createProductGenerationStorage(state.raw, options)
        state.failAt(point, persistFirst)
        expect(() =>
          current.write('ui-theme:v1', { themeId: 'default', settingsByTheme: {} }),
        ).toThrow('Power loss')
        state.recover()
        const restored = createProductGenerationStorage(state.raw, options)
        expect([before, next.snapshot()]).toContainEqual(restored.snapshot())
      }
    },
  )
})
