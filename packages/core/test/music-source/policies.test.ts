import { describe, expect, it } from 'vitest'

import { normalizePageSize, selectMediaLoadingStrategy } from '../../src/music-source/policies'

describe('normalizePageSize', () => {
  const policy = { defaultSize: 30, maxSize: 50 }

  it('uses the default for missing and non-finite values', () => {
    expect(normalizePageSize(undefined, policy)).toBe(30)
    expect(normalizePageSize(Number.NaN, policy)).toBe(30)
  })

  it('floors and clamps requested values', () => {
    expect(normalizePageSize(12.9, policy)).toBe(12)
    expect(normalizePageSize(0, policy)).toBe(1)
    expect(normalizePageSize(100, policy)).toBe(50)
  })

  it('rejects invalid platform policies', () => {
    expect(() => normalizePageSize(10, { defaultSize: 60, maxSize: 50 })).toThrow(RangeError)
  })
})

describe('selectMediaLoadingStrategy', () => {
  it('uses eager only for known finite durations within the threshold', () => {
    expect(selectMediaLoadingStrategy(600_000, 600_000)).toBe('eager')
    expect(selectMediaLoadingStrategy(600_001, 600_000)).toBe('range')
    expect(selectMediaLoadingStrategy(undefined, 600_000)).toBe('range')
    expect(selectMediaLoadingStrategy(Number.NaN, 600_000)).toBe('range')
  })

  it('rejects invalid thresholds', () => {
    expect(() => selectMediaLoadingStrategy(1, -1)).toThrow(RangeError)
  })
})
