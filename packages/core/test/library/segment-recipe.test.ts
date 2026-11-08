import { describe, expect, it } from 'vitest'

import type { CustomTrackDefinition, SegmentRecipe } from '../../src/library/models'
import {
  compileSegmentRecipe,
  getCompiledDurationMs,
  locateCompiledSegment,
  SegmentRecipeError,
} from '../../src/library/segment-recipe'
import type { Track } from '../../src/models/track'

const tracks = new Map<string, Track>([
  ['track-a', createTrack('track-a', 10_000)],
  ['track-b', createTrack('track-b', 10_000)],
])

describe('compileSegmentRecipe', () => {
  it('slices a nested custom timeline back onto leaf source tracks', () => {
    const customTracks = new Map<string, CustomTrackDefinition>([
      [
        'custom-1',
        createCustomTrack('custom-1', [
          { sourceTrackId: 'track-a', startMs: 1_000, endMs: 3_000 },
          { sourceTrackId: 'track-b', startMs: 4_000, endMs: 6_000 },
        ]),
      ],
    ])

    const compiled = compileSegmentRecipe(
      [{ sourceTrackId: 'custom-1', startMs: 1_000, endMs: 3_000 }],
      createOptions(customTracks),
    )

    expect(compiled).toEqual([
      {
        sourceTrackId: 'track-a',
        startMs: 2_000,
        endMs: 3_000,
        virtualStartMs: 0,
        virtualEndMs: 1_000,
      },
      {
        sourceTrackId: 'track-b',
        startMs: 4_000,
        endMs: 5_000,
        virtualStartMs: 1_000,
        virtualEndMs: 2_000,
      },
    ])
  })

  it('merges adjacent source ranges and builds a searchable virtual timeline', () => {
    const compiled = compileSegmentRecipe(
      [
        { sourceTrackId: 'track-a', startMs: 0, endMs: 1_000 },
        { sourceTrackId: 'track-a', startMs: 1_000, endMs: 2_500 },
      ],
      createOptions(),
    )

    expect(compiled).toHaveLength(1)
    expect(compiled[0]).toMatchObject({ startMs: 0, endMs: 2_500, virtualEndMs: 2_500 })
    expect(getCompiledDurationMs(compiled)).toBe(2_500)
    expect(locateCompiledSegment(compiled, 2_499)).toBe(compiled[0])
    expect(locateCompiledSegment(compiled, 2_500)).toBeUndefined()
  })

  it('rejects circular custom-track references', () => {
    const customTracks = new Map<string, CustomTrackDefinition>([
      [
        'custom-a',
        createCustomTrack('custom-a', [{ sourceTrackId: 'custom-b', startMs: 0, endMs: 1_000 }]),
      ],
      [
        'custom-b',
        createCustomTrack('custom-b', [{ sourceTrackId: 'custom-a', startMs: 0, endMs: 1_000 }]),
      ],
    ])

    expect(() =>
      compileSegmentRecipe(
        [{ sourceTrackId: 'custom-a', startMs: 0, endMs: 1_000 }],
        createOptions(customTracks),
      ),
    ).toThrowError(
      expect.objectContaining<Partial<SegmentRecipeError>>({ code: 'circular-reference' }),
    )
  })

  it('rejects a leaf range past the known track duration', () => {
    expect(() =>
      compileSegmentRecipe(
        [{ sourceTrackId: 'track-a', startMs: 9_000, endMs: 11_000 }],
        createOptions(),
      ),
    ).toThrowError(
      expect.objectContaining<Partial<SegmentRecipeError>>({ code: 'duration-exceeded' }),
    )
  })
})

function createOptions(customTracks = new Map<string, CustomTrackDefinition>()) {
  return {
    resolveTrack: (trackId: string) => tracks.get(trackId),
    resolveCustomTrack: (trackId: string) => customTracks.get(trackId),
  }
}

function createTrack(id: string, durationMs: number): Track {
  return {
    id,
    title: id,
    artists: [{ name: '测试' }],
    durationMs,
    source: { pluginId: 'test', mediaKind: 'audio', resourceId: id },
  }
}

function createCustomTrack(id: string, recipe: readonly SegmentRecipe[]): CustomTrackDefinition {
  return {
    trackId: id,
    version: 1,
    materialCollectionId: 'material-collection:test',
    recipe,
    compiledSegments: [],
    creator: { id: 'local-user:test', displayName: '测试用户' },
    sourceCredits: [],
    createdAtMs: 0,
  }
}
