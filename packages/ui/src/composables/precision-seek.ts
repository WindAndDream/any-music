/** 把指针横坐标映射到播放器时间轴，供悬停提示和点击跳转共用同一套边界规则。 */
export function calculatePointerPositionMs(
  clientX: number,
  trackLeft: number,
  trackWidth: number,
  durationMs: number,
): number {
  if (!Number.isFinite(durationMs) || durationMs <= 0 || trackWidth <= 0) return 0
  const ratio = Math.min(1, Math.max(0, (clientX - trackLeft) / trackWidth))
  return Math.round(durationMs * ratio)
}

export function clampPlaybackPositionMs(positionMs: number, durationMs: number): number {
  if (!Number.isFinite(positionMs) || !Number.isFinite(durationMs) || durationMs <= 0) return 0
  return Math.min(Math.round(durationMs), Math.max(0, Math.round(positionMs)))
}

interface SeekableNativeMedia {
  currentTime: number
  duration: number
}

/**
 * 把精细时间轴的毫秒位置落到原生媒体元素；返回实际写入值，便于 UI 与历史进度同步。
 * 元数据尚未就绪且也没有可靠的领域时长时不写入，避免把无效位置留给稍后的媒体源。
 */
export function seekNativeMedia(
  media: SeekableNativeMedia,
  positionMs: number,
  fallbackDurationMs?: number,
): number | undefined {
  if (!Number.isFinite(positionMs)) return undefined
  const mediaDurationMs = Number.isFinite(media.duration) ? media.duration * 1_000 : undefined
  const durationMs = mediaDurationMs ?? fallbackDurationMs
  if (durationMs === undefined || !Number.isFinite(durationMs) || durationMs <= 0) return undefined
  const nextPositionMs = clampPlaybackPositionMs(positionMs, durationMs)
  try {
    media.currentTime = nextPositionMs / 1_000
  } catch {
    return undefined
  }
  return nextPositionMs
}

/** 悬停时间保留 0.1 秒，长视频超过一小时后自动补充小时位。 */
export function formatPrecisePlaybackTime(positionMs: number): string {
  const totalTenths = Math.max(0, Math.floor(positionMs / 100))
  const tenths = totalTenths % 10
  const totalSeconds = Math.floor(totalTenths / 10)
  const seconds = totalSeconds % 60
  const totalMinutes = Math.floor(totalSeconds / 60)
  const minutes = totalMinutes % 60
  const hours = Math.floor(totalMinutes / 60)
  const base = `${minutes.toString().padStart(hours > 0 ? 2 : 1, '0')}:${seconds
    .toString()
    .padStart(2, '0')}.${tenths}`
  return hours > 0 ? `${hours}:${base}` : base
}
