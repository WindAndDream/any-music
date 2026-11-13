import { describe, expect, it } from 'vitest'

import type { CompiledSegmentRecipe } from '../src/models'
import {
  createVirtualPlaybackChunks,
  locateVirtualPlaybackChunk,
  selectVirtualPlaybackWindow,
} from '../src/virtual-playback-plan'

describe('virtual playback plan', () => {
  it('rejects non-finite or inconsistent public timeline inputs', () => {
    expect(() => createVirtualPlaybackChunks([createSegment('invalid', 0, Infinity, 0)])).toThrow(
      TypeError,
    )
    expect(() =>
      createVirtualPlaybackChunks([{ ...createSegment('invalid', 0, 100, 0), virtualEndMs: 50 }]),
    ).toThrow(TypeError)
  })

  it('splits a long leaf segment without crossing its source or virtual boundaries', () => {
    const chunks = createVirtualPlaybackChunks([createSegment('track-a', 10_000, 20_000, 0)], 4_000)

    expect(
      chunks.map(({ startMs, endMs, virtualStartMs, virtualEndMs }) => ({
        startMs,
        endMs,
        virtualStartMs,
        virtualEndMs,
      })),
    ).toEqual([
      { startMs: 10_000, endMs: 14_000, virtualStartMs: 0, virtualEndMs: 4_000 },
      { startMs: 14_000, endMs: 18_000, virtualStartMs: 4_000, virtualEndMs: 8_000 },
      { startMs: 18_000, endMs: 20_000, virtualStartMs: 8_000, virtualEndMs: 10_000 },
    ])
  })

  it('prefetches several one-second fragments until the time horizon is covered', () => {
    const segments = Array.from({ length: 10 }, (_, index) =>
      createSegment(`track-${index}`, 0, 1_000, index * 1_000),
    )
    const chunks = createVirtualPlaybackChunks(segments)

    const selected = selectVirtualPlaybackWindow(chunks, 0, {
      lookAheadMs: 5_000,
      minimumChunkCount: 2,
      maximumChunkCount: 8,
    })

    expect(selected).toHaveLength(5)
    expect(selected.at(-1)?.virtualEndMs).toBe(5_000)
  })

  it('rebuilds the window around a seek target instead of starting from the beginning', () => {
    const chunks = createVirtualPlaybackChunks([createSegment('track-a', 0, 20_000, 0)])
    const active = locateVirtualPlaybackChunk(chunks, 9_500)
    const selected = selectVirtualPlaybackWindow(chunks, 9_500, {
      lookAheadMs: 6_000,
      minimumChunkCount: 2,
      maximumChunkCount: 4,
    })

    expect(active?.virtualStartMs).toBe(8_000)
    expect(selected[0]).toBe(active)
    expect(selected.at(-1)?.virtualEndMs).toBeGreaterThanOrEqual(15_500)
  })
})

function createSegment(
  sourceTrackId: string,
  startMs: number,
  endMs: number,
  virtualStartMs: number,
): CompiledSegmentRecipe {
  return {
    sourceTrackId,
    startMs,
    endMs,
    virtualStartMs,
    virtualEndMs: virtualStartMs + endMs - startMs,
  }
}
