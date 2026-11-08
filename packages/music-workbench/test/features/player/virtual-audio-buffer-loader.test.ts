import type { ResolvedMediaSource, Track } from '@any-music/core'
import { describe, expect, it, vi } from 'vitest'

import { VirtualAudioBufferLoader } from '#workbench/features/player/virtual-audio-buffer-loader'

vi.mock('#workbench/media/range-media-source', () => ({
  createRangeMediaSource: vi.fn(),
}))

const track: Track = {
  id: 'custom-source:audio:1',
  title: '完整媒体素材',
  artists: [{ name: '测试' }],
  source: { pluginId: 'custom-source', mediaKind: 'audio', resourceId: '1' },
}

describe('VirtualAudioBufferLoader', () => {
  it('rejects a complete-binary resolver before resolveMedia can download the whole source', async () => {
    const resolveMedia = vi.fn()
    const loader = new VirtualAudioBufferLoader({
      audioContext: {} as AudioContext,
      resolveTrack: () => track,
      resolveMedia,
      canPrefetchMedia: () => false,
    })

    await expect(
      loader.load({
        key: '0:0:custom-source:audio:1:0',
        segmentIndex: 0,
        sourceTrackId: track.id,
        startMs: 0,
        endMs: 1_000,
        virtualStartMs: 0,
        virtualEndMs: 1_000,
      }),
    ).rejects.toMatchObject({
      sourceTrackId: track.id,
      cause: { code: 'unsupported-operation' },
    })
    expect(resolveMedia).not.toHaveBeenCalled()
    loader.dispose()
  })

  it('removes a rejected descriptor promise so the same leaf can be retried', async () => {
    const resolveMedia = vi.fn(() => Promise.reject(new Error('temporary resolver failure')))
    const loader = new VirtualAudioBufferLoader({
      audioContext: {} as AudioContext,
      resolveTrack: () => track,
      resolveMedia,
      canPrefetchMedia: () => true,
    })
    const chunk = {
      key: '0:0:custom-source:audio:1:0',
      segmentIndex: 0,
      sourceTrackId: track.id,
      startMs: 0,
      endMs: 1_000,
      virtualStartMs: 0,
      virtualEndMs: 1_000,
    }

    await expect(loader.load(chunk)).rejects.toBeInstanceOf(Error)
    await expect(loader.load(chunk)).rejects.toBeInstanceOf(Error)

    expect(resolveMedia).toHaveBeenCalledTimes(2)
    loader.dispose()
  })

  it('releases a late descriptor when the player disposes during resolution', async () => {
    let complete!: (source: ResolvedMediaSource) => void
    const release = vi.fn()
    const loader = new VirtualAudioBufferLoader({
      audioContext: {} as AudioContext,
      resolveTrack: () => track,
      resolveMedia: () =>
        new Promise((resolve) => {
          complete = resolve
        }),
      canPrefetchMedia: () => true,
    })
    const pending = loader.load({
      key: 'late',
      segmentIndex: 0,
      sourceTrackId: track.id,
      startMs: 0,
      endMs: 1_000,
      virtualStartMs: 0,
      virtualEndMs: 1_000,
    })
    const rejected = expect(pending).rejects.toMatchObject({
      cause: { code: 'operation-cancelled' },
    })
    loader.dispose()
    const quality = { id: 'original', label: '原始', rank: 0 }
    complete({
      type: 'complete-binary',
      bytes: new Uint8Array(),
      mimeType: 'audio/wav',
      quality,
      availableQualities: [quality],
      loadingStrategy: 'eager',
      release,
    })
    await rejected
    loader.dispose()
    expect(release).toHaveBeenCalledTimes(1)
  })
})
