import type { CompiledSegmentRecipe, Track } from '@any-music/core'
import { describe, expect, it } from 'vitest'

import { createPlayerExportRecipe } from '#workbench/features/audio-export/player-export-recipe'

const BILIBILI_TRACK: Track = {
  id: 'bilibili:video:BV1B5hj6dEKB',
  title: '测试视频',
  artists: [{ id: '23285202', name: '测试 UP' }],
  durationMs: 124_000,
  source: {
    pluginId: 'bilibili',
    mediaKind: 'video',
    resourceId: 'BV1B5hj6dEKB',
    partId: '41265135770',
  },
}

describe('createPlayerExportRecipe', () => {
  it('exports an ordinary Bilibili track through the full-track segment pipeline', () => {
    expect(createPlayerExportRecipe(BILIBILI_TRACK, undefined)).toEqual([
      { sourceTrackId: BILIBILI_TRACK.id, startMs: 0, endMs: 124_000 },
    ])
  })

  it('keeps only stable leaf ranges when exporting a compiled custom track', () => {
    const track: Track = {
      ...BILIBILI_TRACK,
      id: 'local:custom:test',
      source: { pluginId: 'local', mediaKind: 'custom', resourceId: 'test' },
    }
    const segments: readonly CompiledSegmentRecipe[] = [
      {
        sourceTrackId: BILIBILI_TRACK.id,
        startMs: 1_000,
        endMs: 4_000,
        virtualStartMs: 0,
        virtualEndMs: 3_000,
      },
    ]

    expect(createPlayerExportRecipe(track, segments)).toEqual([
      { sourceTrackId: BILIBILI_TRACK.id, startMs: 1_000, endMs: 4_000 },
    ])
  })

  it('rejects an ordinary track without a usable full duration', () => {
    expect(() =>
      createPlayerExportRecipe({ ...BILIBILI_TRACK, durationMs: undefined }, undefined),
    ).toThrow('当前曲目缺少有效时长')
  })
})
