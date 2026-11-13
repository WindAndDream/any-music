/** 将播放进度限制到安全的 0 到 1 区间；NaN 表示未知进度，按起点 0 处理。 */
export function normalizeProgress(progress: number): number {
  return Number.isNaN(progress) ? 0 : Math.min(1, Math.max(0, progress))
}
