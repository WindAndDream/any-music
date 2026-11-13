import type { CompiledSegmentRecipe } from '@any-music/core'
import { describe, expect, it } from 'vitest'

import {
  createCustomSegmentSeekTarget,
  createCustomSegmentStartTarget,
  hasReachedCustomSegmentSeekTarget,
  shouldAutoplayCustomSegment,
} from '#workbench/features/player/custom-segment-seek'

const segments: readonly CompiledSegmentRecipe[] = [
  {
    sourceTrackId: 'bilibili:video:first',
    startMs: 0,
    endMs: 5_000,
    virtualStartMs: 0,
    virtualEndMs: 5_000,
  },
  {
    sourceTrackId: 'douyin:video:second',
    startMs: 20_000,
    endMs: 25_000,
    virtualStartMs: 5_000,
    virtualEndMs: 10_000,
  },
]

describe('custom segment seek', () => {
  it('maps virtual 7 seconds to 2 seconds inside the Douyin leaf', () => {
    expect(createCustomSegmentSeekTarget(segments, 7_000)).toEqual({
      segmentIndex: 1,
      virtualPositionMs: 7_000,
      sourcePositionMs: 22_000,
    })
  })

  it('maps the exact five-second boundary to the start of the second leaf', () => {
    expect(createCustomSegmentSeekTarget(segments, 5_000)).toEqual({
      segmentIndex: 1,
      virtualPositionMs: 5_000,
      sourcePositionMs: 20_000,
    })
  })

  it('keeps the requested virtual position locked while stale first-leaf events arrive', () => {
    const target = createCustomSegmentSeekTarget(segments, 7_000)!

    expect(hasReachedCustomSegmentSeekTarget(target, 0, 5_000)).toBe(false)
    expect(hasReachedCustomSegmentSeekTarget(target, 1, 20_000)).toBe(false)
    expect(hasReachedCustomSegmentSeekTarget(target, 1, 22_000)).toBe(true)
  })

  it('uses the same source-time mapping for automatic segment starts', () => {
    expect(createCustomSegmentStartTarget(segments, 1, 2_000)).toEqual({
      segmentIndex: 1,
      virtualPositionMs: 7_000,
      sourcePositionMs: 22_000,
    })
  })

  it('preserves play intent when an internal source switch temporarily pauses audio', () => {
    expect(shouldAutoplayCustomSegment(true, false, false)).toBe(true)
    expect(shouldAutoplayCustomSegment(false, true, false)).toBe(true)
    expect(shouldAutoplayCustomSegment(false, false, true)).toBe(true)
    expect(shouldAutoplayCustomSegment(false, false, false)).toBe(false)
  })
})
