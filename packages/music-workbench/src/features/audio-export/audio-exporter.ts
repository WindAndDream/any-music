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
import { createPlayerExportRecipe } from './player-export-recipe'

export type { AudioExportFormat, AudioExportProgress, ExportedAudioFile }
export type ExportAudioOptions = {
  title: string
  creatorName?: string
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
} & ({ segments: readonly SegmentRecipe[] } | { track: Track })

/** Bind the generic composition engine to music policy and the runtime's authenticated media reader. */
export async function exportAudioSegments(options: ExportAudioOptions): Promise<ExportedAudioFile> {
  let fullTrackSource: ResolvedMediaSource | undefined
  try {
    let segments: readonly SegmentRecipe[]
    if ('segments' in options) {
      segments = options.segments
    } else {
      const { track, signal } = options
      if (track.source.mediaKind === 'custom')
        throw new AppError('export-unavailable', '当前自定义音乐没有可导出的音频片段。')
      reportSourceResolution(options, track, 1)
      fullTrackSource = await resolveExportMedia(options, track, signal)
      if (signal?.aborted) throw new AppError('operation-cancelled')
      const recipe = createPlayerExportRecipe(
        { ...track, durationMs: fullTrackSource.durationMs },
        undefined,
      )
      if (!recipe)
        throw new AppError('export-unavailable', '当前曲目缺少有效时长，无法导出完整音频。')
      segments = recipe
    }
    return await composeAudio({
      ...options,
      segments,
      loadSource: async (id, { signal }) => {
        const track = 'track' in options ? options.track : options.resolveTrack(id)
        if (!track || track.source.mediaKind === 'custom')
          throw new AppError('source-not-found', `找不到可导出的叶子素材：${id}`)
        if (!fullTrackSource) reportSourceResolution(options, track, segments.length)
        const source = fullTrackSource ?? (await resolveExportMedia(options, track, signal))
        try {
          if (signal?.aborted) throw new AppError('operation-cancelled')
          return await options.loadMediaFile(track, source, { signal })
        } finally {
          if (source === fullTrackSource) fullTrackSource = undefined
          source.release?.()
        }
      },
    })
  } catch (error) {
    if (error instanceof AudioCompositionError)
      throw new AppError(error.code, error.message, { cause: error })
    throw error
  } finally {
    fullTrackSource?.release?.()
  }
}

function reportSourceResolution(options: ExportAudioOptions, track: Track, count: number): void {
  options.onProgress?.({
    completedSegmentCount: 0,
    totalSegmentCount: count,
    message: `正在解析素材：${track.title}`,
  })
}

function resolveExportMedia(
  options: ExportAudioOptions,
  track: Track,
  signal?: AbortSignal,
): Promise<ResolvedMediaSource> {
  // Complete-binary resolvers read media during resolution, so cancellation must start here.
  if (signal?.aborted) throw new AppError('operation-cancelled')
  return options.resolveMedia(
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
}
