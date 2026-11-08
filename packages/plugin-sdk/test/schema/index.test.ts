import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { negotiatePluginContract } from '../../src/index.ts'
import { assertSchema, decodeProtocolJson } from '../../src/schema/index.ts'
import type { SchemaName } from '../../src/schema/index.ts'
import { assertJsonValue } from '../../src/schema/json-boundary.ts'
import corpus from '../fixtures/corpus/index.json'

const read = (file: string) =>
  readFileSync(new URL(`../fixtures/corpus/${file}`, import.meta.url), 'utf8')
const host = decodeProtocolJson('HostCapabilities', read('host.json'))

describe('versioned cross-language raw JSON corpus', () => {
  for (const item of corpus)
    it(item.id, () => {
      const run = () => {
        const value = decodeProtocolJson(item.schema as SchemaName, read(item.file))
        if (item.stage === 'negotiate') {
          assertSchema('PluginManifest', value)
          negotiatePluginContract(value, host)
        }
        return value
      }
      if (item.accepted) expect(run).not.toThrow()
      else expect(run).toThrow()
    })
})

describe('plain value boundary', () => {
  it('rejects accessors without executing them', () => {
    let readCount = 0
    const value = Object.defineProperty({}, 'id', {
      enumerable: true,
      get() {
        readCount++
        return 'secret'
      },
    })
    expect(() => assertJsonValue(value)).toThrow('Unsafe property')
    expect(readCount).toBe(0)
  })
  it('rejects cycles, prototypes, symbols, functions and non-finite numbers', () => {
    const cycle: Record<string, unknown> = {}
    cycle.self = cycle
    for (const value of [
      cycle,
      new Date(),
      { [Symbol()]: 1 },
      { fn: () => 0 },
      { value: NaN },
      { value: Infinity },
      [undefined],
      Array(2),
      Object.create(Array.prototype),
    ])
      expect(() => assertJsonValue(value)).toThrow()
  })
  it('counts encoded UTF-8 bytes independently of code points', () => {
    expect(() => assertJsonValue(Array(10).fill('🎵'.repeat(7000)))).toThrow('Message byte limit')
  })
  it('counts astral Unicode as a single schema character', () => {
    expect(() => assertSchema('MusicListingInput', { listingRef: '🎵'.repeat(128) })).not.toThrow()
    expect(() => assertSchema('MusicListingInput', { listingRef: '🎵'.repeat(129) })).toThrow()
  })
})
