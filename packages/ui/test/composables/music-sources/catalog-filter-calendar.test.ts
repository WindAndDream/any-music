import { describe, expect, it } from 'vitest'

import {
  createCatalogCalendarDays,
  isCatalogCalendarDate,
  shiftCatalogCalendarDate,
  shiftCatalogCalendarMonth,
} from '../../../src/composables/music-sources/catalog-filter-calendar'

describe('catalog filter calendar', () => {
  it('builds six Monday-first weeks across leap days and year boundaries', () => {
    const dates = createCatalogCalendarDays('2024-02')
    expect(dates).toHaveLength(42)
    expect(dates[0]).toBe('2024-01-29')
    expect(dates).toContain('2024-02-29')
    expect(new Set(dates).size).toBe(42)
    expect(shiftCatalogCalendarDate('2024-12-31', 1)).toBe('2025-01-01')
    expect(shiftCatalogCalendarMonth('2024-01', -1)).toBe('2023-12')
    expect(isCatalogCalendarDate('2026-02-29')).toBe(false)
    expect(isCatalogCalendarDate('2024-02-29')).toBe(true)
  })
})
