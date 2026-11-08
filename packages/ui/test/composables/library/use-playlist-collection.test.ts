import type { MusicPlaylist } from '@any-music/core'
import { describe, expect, it } from 'vitest'
import { effectScope, nextTick, shallowRef } from 'vue'

import {
  createPlaylistOverviewFilters,
  filterPlaylistOverview,
  reorderVisiblePlaylists,
  usePlaylistCollection,
} from '../../../src/composables/library/use-playlist-collection'
import { createEditingSession } from '../../../src/composables/use-editing-session'

const playlists: MusicPlaylist[] = [
  {
    id: 'a',
    name: 'Ｍｉｘ',
    description: '夏日',
    coverId: 'cover',
    trackIds: ['one', 'shared'],
    createdAtMs: 1,
    updatedAtMs: 1,
  },
  { id: 'hidden', name: 'Empty', trackIds: [], createdAtMs: 2, updatedAtMs: 2 },
  { id: 'b', name: 'Other', trackIds: ['shared', 'two'], createdAtMs: 3, updatedAtMs: 3 },
]

describe('playlist overview collection', () => {
  it.each([
    { cover: [], ids: ['a', 'hidden', 'b'] },
    { cover: ['present'], ids: ['a'] },
    { cover: ['missing'], ids: ['hidden', 'b'] },
    { cover: ['present', 'missing'], ids: ['a', 'hidden', 'b'] },
  ] as const)('matches any selected cover condition: $cover', ({ cover, ids }) => {
    expect(
      filterPlaylistOverview(playlists, { ...createPlaylistOverviewFilters(), cover }).map(
        ({ id }) => id,
      ),
    ).toEqual(ids)
  })

  it('intersects normalized name/description, cover and count filters', () => {
    const filters = createPlaylistOverviewFilters()
    expect(
      filterPlaylistOverview(playlists, { ...filters, keyword: ' mix ' }).map(({ id }) => id),
    ).toEqual(['a'])
    expect(
      filterPlaylistOverview(playlists, {
        ...filters,
        keyword: '夏日',
        trackCountRanges: [{ minCount: 1 }],
        cover: ['present'],
      }).map(({ id }) => id),
    ).toEqual(['a'])
    expect(
      filterPlaylistOverview(playlists, {
        ...filters,
        trackCountRanges: [{ maxCount: 1 }],
        cover: ['missing'],
      }).map(({ id }) => id),
    ).toEqual(['hidden'])
    expect(
      filterPlaylistOverview(playlists, {
        ...filters,
        trackCountRanges: [{ maxCount: 1 }],
        cover: ['present'],
      }),
    ).toEqual([])
  })

  it('unions inclusive count ranges and playlist tags, then intersects dimensions', () => {
    const tags = new Map([
      ['a', ['通勤', '夏日']],
      ['hidden', ['放松']],
      ['b', ['通勤']],
    ])
    const filters = {
      ...createPlaylistOverviewFilters(),
      trackCountRanges: [{ maxCount: 1 }, { minCount: 2, maxCount: 2 }],
      tags: ['夏日', '放松'],
    }
    expect(filterPlaylistOverview(playlists, filters, tags).map(({ id }) => id)).toEqual([
      'a',
      'hidden',
    ])
    expect(
      filterPlaylistOverview(
        playlists,
        { ...filters, keyword: '夏日', cover: ['present'] },
        tags,
      ).map(({ id }) => id),
    ).toEqual(['a'])
    expect(
      filterPlaylistOverview(playlists, { ...filters, trackCountRanges: [{ minCount: 3 }] }, tags),
    ).toEqual([])
    expect(filterPlaylistOverview(playlists, { ...filters, tags: ['missing'] }, tags)).toEqual([])
    expect(filterPlaylistOverview(playlists, { ...filters, tagsDormant: true }, tags)).toHaveLength(
      3,
    )
    expect(filterPlaylistOverview(playlists, filters, tags, false)).toHaveLength(3)
  })

  it('reacts to playlist tag projections in previews and applied filters', async () => {
    const tags = shallowRef<ReadonlyMap<string, readonly string[]>>(new Map([['a', ['通勤']]]))
    const scope = effectScope()
    const collection = scope.run(() =>
      usePlaylistCollection({ playlists, customTagsByPlaylistId: tags }),
    )!
    collection.draft.value = { ...createPlaylistOverviewFilters(), tags: ['通勤'] }
    expect(collection.preview.value.map(({ id }) => id)).toEqual(['a'])
    expect(collection.visible.value).toHaveLength(3)
    collection.applyFilters()
    tags.value = new Map([['b', ['通勤']]])
    await nextTick()
    expect(collection.visible.value.map(({ id }) => id)).toEqual(['b'])
    scope.stop()
  })

  it('preserves hidden slots and rejects stale/invalid moves without duplicating IDs', () => {
    const all = ['a', 'hidden', 'b', 'tail']
    expect(reorderVisiblePlaylists(all, 'a', 'b', ['a', 'b'])).toEqual(['b', 'hidden', 'a', 'tail'])
    expect(reorderVisiblePlaylists(all, 'b', 'a', ['a', 'b', 'removed', 'a'])).toEqual([
      'b',
      'hidden',
      'a',
      'tail',
    ])
    expect(reorderVisiblePlaylists(all, 'removed', 'b', ['a', 'b'])).toBe(all)
    expect(reorderVisiblePlaylists(all, 'a', 'a', ['a', 'b'])).toBe(all)
  })

  it('applies drafts transactionally, deduplicates songs in selection order and clears stale selection', async () => {
    const source = shallowRef(playlists)
    const scope = effectScope()
    const collection = scope.run(() => usePlaylistCollection({ playlists: source }))!
    collection.select('a')
    expect(collection.selected.value).toEqual([])
    collection.operatorOpen.value = true
    collection.select('b')
    collection.select('a')
    expect(collection.selectedTrackIds.value).toEqual(['shared', 'two', 'one'])
    collection.draft.value = {
      ...createPlaylistOverviewFilters(),
      trackCountRanges: [{ maxCount: 1 }],
    }
    expect(collection.visible.value).toHaveLength(3)
    expect(collection.preview.value.map(({ id }) => id)).toEqual(['hidden'])
    collection.draft.value = null
    expect(collection.visible.value).toHaveLength(3)
    collection.draft.value = { ...createPlaylistOverviewFilters(), cover: ['present'] }
    collection.applyFilters()
    await nextTick()
    expect(collection.selected.value.map(({ id }) => id)).toEqual(['a'])
    source.value = []
    await nextTick()
    expect(collection.selection.value).toEqual([])
    collection.operatorOpen.value = false
    expect(collection.selection.value).toEqual([])
    scope.stop()
  })

  it('keeps filters/drafts/selection through presentation replacement and clears on operator close', () => {
    const editing = createEditingSession()
    const first = effectScope()
    const a = first.run(() => usePlaylistCollection({ playlists, editing }))!
    a.operatorOpen.value = true
    a.toggleAll()
    a.draft.value = { ...createPlaylistOverviewFilters(), keyword: 'unfinished' }
    first.stop()
    const second = effectScope()
    const b = second.run(() => usePlaylistCollection({ playlists, editing }))!
    expect(b.draft.value?.keyword).toBe('unfinished')
    expect(b.allSelected.value).toBe(true)
    b.operatorOpen.value = false
    expect(b.selection.value).toEqual([])
    second.stop()
    editing.dispose()
  })
})
