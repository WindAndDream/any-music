import type { Track } from '@any-music/core'
import { describe, expect, it } from 'vitest'

import { getCatalogFilterDimensions } from '../../../src/components/music-sources/catalog-track-filter-presentation'
import { createCatalogTrackFilterState } from '../../../src/composables/music-sources/use-catalog-track-filters'
import { filterQueueTracks } from '../../../src/composables/music-sources/use-queue-list-controls'

const date = (day: number, hour = 12) => new Date(2026, 9, day, hour).getTime()
function track(id: string, platform: string, durationMs?: number): Track {
  return {
    id,
    title: `音乐 ${id}`,
    artists: [{ name: '作者', id: 'USER-42' }],
    durationMs,
    publishedAtMs: new Date(2020, 1, 1).getTime(),
    source: { pluginId: platform, resourceId: id, mediaKind: 'audio' },
  }
}
describe('queue filters', () => {
  const tracks = [
    track('one', 'a', 120_000),
    track('two', 'b', 180_000),
    track('three', 'a', 600_000),
    track('legacy', 'a'),
  ]
  const times = new Map([
    ['one', date(12, 23)],
    ['two', date(13, 0)],
    ['three', date(10)],
  ])
  it('intersects text, duration, platforms and queue dates, including the end date', () => {
    const filters = {
      ...createCatalogTrackFilterState(),
      searchFilters: [{ query: 'ｕｓｅｒ-42' }],
      durationRanges: [{ minMs: 60_000, maxMs: 180_000 }],
      platformIds: ['a'],
      publishedRanges: [{ from: '2026-10-12', to: '2026-10-12' }],
    }
    expect(filterQueueTracks(tracks, filters, times)).toEqual([tracks[0]])
    expect(
      filterQueueTracks(
        tracks,
        { ...filters, platformIds: ['a', 'b'], publishedRanges: [] },
        times,
      ),
    ).toEqual([tracks[0], tracks[1]])
    expect(tracks.map((item) => item.id)).toEqual(['one', 'two', 'three', 'legacy'])
  })
  it('unions addition-date ranges and leaves legacy entries visible without a date filter', () => {
    expect(filterQueueTracks(tracks, createCatalogTrackFilterState(), times)).toBe(tracks)
    const filters = {
      ...createCatalogTrackFilterState(),
      publishedRanges: [
        { from: '2026-10-10', to: '2026-10-10' },
        { from: '2026-10-13', to: '' },
      ],
    }
    expect(filterQueueTracks(tracks, filters, times).map((item) => item.id)).toEqual([
      'two',
      'three',
    ])
    expect(
      filterQueueTracks(
        tracks,
        { ...filters, publishedRanges: [{ from: '2020-01-01', to: '2020-12-31' }] },
        times,
      ),
    ).toEqual([])
  })
  it('searches custom names and offers exactly the requested queue dimensions', () => {
    expect(
      filterQueueTracks(
        tracks,
        { ...createCatalogTrackFilterState(), searchFilters: [{ query: '通勤' }] },
        times,
        new Map([['two', '通勤音乐']]),
      ),
    ).toEqual([tracks[1]])
    expect(getCatalogFilterDimensions('queue').map(({ id }) => id)).toEqual([
      'search',
      'tags',
      'duration',
      'platforms',
      'published',
    ])
    expect(getCatalogFilterDimensions('queue').find(({ id }) => id === 'published')?.label).toBe(
      '添加时间',
    )
    expect(getCatalogFilterDimensions('favorites').map(({ id }) => id)).toEqual([
      'search',
      'tags',
      'duration',
      'platforms',
      'published',
    ])
    expect(
      getCatalogFilterDimensions('favorites').find(({ id }) => id === 'published')?.label,
    ).toBe('喜欢时间')
  })
  it.each(['queue', 'favorites', 'downloads'] as const)(
    'intersects tag selections with the other %s dimensions',
    (context) => {
      expect(getCatalogFilterDimensions(context).some(({ id }) => id === 'tags')).toBe(true)
      const filters = {
        ...createCatalogTrackFilterState(),
        tags: ['通勤', '放松'],
        platformIds: ['a'],
        durationRanges: [{ maxMs: 180_000 }],
      }
      const tags = new Map([
        ['one', ['通勤']],
        ['two', ['放松']],
        ['three', ['通勤']],
      ])
      expect(filterQueueTracks(tracks, filters, times, new Map(), tags)).toEqual([tracks[0]])
      expect(
        filterQueueTracks(tracks, { ...filters, tagsDormant: true }, times, new Map(), tags),
      ).toEqual(filterQueueTracks(tracks, { ...filters, tags: [] }, times))
    },
  )
  it.each(['queue', 'favorites', 'downloads', 'drawers'] as const)(
    'omits the platform dimension only when %s is externally scoped',
    (context) => {
      expect(getCatalogFilterDimensions(context).some(({ id }) => id === 'platforms')).toBe(true)
      expect(
        getCatalogFilterDimensions(context, { platformScoped: true }).some(
          ({ id }) => id === 'platforms',
        ),
      ).toBe(false)
    },
  )
})
