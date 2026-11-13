import type { PlaybackHistoryEntry } from '@any-music/core'

/** Keep the row and its actions dialog anchored to the same individual playback. */
export function formatHistoryRecord(entry: PlaybackHistoryEntry): string {
  const time = new Intl.DateTimeFormat('zh-CN', { dateStyle: 'short', timeStyle: 'medium' }).format(
    entry.startedAtMs,
  )
  const progress = entry.completed
    ? '已播完'
    : entry.durationMs
      ? `${Math.round(Math.min(100, Math.max(0, (entry.positionMs / entry.durationMs) * 100)))}%`
      : `${Math.round(entry.positionMs / 1000)}s`
  return `播放于 ${time} · ${progress}`
}
