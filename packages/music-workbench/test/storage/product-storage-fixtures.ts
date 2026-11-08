import { readFileSync } from 'node:fs'

import { copyJson } from '#workbench/storage/product-data'
import { createProductGenerationStorage } from '#workbench/storage/product-generation-store'
import type { ProductGenerationBackend } from '#workbench/storage/product-generation-store'

function fixture(name: string): Record<string, unknown> {
  return JSON.parse(
    readFileSync(new URL(`../fixtures/storage/${name}.json`, import.meta.url), 'utf8'),
  )
}
export function memory(seed: Record<string, unknown> = {}) {
  const values = copyJson(seed)
  let count = 0
  let fail = Infinity
  let after = false
  let writing = false
  const writes: string[] = []
  const raw: ProductGenerationBackend = {
    withExclusiveWrite(operation) {
      if (writing) throw new Error('Product storage is busy')
      writing = true
      try {
        return operation()
      } finally {
        writing = false
      }
    },
    read: <T>(key: string, fallback?: T) =>
      copyJson((values[key] as T | undefined) ?? fallback ?? null) ?? fallback,
    write(key, value) {
      count++
      if (count === fail && !after) throw new Error('Power loss')
      values[key] = copyJson(value)
      writes.push(key)
      if (count === fail && after) throw new Error('Power loss')
    },
    remove(key) {
      count++
      if (count === fail && !after) throw new Error('Power loss')
      delete values[key]
      writes.push(`remove:${key}`)
      if (count === fail && after) throw new Error('Power loss')
    },
  }
  return {
    values,
    raw,
    writes,
    failAt(index: number, persistFirst = false) {
      count = 0
      fail = index
      after = persistFirst
    },
    recover() {
      count = 0
      fail = Infinity
    },
  }
}
export const options = { runtime: 'userscript' as const }
/** Seed through current repository ports, then return committed raw generation bytes. */
export function initial(): Record<string, unknown> {
  const state = memory()
  const store = createProductGenerationStorage(state.raw, options)
  const repositories = fixture('repositories')
  delete repositories['catalog-filter-history:v1']
  for (const [key, value] of Object.entries({
    ...repositories,
    'local-library:v1': fixture('local-library-v6'),
    'ui-theme:v1': {
      themeId: 'missing-theme',
      settingsByTheme: { 'missing-theme': { density: 'future' }, default: 'bad-setting' },
    },
    'favorite-collection:v1': {
      schemaVersion: 1,
      trackIds: ['fixture:audio:b', 'fixture:audio:a'],
      arrangementMode: 'platform',
    },
    'module-recovery:v1': { disableOptional: true },
  }))
    store.write(key, value)
  store.write('plugin:feature.tags:v1', {
    associations: [{ trackId: 'fixture:audio:a', tags: ['user-tag'] }],
    filterConditions: [],
  })
  store.write('plugin:feature.composer:v1', {
    materialCollections: [
      {
        id: 'materials:fixture',
        name: 'Fixture materials',
        trackIds: ['fixture:audio:a', 'fixture:audio:b', 'local:custom:mix'],
        createdAtMs: 10,
        updatedAtMs: 20,
      },
    ],
    pendingMaterialTrackIds: [],
    materialCollectionByTrackId: { 'local:custom:mix': 'materials:fixture' },
  })
  return state.values
}
