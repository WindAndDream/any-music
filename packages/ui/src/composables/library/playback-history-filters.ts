export type PlaybackHistoryTimeRange = 'all' | 'today' | 'week' | 'month'

/** 把播放历史时间范围转换为稳定下界，组件无需重复处理自然日边界。 */
export function getPlaybackHistoryStartedAfterMs(
  range: PlaybackHistoryTimeRange,
  nowMs = Date.now(),
): number | undefined {
  if (range === 'all') return undefined
  const now = new Date(nowMs)
  if (range === 'today') {
    return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  }
  const durationDays = range === 'week' ? 7 : 30
  return nowMs - durationDays * 24 * 60 * 60 * 1000
}
