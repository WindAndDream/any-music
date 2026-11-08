import { describe, expect, it } from 'vitest'

import {
  commitCatalogTrackFilterDimension,
  filterCatalogTagStats,
  getCatalogTrackFilterLabels,
} from '../../../src/components/music-sources/catalog-track-filter-presentation'
import { createCatalogTrackFilterState } from '../../../src/composables/music-sources/use-catalog-track-filters'

describe('catalog track filter presentation', () => {
  it('commits only one search keyword and preserves the other dimensions', () => {
    const current = {
      ...createCatalogTrackFilterState(),
      tags: ['现场'],
      durationRanges: [{ minMs: 60_000, maxMs: 180_000 }],
    }
    const draft = {
      ...current,
      tags: ['演奏'],
      searchFilters: [{ query: '  夜曲  ' }, { query: '晨光' }],
    }
    expect(commitCatalogTrackFilterDimension(current, draft, 'search')).toEqual({
      ...current,
      searchFilters: [{ query: '夜曲' }],
    })
    expect(getCatalogTrackFilterLabels(draft, 'search')).toEqual(['夜曲'])
  })

  it('normalizes and deduplicates ranges without losing fractional duration precision', () => {
    const current = createCatalogTrackFilterState()
    const published = commitCatalogTrackFilterDimension(
      current,
      {
        ...current,
        publishedRanges: [
          { from: '2026-01-15', to: '2026-01-01' },
          { from: '2026-01-01', to: '2026-01-15' },
        ],
      },
      'published',
    )
    expect(published.publishedRanges).toEqual([{ from: '2026-01-01', to: '2026-01-15' }])
    expect(
      getCatalogTrackFilterLabels(
        { ...current, durationRanges: [{ minMs: 65_123, maxMs: 98_765 }] },
        'duration',
      ),
    ).toEqual(['1.0854 分钟 至 1.6461 分钟'])
  })

  it('searches available tags without changing their order or filter state', () => {
    const tagStats = [
      { name: '现场演奏', count: 8 },
      { name: 'Live', count: 5 },
      { name: '纯音乐', count: 3 },
    ]
    expect(filterCatalogTagStats(tagStats, '')).toBe(tagStats)
    expect(filterCatalogTagStats(tagStats, '  现场 ')).toEqual([{ name: '现场演奏', count: 8 }])
    expect(filterCatalogTagStats(tagStats, 'ＬＩＶＥ')).toEqual([{ name: 'Live', count: 5 }])
    expect(filterCatalogTagStats(tagStats, '不存在')).toEqual([])
  })
})
