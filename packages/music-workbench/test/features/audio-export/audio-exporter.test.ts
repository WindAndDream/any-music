import type { ExportAudioOptions } from '@any-music/audio-composition/browser'
import { AppError } from '@any-music/core'
import type { MediaResolveOptions, ResolvedMediaSource, Track } from '@any-music/core'
import { describe, expect, it, vi } from 'vitest'

import { exportAudioSegments } from '#workbench/features/audio-export/audio-exporter'

// Exercise the application/engine boundary without duplicating the engine's codec tests.
vi.mock('@any-music/audio-composition/browser', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@any-music/audio-composition/browser')>()
  return {
    ...actual,
    exportAudioSegments: async (options: ExportAudioOptions) => {
      await options.loadSource(options.segments[0]!.sourceTrackId, { signal: options.signal })
      return { blob: new Blob(), extension: 'wav' }
    },
  }
})

const track: Track = {
  id: 'asset',
  title: 'Voice',
  artists: [],
  source: { pluginId: 'custom-assets', mediaKind: 'audio', resourceId: '1' },
}

describe('music export adapter', () => {
  it.each(['success', 'failure', 'cancelled'])(
    'releases media account leases after %s without releasing during the read',
    async (outcome) => {
      const release = vi.fn()
      const quality = { id: 'test', label: 'Test', rank: 1 }
      const source: ResolvedMediaSource = {
        type: 'complete-binary',
        bytes: new Uint8Array(),
        mimeType: 'audio/wav',
        quality,
        availableQualities: [quality],
        loadingStrategy: 'eager',
        release,
      }
      const loadMediaFile = vi.fn(async () => {
        expect(release).not.toHaveBeenCalled()
        if (outcome !== 'success')
          throw new AppError(outcome === 'cancelled' ? 'operation-cancelled' : 'network-error')
        return { bytes: new Uint8Array() }
      })
      const pending = exportAudioSegments({
        title: 'Test',
        format: 'wav',
        segments: [{ sourceTrackId: track.id, startMs: 0, endMs: 100 }],
        resolveTrack: () => track,
        resolveMedia: async () => source,
        loadMediaFile,
      })
      if (outcome === 'success') await pending
      else await expect(pending).rejects.toBeInstanceOf(AppError)
      expect(release).toHaveBeenCalledOnce()
    },
  )
  it('passes cancellation into resolution before a complete-binary source starts reading', async () => {
    const controller = new AbortController()
    const loadMediaFile = vi.fn()
    const resolveMedia = vi.fn(async (_track: Track, options?: MediaResolveOptions) => {
      expect(options?.cancellation?.isCancelled()).toBe(false)
      const aborted = vi.fn()
      const unsubscribe = options?.cancellation?.subscribe(aborted)
      controller.abort()
      expect(aborted).toHaveBeenCalledOnce()
      expect(options?.cancellation?.isCancelled()).toBe(true)
      unsubscribe?.()
      throw new AppError('operation-cancelled')
    })
    await expect(
      exportAudioSegments({
        title: 'Export',
        format: 'wav',
        segments: [{ sourceTrackId: track.id, startMs: 0, endMs: 100 }],
        resolveTrack: () => track,
        resolveMedia,
        loadMediaFile,
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ code: 'operation-cancelled' })
    expect(resolveMedia).toHaveBeenCalledOnce()
    expect(loadMediaFile).not.toHaveBeenCalled()
  })
})
