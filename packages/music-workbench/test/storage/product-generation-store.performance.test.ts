import type { LocalMusicLibrarySnapshot } from '@any-music/core'
import { describe, expect, it, vi } from 'vitest'

import { isRecord } from '#workbench/storage/product-data'
import { createProductGenerationStorage } from '#workbench/storage/product-generation-store'

import { initial, memory, options } from './product-storage-fixtures'

describe('product generation host preference work', () => {
  it('validates both isolated copies without repeating full-library passes for one preference', () => {
    const state = memory(initial())
    const seed = createProductGenerationStorage(state.raw, options)
    const library = seed.read<LocalMusicLibrarySnapshot>('local-library:v1')!
    const template = library.tracks[0]!
    const count = 10_000
    library.tracks = Array.from({ length: count }, (_, index) => ({
      ...template,
      track: { ...template.track, id: `work:${index}`, title: 'generation-work-sentinel' },
    }))
    seed.write('local-library:v1', library)
    const store = createProductGenerationStorage(state.raw, options)
    const read = state.raw.read
    const reads: string[] = []
    state.raw.read = (key, fallback) => {
      reads.push(key)
      return read(key, fallback)
    }

    let validatedTracks = 0
    let serializedTracks = 0
    const propertyNames = Object.getOwnPropertyNames
    const stringify = JSON.stringify
    const validation = vi.spyOn(Object, 'getOwnPropertyNames').mockImplementation((value) => {
      if (isRecord(value) && value.title === 'generation-work-sentinel') validatedTracks++
      return propertyNames(value)
    })
    const serialization = vi
      .spyOn(JSON, 'stringify')
      .mockImplementation((value, replacer, space) => {
        if (isRecord(value)) {
          const core = isRecord(value.core) ? value.core : value
          if (isRecord(core.library) && Array.isArray(core.library.tracks))
            serializedTracks += core.library.tracks.length
        }
        return stringify(value, replacer as never, space)
      })
    try {
      store.write('app-shell:v1', { schemaVersion: 1, isSidebarCollapsed: true })
    } finally {
      serialization.mockRestore()
      validation.mockRestore()
    }

    // One validated candidate plus one complete durable read-back remains mandatory.
    // Count work rather than elapsed time, so slower CI does not affect this guard.
    expect({ validatedTracks, serializedTracks }).toEqual({
      validatedTracks: count * 2,
      serializedTracks: expect.any(Number),
    })
    expect(serializedTracks).toBeLessThanOrEqual(count * 7)
    for (const part of ['core', 'host', 'namespaces'])
      expect(reads.filter((key) => key.endsWith(`:${part}`))).toHaveLength(1)
    const restored = createProductGenerationStorage(state.raw, options)
    expect(restored.read<LocalMusicLibrarySnapshot>('local-library:v1')?.tracks).toHaveLength(count)
    expect(restored.read('app-shell:v1')).toMatchObject({ isSidebarCollapsed: true })
  })
})
