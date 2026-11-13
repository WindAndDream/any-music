import type { LocalMusicLibrarySnapshot } from '@any-music/core'
import { describe, expect, it } from 'vitest'

import {
  exportPortableProductData,
  previewPortableProductImport,
} from '#workbench/storage/portable-product-data'
import { createProductGenerationStorage } from '#workbench/storage/product-generation-store'

import { initial, memory, options } from './product-storage-fixtures'

function setup() {
  const sourceState = memory(initial())
  const source = createProductGenerationStorage(sourceState.raw, options)
  const targetState = memory()
  const target = createProductGenerationStorage(targetState.raw, options)
  return {
    backup: exportPortableProductData(source, 'backup:fixture'),
    source,
    sourceState,
    target,
    targetState,
  }
}
describe('S06 portable data preview and transactional import', () => {
  it('round trips unknown plugin data verbatim without installation, grants, paths or manifest restoration', () => {
    const { backup, target } = setup()
    const opaque = JSON.parse(
      '{"pluginId":"unknown.plugin","schemaVersion":99,"data":{"__proto__":{"polluted":true},"nested":[{"future":true}]}}',
    )
    backup.namespaces.push(opaque)
    const operation = previewPortableProductImport(target, backup)
    operation.apply('use-backup')
    expect(exportPortableProductData(target).namespaces).toContainEqual(opaque)
    expect(target.read<LocalMusicLibrarySnapshot>('local-library:v1')?.tracks).toHaveLength(3)
    expect(target.snapshot().host).not.toHaveProperty('grants')
    expect({}).not.toHaveProperty('polluted')
    const revision = target.revision()
    const repeated = previewPortableProductImport(target, backup)
    expect(repeated.preview.alreadyImported).toBe(true)
    repeated.apply('use-backup')
    expect(target.revision()).toBe(revision)
  })
  it('previews stable-ID conflicts, preserves local data, and rejects reused IDs and stale previews', () => {
    const { backup, source, sourceState } = setup()
    backup.core.library.tracks[0]!.customName = 'Import renamed'
    const operation = previewPortableProductImport(source, backup)
    expect(operation.preview.conflicts).toContainEqual({ kind: 'track', id: 'fixture:audio:a' })
    expect(source.snapshot().core.library.tracks[0]?.customName).toBe('Fixture local name')
    operation.apply('keep-current')
    expect(source.snapshot().core.library.tracks[0]?.customName).toBe('Fixture local name')
    backup.core.library.tracks[0]!.customName = 'changed again'
    expect(() => previewPortableProductImport(source, backup)).toThrow('reused')
    expect(() => source.write('ui-theme:v1', {})).toThrow('Reload required')
    const reloaded = createProductGenerationStorage(sourceState.raw, options)
    const another = previewPortableProductImport(reloaded, { ...backup, backupId: 'another' })
    reloaded.write('ui-theme:v1', {})
    expect(() => another.apply('use-backup')).toThrow('stale')
  })
  it('preserves newer or damaged plugin data while keeping host reads and writes independent', () => {
    for (const pluginId of ['feature.tags', 'feature.composer']) {
      for (const schemaVersion of [1, 99]) {
        const { backup, target, targetState } = setup()
        const future = {
          pluginId,
          schemaVersion,
          data: schemaVersion === 99 ? { futureTags: ['keep'] } : 'damaged namespace',
        }
        backup.namespaces = backup.namespaces
          .filter((entry) => entry.pluginId !== future.pluginId)
          .concat(future)
        previewPortableProductImport(target, backup).apply('use-backup')
        const reloaded = createProductGenerationStorage(targetState.raw, options)
        const library = reloaded.read<LocalMusicLibrarySnapshot>('local-library:v1')!
        library.profile = { ...library.profile, displayName: 'Host edit' }
        reloaded.write('local-library:v1', library)
        expect(
          reloaded.read<LocalMusicLibrarySnapshot>('local-library:v1')?.profile.displayName,
        ).toBe('Host edit')
        if (pluginId === 'feature.tags') {
          expect(library.tracks[0]?.customTags).toEqual([])
          expect(() => reloaded.write('plugin:feature.tags:v1', { associations: [] })).toThrow(
            'newer writer',
          )
          expect(() => reloaded.read('plugin:feature.tags:v1')).toThrow('Unsupported tag namespace')
        } else {
          expect(() => reloaded.read('plugin:feature.composer:v1')).toThrow(
            'Unsupported creation namespace',
          )
          expect(() =>
            reloaded.write('plugin:feature.composer:v1', {
              materialCollections: [],
              pendingMaterialTrackIds: [],
              materialCollectionByTrackId: {},
            }),
          ).toThrow('newer writer')
          reloaded.write('local-library:v1', library)
        }
        expect(exportPortableProductData(reloaded).namespaces).toContainEqual(future)
      }
    }
  })
  it('preflights quotas, future core schemas, duplicates and dangling recipes without writes', () => {
    const { backup, target, targetState } = setup()
    const count = targetState.writes.length
    expect(() => previewPortableProductImport(target, { ...backup, schemaVersion: 2 })).toThrow(
      'schema',
    )
    expect(() =>
      previewPortableProductImport(target, {
        ...backup,
        namespaces: [{ pluginId: 'x', schemaVersion: 1, data: 'x'.repeat(1024 * 1024) }],
      }),
    ).toThrow('byte')
    let deep: unknown = true
    for (let i = 0; i < 40; i++) deep = { next: deep }
    expect(() =>
      previewPortableProductImport(target, {
        ...backup,
        namespaces: [{ pluginId: 'x', schemaVersion: 1, data: deep }],
      }),
    ).toThrow('depth')
    expect(() =>
      previewPortableProductImport(target, {
        ...backup,
        namespaces: [...backup.namespaces, ...backup.namespaces],
      }),
    ).toThrow('duplicate')
    backup.core.library.customTracks[0]!.recipe = [
      { sourceTrackId: 'missing', startMs: 0, endMs: 10 },
    ]
    expect(() => previewPortableProductImport(target, backup)).toThrow('IDs/recipes')
    backup.core.library.customTracks[0]!.recipe = [
      { sourceTrackId: backup.core.library.customTracks[0]!.trackId, startMs: 0, endMs: 10 },
    ]
    expect(() => previewPortableProductImport(target, backup)).toThrow('IDs/recipes')
    expect(targetState.writes).toHaveLength(count)
  })
  it.each([false, true])(
    'rolls back an import as a complete generation at every write point (%s)',
    (persistFirst) => {
      const { backup, targetState, target } = setup()
      const before = target.snapshot()
      const baseline = memory(targetState.values)
      const imported = createProductGenerationStorage(baseline.raw, options)
      previewPortableProductImport(imported, backup).apply('use-backup')
      for (let point = 1; point <= baseline.writes.length; point++) {
        const state = memory(targetState.values)
        const store = createProductGenerationStorage(state.raw, options)
        const operation = previewPortableProductImport(store, backup)
        state.failAt(point, persistFirst)
        expect(() => operation.apply('use-backup')).toThrow('Power loss')
        state.recover()
        const restored = createProductGenerationStorage(state.raw, options)
        expect([before, imported.snapshot()]).toContainEqual(restored.snapshot())
        const retry = previewPortableProductImport(restored, backup)
        retry.apply('use-backup')
        expect(restored.snapshot()).toEqual(imported.snapshot())
      }
    },
  )
})
