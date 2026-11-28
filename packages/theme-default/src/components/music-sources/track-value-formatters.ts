const dateFormatter = new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium' })
const compactCountFormatter = new Intl.NumberFormat('zh-CN', {
  notation: 'compact',
  maximumFractionDigits: 1,
})

export function formatTrackDate(timestamp: number): string {
  return dateFormatter.format(timestamp)
}

export function formatCompactCount(count?: number): string {
  return count === undefined ? '—' : compactCountFormatter.format(count)
}
