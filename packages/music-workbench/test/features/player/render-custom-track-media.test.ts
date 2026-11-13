import type { ResolvedMediaSource, Track } from '@any-music/core'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { renderCustomTrackMedia } from '#workbench/features/player/render-custom-track-media'

const exportAudioSegmentsMock = vi.hoisted(() => vi.fn())

vi.mock('#workbench/features/audio-export/audio-exporter', () => ({
  exportAudioSegments: exportAudioSegmentsMock,
}))

const CUSTOM_TRACK: Track = {
  id: 'local:custom:night-drive',
  title: '夜行拼接',
  artists: [{ id: 'local-user', name: '本地用户' }],
  durationMs: 8_000,
  source: { pluginId: 'local-custom', mediaKind: 'custom', resourceId: 'night-drive' },
}

const LEAF_TRACK: Track = {
  id: 'bilibili:video:BV1',
  title: '来源音乐',
  artists: [{ id: 'up-1', name: '来源作者' }],
  durationMs: 20_000,
  source: { pluginId: 'bilibili', mediaKind: 'video', resourceId: 'BV1' },
}

describe('renderCustomTrackMedia', () => {
  beforeEach(() => {
    exportAudioSegmentsMock.mockReset()
  })

  it('encodes the compiled recipe as a session-only native audio source', async () => {
    exportAudioSegmentsMock.mockResolvedValue({
      blob: new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/mpeg' }),
      extension: 'mp3',
    })
    const segments = [{ sourceTrackId: LEAF_TRACK.id, startMs: 2_000, endMs: 10_000 }]
    const resolveTrack = vi.fn(() => LEAF_TRACK)
    const resolveMedia = vi.fn<() => Promise<ResolvedMediaSource>>()
    const loadMediaFile = vi.fn()
    const controller = new AbortController()

    const source = await renderCustomTrackMedia({
      track: CUSTOM_TRACK,
      segments,
      resolveTrack,
      resolveMedia,
      loadMediaFile,
      signal: controller.signal,
    })

    expect(exportAudioSegmentsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        title: CUSTOM_TRACK.title,
        creatorName: '本地用户',
        segments,
        format: 'mp3',
        resolveTrack,
        resolveMedia,
        loadMediaFile,
        signal: controller.signal,
      }),
    )
    expect(source).toEqual({
      type: 'complete-binary',
      bytes: new Uint8Array([1, 2, 3]),
      mimeType: 'audio/mpeg',
      quality: {
        id: 'custom-track:mp3-192',
        label: 'MP3 · 192 kbps',
        rank: 192_000,
        bitrate: 192_000,
      },
      availableQualities: [
        {
          id: 'custom-track:mp3-192',
          label: 'MP3 · 192 kbps',
          rank: 192_000,
          bitrate: 192_000,
        },
      ],
      durationMs: 8_000,
      loadingStrategy: 'eager',
    })
  })

  it('rejects ordinary tracks before starting an unnecessary render', async () => {
    await expect(
      renderCustomTrackMedia({
        track: LEAF_TRACK,
        segments: [{ sourceTrackId: LEAF_TRACK.id, startMs: 0, endMs: 1_000 }],
        resolveTrack: () => LEAF_TRACK,
        resolveMedia: vi.fn(),
        loadMediaFile: vi.fn(),
      }),
    ).rejects.toThrow('只有自定义歌曲需要渲染原生播放媒体')
    expect(exportAudioSegmentsMock).not.toHaveBeenCalled()
  })
})
