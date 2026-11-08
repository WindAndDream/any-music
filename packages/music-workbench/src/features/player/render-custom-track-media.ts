import { AppError } from '@any-music/core'
import type {
  CompleteBinaryResolvedMediaSource,
  MediaResolveOptions,
  ResolvedMediaSource,
  SegmentRecipe,
  Track,
} from '@any-music/core'

import type { LoadedMediaFile } from '../../media/resolved-media-loader'
import { exportAudioSegments } from '../audio-export/audio-exporter'

export interface RenderCustomTrackMediaOptions {
  track: Track
  segments: readonly SegmentRecipe[]
  resolveTrack: (trackId: string) => Track | undefined
  resolveMedia: (track: Track, options?: MediaResolveOptions) => Promise<ResolvedMediaSource>
  loadMediaFile: (
    track: Track,
    source: ResolvedMediaSource,
    options?: { signal?: AbortSignal },
  ) => Promise<LoadedMediaFile>
  signal?: AbortSignal
}

/**
 * 把自定义歌曲的叶子配方渲染为当前播放会话内的 MP3，让浏览器原生 audio 控件
 * 直接拥有完整时长、seek、暂停和倍速；返回的字节只供播放器创建临时 Object URL。
 */
export async function renderCustomTrackMedia(
  options: RenderCustomTrackMediaOptions,
): Promise<CompleteBinaryResolvedMediaSource> {
  if (options.track.source.mediaKind !== 'custom') {
    throw new AppError('unsupported-operation', '只有自定义歌曲需要渲染原生播放媒体。')
  }

  const file = await exportAudioSegments({
    title: options.track.title,
    creatorName: options.track.artists.map((artist) => artist.name).join(' / ') || undefined,
    segments: options.segments,
    format: 'mp3',
    resolveTrack: options.resolveTrack,
    resolveMedia: options.resolveMedia,
    loadMediaFile: options.loadMediaFile,
    signal: options.signal,
  })
  const bytes = new Uint8Array(await file.blob.arrayBuffer())
  const quality = {
    id: 'custom-track:mp3-192',
    label: 'MP3 · 192 kbps',
    rank: 192_000,
    bitrate: 192_000,
  } as const

  return {
    type: 'complete-binary',
    bytes,
    mimeType: file.blob.type || 'audio/mpeg',
    quality,
    availableQualities: [quality],
    durationMs: options.track.durationMs,
    loadingStrategy: 'eager',
  }
}
