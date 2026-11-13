import { describe, expect, it } from 'vitest'

import { normalizeProgress } from '../../src/player/normalize-progress'

describe('normalizeProgress', () => {
  it('resets NaN progress to the start', () => {
    expect(normalizeProgress(Number.NaN)).toBe(0)
  })

  it.each([
    [Number.NEGATIVE_INFINITY, 0],
    [-Number.MAX_VALUE, 0],
    [-1, 0],
    [-Number.MIN_VALUE, 0],
    [-0, 0],
    [0, 0],
    [Number.MIN_VALUE, Number.MIN_VALUE],
    [0.25, 0.25],
    [1 - Number.EPSILON, 1 - Number.EPSILON],
    [1, 1],
    [1 + Number.EPSILON, 1],
    [2, 1],
    [Number.MAX_VALUE, 1],
    [Number.POSITIVE_INFINITY, 1],
  ])('normalizes %s to %s', (progress, expected) => {
    expect(normalizeProgress(progress)).toBe(expected)
  })
})
