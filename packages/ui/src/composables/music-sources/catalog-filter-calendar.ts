/** 日期字符串只表示本地日历日；日历网格用 UTC 运算，避免夏令时让格子重复或缺失。 */
export function formatCatalogCalendarDate(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`
}

export function getCatalogCalendarToday(): string {
  const now = new Date()
  return formatCatalogCalendarDate(
    new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())),
  )
}

export function isCatalogCalendarDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00Z`)
  return Number.isFinite(date.getTime()) && formatCatalogCalendarDate(date) === value
}

export function shiftCatalogCalendarDate(value: string, dayCount: number): string {
  const date = new Date(`${value}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + dayCount)
  return formatCatalogCalendarDate(date)
}

export function shiftCatalogCalendarMonth(month: string, monthCount: number): string {
  const date = new Date(`${month}-01T00:00:00Z`)
  date.setUTCMonth(date.getUTCMonth() + monthCount)
  return formatCatalogCalendarDate(date).slice(0, 7)
}

/** 固定六周、周一开头，让翻月时选择器和右侧条件列表保持稳定高度。 */
export function createCatalogCalendarDays(month: string): readonly string[] {
  const first = `${month}-01`
  const weekday = new Date(`${first}T00:00:00Z`).getUTCDay()
  const offset = (weekday + 6) % 7
  return Array.from({ length: 42 }, (_, index) => shiftCatalogCalendarDate(first, index - offset))
}
