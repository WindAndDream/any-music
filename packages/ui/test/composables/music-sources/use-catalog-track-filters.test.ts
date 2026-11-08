import type { Track } from '@any-music/core'
import { describe, expect, it } from 'vitest'
import { shallowRef } from 'vue'

import {
  cloneCatalogTrackFilterState,
  createCatalogTrackFilterState,
  countCatalogTrackFilters,
  filterCatalogTracks,
  useCatalogTrackFilters,
} from '../../../src/composables/music-sources/use-catalog-track-filters'

describe('useCatalogTrackFilters', () => {
  it('intersects naming with tags and search, including newly loaded and restored names', () => {
    const first = createTrack('one', '来源音乐', '甲', 'a', '2026-03-01', 90_000)
    const second = createTrack('two', '来源音乐', '乙', 'b', '2026-03-02', 90_000)
    const tracks = shallowRef<readonly Track[]>([first, second])
    const names = shallowRef<ReadonlyMap<string, string>>(new Map([['one', '夜间音乐']]))
    const catalog = useCatalogTrackFilters(
      tracks,
      new Map([
        ['one', ['通勤']],
        ['two', ['通勤']],
      ]),
      names,
    )
    catalog.filters.value = {
      ...createCatalogTrackFilterState(),
      naming: 'custom',
      tags: ['通勤'],
      searchFilters: [{ query: '音乐' }],
    }
    expect(catalog.visibleTracks.value).toEqual([first])
    expect(catalog.filterCounts.value.total).toBe(3)
    expect(
      filterCatalogTracks(
        tracks.value,
        new Map([
          ['one', ['通勤']],
          ['two', ['通勤']],
        ]),
        catalog.filters.value,
        names.value,
      ),
    ).toEqual(catalog.visibleTracks.value)
    names.value = new Map()
    expect(catalog.visibleTracks.value).toEqual([])
    catalog.filters.value = { ...catalog.filters.value, naming: 'original' }
    expect(catalog.visibleTracks.value).toEqual([first, second])
    tracks.value = [
      ...tracks.value,
      { ...first, id: 'third', source: { ...first.source, mediaKind: 'custom' } },
    ]
    catalog.filters.value = { ...catalog.filters.value, tags: [] }
    expect(catalog.visibleTracks.value).toHaveLength(3)
    expect(catalog.visibleTracks.value[0]).toBe(first)
  })
  it('searches custom and original names reactively without changing source identity', () => {
    const track = createTrack('one', '来源原名', '作者', 'author', '2026-03-01', 90_000)
    const names = shallowRef<ReadonlyMap<string, string>>(new Map([['one', '通勤']]))
    const catalog = useCatalogTrackFilters([track], new Map(), names)
    catalog.filters.value = { ...catalog.filters.value, searchFilters: [{ query: '通勤' }] }
    expect(catalog.visibleTracks.value).toEqual([track])
    names.value = new Map([['one', '夜晚']])
    expect(catalog.visibleTracks.value).toEqual([])
    catalog.filters.value = { ...catalog.filters.value, searchFilters: [{ query: '来源原名' }] }
    expect(catalog.visibleTracks.value[0]).toBe(track)
    catalog.filters.value = { ...catalog.filters.value, searchFilters: [{ query: '夜晚' }] }
    expect(filterCatalogTracks([track], new Map(), catalog.filters.value, names.value)).toEqual([
      track,
    ])
    names.value = new Map()
    expect(catalog.visibleTracks.value).toEqual([])
  })
  it('unions items within one dimension and intersects different dimensions', () => {
    const tracks = shallowRef<readonly Track[]>([
      createTrack('morning', '晨间音乐', '晨光博主', 'author-42', '2026-01-15', 120_000),
      createTrack('night', '夜晚音乐', '夜色博主', 'author-88', '2026-02-20', 330_000),
      createTrack('talk', '夜晚访谈', '夜色博主', 'author-88', '2026-02-20', 330_000),
      createTrack('other-tag', '晨间音乐', '晨光博主', 'author-42', '2026-01-15', 120_000),
    ])
    const customTagsByTrackId = shallowRef<ReadonlyMap<string, readonly string[]>>(
      new Map([
        ['morning', ['通勤']],
        ['night', ['放松']],
        ['talk', ['放松']],
        ['other-tag', ['纯音乐']],
      ]),
    )
    const catalogFilters = useCatalogTrackFilters(tracks, customTagsByTrackId)

    catalogFilters.filters.value = {
      searchFilters: [{ query: '音乐' }],
      tags: ['通勤', '放松'],
      publishedRanges: [
        { from: '2026-01-01', to: '2026-01-31' },
        { from: '2026-02-01', to: '2026-02-28' },
      ],
      durationRanges: [
        { minMs: 60_000, maxMs: 180_000 },
        { minMs: 300_000, maxMs: 360_000 },
      ],
    }

    expect(catalogFilters.visibleTracks.value.map((track) => track.id)).toEqual([
      'morning',
      'night',
    ])
    expect(catalogFilters.filterCounts.value).toEqual({
      search: 1,
      tags: 2,
      published: 2,
      duration: 2,
      platforms: 0,
      naming: 0,
      total: 7,
    })
  })

  it('matches titles, authors and user IDs with one keyword and excludes unknown ranges', () => {
    const tracks = shallowRef<readonly Track[]>([
      createTrack('title', '清晨电台', '甲', 'one', '2026-03-01', 90_000),
      createTrack('artist', '普通标题', '清晨作者', 'two', '2026-03-02', 150_000),
      createTrack('user-id', '普通歌曲', '乙', '清晨-id', '2026-03-02', 120_000),
      createTrack('unknown', '清晨未知', '甲', 'three'),
    ])
    const catalogFilters = useCatalogTrackFilters(
      tracks,
      shallowRef<ReadonlyMap<string, readonly string[]>>(new Map()),
    )

    catalogFilters.filters.value = {
      searchFilters: [{ query: ' 清晨 ' }],
      tags: [],
      publishedRanges: [{ from: '2026-03-01', to: '2026-03-31' }],
      durationRanges: [{ maxMs: 180_000 }],
    }

    expect(catalogFilters.visibleTracks.value.map((track) => track.id)).toEqual([
      'title',
      'artist',
      'user-id',
    ])
  })

  it('reacts to newly assigned custom tags without changing source order', () => {
    const tracks = shallowRef<readonly Track[]>([
      createTrack('first', '第一首', '博主一', 'one'),
      createTrack('second', '第二首', '博主二', 'two'),
    ])
    const customTagsByTrackId = shallowRef<ReadonlyMap<string, readonly string[]>>(new Map())
    const catalogFilters = useCatalogTrackFilters(tracks, customTagsByTrackId)
    catalogFilters.filters.value = {
      ...catalogFilters.filters.value,
      tags: ['收藏候选'],
    }

    expect(catalogFilters.visibleTracks.value).toEqual([])
    customTagsByTrackId.value = new Map([
      ['first', ['收藏候选']],
      ['second', ['收藏候选']],
    ])
    expect(catalogFilters.visibleTracks.value.map((track) => track.id)).toEqual(['first', 'second'])
    expect(catalogFilters.tagStats.value).toEqual([{ name: '收藏候选', count: 2 }])
  })

  it('counts every independently removable filter item', () => {
    expect(
      countCatalogTrackFilters({
        searchFilters: [{ query: '一' }],
        tags: ['通勤'],
        publishedRanges: [{ from: '2026-01-01', to: '' }],
        durationRanges: [{ maxMs: 180_000 }],
      }),
    ).toEqual({ search: 1, tags: 1, published: 1, duration: 1, platforms: 0, naming: 0, total: 4 })
  })

  it('clones an independent draft and uses the same pure filter result for previews', () => {
    const appliedFilters = {
      searchFilters: [{ query: '保留' }],
      tags: ['通勤'],
      publishedRanges: [{ from: '2026-01-01', to: '' }],
      durationRanges: [{ maxMs: 180_000 }],
    }
    const draft = cloneCatalogTrackFilterState(appliedFilters)
    const tracks = [
      createTrack('keep', '保留歌曲', '甲', 'one', '2026-02-01', 120_000),
      createTrack('drop', '其他歌曲', '乙', 'two', '2026-02-01', 120_000),
    ]
    const customTagsByTrackId = new Map<string, readonly string[]>([
      ['keep', ['通勤']],
      ['drop', ['通勤']],
    ])

    expect(draft).toEqual(appliedFilters)
    expect(draft).not.toBe(appliedFilters)
    expect(draft.searchFilters[0]).not.toBe(appliedFilters.searchFilters[0])
    expect(
      filterCatalogTracks(tracks, customTagsByTrackId, draft).map((track) => track.id),
    ).toEqual(['keep'])
  })
})

function createTrack(
  id: string,
  title: string,
  artistName: string,
  artistId: string,
  publishedDate?: string,
  durationMs?: number,
): Track {
  return {
    id,
    title,
    artists: [{ id: artistId, name: artistName }],
    publishedAtMs: publishedDate ? new Date(`${publishedDate}T12:00:00`).getTime() : undefined,
    durationMs,
    source: { pluginId: 'test', mediaKind: 'audio', resourceId: id },
  }
}
