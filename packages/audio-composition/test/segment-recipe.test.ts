import { describe, expect, it } from 'vitest'

import { compileSegmentRecipe, getCompiledDurationMs } from '../src/index'

describe('independent audio recipes', () => {
  it('composes nested assets without a music Track, source plugin or library', () => {
    const compiled = compileSegmentRecipe([{ sourceTrackId: 'intro', startMs: 500, endMs: 1500 }], {
      resolveTrack: () => ({ durationMs: 5000 }),
      resolveCustomTrack: (id) =>
        id === 'intro'
          ? {
              recipe: [
                { sourceTrackId: 'voice', startMs: 1000, endMs: 2000 },
                { sourceTrackId: 'effect', startMs: 0, endMs: 1000 },
              ],
            }
          : undefined,
    })
    expect(compiled).toEqual([
      { sourceTrackId: 'voice', startMs: 1500, endMs: 2000, virtualStartMs: 0, virtualEndMs: 500 },
      { sourceTrackId: 'effect', startMs: 0, endMs: 500, virtualStartMs: 500, virtualEndMs: 1000 },
    ])
    expect(getCompiledDurationMs(compiled)).toBe(1000)
  })

  it('rejects cycles and accumulated timeline overflow', () => {
    const segment = { sourceTrackId: 'loop', startMs: 0, endMs: 1000 }
    expect(() =>
      compileSegmentRecipe([segment], {
        resolveTrack: () => undefined,
        resolveCustomTrack: () => ({ recipe: [segment] }),
      }),
    ).toThrow(expect.objectContaining({ code: 'circular-reference' }))
    expect(() =>
      compileSegmentRecipe(
        [
          { sourceTrackId: 'one', startMs: 0, endMs: Number.MAX_SAFE_INTEGER },
          { sourceTrackId: 'two', startMs: 0, endMs: 1 },
        ],
        { resolveTrack: () => ({}), resolveCustomTrack: () => undefined },
      ),
    ).toThrow(expect.objectContaining({ code: 'invalid-range' }))
  })

  it('expands large nested recipes without spreading leaves into function arguments', () => {
    const recipe = Array.from({ length: 150000 }, (_, index) => ({
      sourceTrackId: String(index),
      startMs: 0,
      endMs: 1,
    }))
    const result = compileSegmentRecipe(
      [{ sourceTrackId: 'nested', startMs: 0, endMs: recipe.length }],
      {
        resolveTrack: () => ({ durationMs: 1 }),
        resolveCustomTrack: (id) => (id === 'nested' ? { recipe } : undefined),
      },
    )
    expect(result).toHaveLength(recipe.length)
    expect(getCompiledDurationMs(result)).toBe(recipe.length)
  })
})
