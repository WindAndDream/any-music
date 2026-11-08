import type { Track } from '@any-music/core'
import { describe, expect, it } from 'vitest'
import { effectScope, nextTick, shallowRef } from 'vue'

import { useHistoryCollection } from '../../../src/composables/library/use-history-collection'
import { createCatalogTrackFilterState } from '../../../src/composables/music-sources/use-catalog-track-filters'

describe('playback history collection', () => {
  it('filters repeated plays by their song tags and scopes choices to the active platform', () => {
    const tracks: Track[] = ['a', 'b'].map((id) => ({
      id,
      title: id,
      artists: [],
      source: { pluginId: id, resourceId: id, mediaKind: 'audio' },
    }))
    const scope = effectScope()
    const history = scope.run(() =>
      useHistoryCollection({
        tracks,
        names: new Map(),
        customTags: new Map([
          ['a', ['通勤']],
          ['b', ['放松']],
        ]),
        entries: ['a', 'a', 'b'].map((trackId, index) => ({
          id: String(index),
          trackId,
          startedAtMs: 0,
          updatedAtMs: 0,
          positionMs: 0,
          completed: false,
        })),
      }),
    )!
    try {
      history.draft.value = { ...history.filters.value, tags: ['通勤'] }
      history.applyFilters()
      expect(history.visible.value.map(({ entry }) => entry.id)).toEqual(['0', '1'])
      history.activePlatform.value = 'b'
      expect(history.scopedRows.value).toHaveLength(1)
      expect(history.tagStats.value).toEqual([{ name: '放松', count: 1 }])
      expect(history.visible.value).toEqual([])
    } finally {
      scope.stop()
    }
  })
  it('filters and selects individual plays of the same track by playback date', async () => {
    const track: Track = {
      id: 'song',
      title: 'Song',
      artists: [],
      source: { pluginId: 'source', resourceId: 'song', mediaKind: 'audio' },
    }
    const makeEntry = (id: string, day: number) => ({
      id,
      trackId: track.id,
      startedAtMs: new Date(2024, 0, day, 12).getTime(),
      updatedAtMs: 0,
      positionMs: 0,
      completed: false,
    })
    const entries = shallowRef([makeEntry('first', 1), makeEntry('second', 2)])
    const scope = effectScope()
    const history = scope.run(() =>
      useHistoryCollection({ entries, tracks: [track], names: new Map() }),
    )!
    expect(history.visible.value.map(({ entry }) => entry.id)).toEqual(['first', 'second'])
    history.select('first')
    expect(history.selectedIds.value).toEqual([])
    history.operatorOpen.value = true
    history.select('first')
    history.select('second')
    expect(history.selected.value.map(({ entry }) => entry.id)).toEqual(['first', 'second'])
    const filters = createCatalogTrackFilterState()
    filters.publishedRanges = [{ from: '2024-01-02', to: '2024-01-02' }]
    history.draft.value = filters
    history.applyFilters()
    expect(history.visible.value.map(({ entry }) => entry.id)).toEqual(['second'])
    expect(history.selectedIds.value).toEqual(['second'])
    entries.value = []
    await nextTick()
    expect(history.selectedIds.value).toEqual([])
    scope.stop()
  })
})
