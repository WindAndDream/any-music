import {
  AudioCompositionError,
  exportAudioSegments as composeAudio,
} from '@any-music/audio-composition/browser'
import type {
  AudioExportFormat,
  AudioExportProgress,
  ExportedAudioFile,
} from '@any-music/audio-composition/browser'
import { AppError } from '@any-music/core'
import type {
  MediaResolveOptions,
  ResolvedMediaSource,
  SegmentRecipe,
  Track,
} from '@any-music/core'

import type { LoadedMediaFile } from '../../media/resolved-media-loader'

export type { AudioExportFormat, AudioExportProgress, ExportedAudioFile }
export interface ExportAudioOptions {
  title: string
  creatorName?: string
  segments: readonly SegmentRecipe[]
  format: AudioExportFormat
  resolveTrack: (trackId: string) => Track | undefined
  resolveMedia: (track: Track, options?: MediaResolveOptions) => Promise<ResolvedMediaSource>
  loadMediaFile: (
    track: Track,
    source: ResolvedMediaSource,
    options?: { signal?: AbortSignal },
  ) => Promise<LoadedMediaFile>
  onProgress?: (progress: AudioExportProgress) => void
  signal?: AbortSignal
}

/** Bind the generic composition engine to music policy and the runtime's authenticated media reader. */
export async function exportAudioSegments(options: ExportAudioOptions): Promise<ExportedAudioFile> {
  try {
    return await composeAudio({
      ...options,
      loadSource: async (id, { signal }) => {
        const track = options.resolveTrack(id)
        if (!track || track.source.mediaKind === 'custom')
          throw new AppError('source-not-found', `找不到可导出的叶子素材：${id}`)
        options.onProgress?.({
          completedSegmentCount: 0,
          totalSegmentCount: options.segments.length,
          message: `正在解析素材：${track.title}`,
        })
        // Complete-binary resolvers read media during resolution, so cancellation must start here.
        const source = await options.resolveMedia(
          track,
          signal
            ? {
                cancellation: {
                  isCancelled: () => signal.aborted,
                  subscribe: (listener) => {
                    signal.addEventListener('abort', listener, { once: true })
                    return () => signal.removeEventListener('abort', listener)
                  },
                },
              }
            : undefined,
        )
        try {
          if (signal?.aborted) throw new AppError('operation-cancelled')
          return await options.loadMediaFile(track, source, { signal })
        } finally {
          source.release?.()
        }
      },
    })
  } catch (error) {
    if (error instanceof AudioCompositionError)
      throw new AppError(error.code, error.message, { cause: error })
    throw error
  }
}
