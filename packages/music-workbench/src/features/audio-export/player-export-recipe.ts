import { AppError } from '@any-music/core'
import type { SegmentRecipe, Track } from '@any-music/core'

/**
 * 把播放器当前内容转换为既有导出管线可消费的叶子配方。
 * 普通曲目覆盖完整时长；自定义/预览曲目继续使用已经编译并扁平化的时间线。
 */
export function createPlayerExportRecipe(
  track: Track,
  compiledSegments: readonly SegmentRecipe[] | undefined,
): readonly SegmentRecipe[] {
  if (track.source.mediaKind === 'custom') {
    if (!compiledSegments?.length) {
      throw new AppError('export-unavailable', '当前自定义音乐没有可导出的音频片段。')
    }
    return compiledSegments.map(({ sourceTrackId, startMs, endMs }) => ({
      sourceTrackId,
      startMs,
      endMs,
    }))
  }

  const durationMs = track.durationMs
  if (typeof durationMs !== 'number' || !Number.isFinite(durationMs) || durationMs <= 0) {
    throw new AppError('export-unavailable', '当前曲目缺少有效时长，无法导出完整音频。')
  }
  return [{ sourceTrackId: track.id, startMs: 0, endMs: durationMs }]
}
