import type { LibraryTrackRecord, Track } from '@any-music/core'
import { describe, expect, it } from 'vitest'
import { defineComponent, h, provide, shallowRef } from 'vue'

import { useDownloadListControls } from '../../../src/composables/downloads/use-download-list-controls'
import { useHistoryCollection } from '../../../src/composables/library/use-history-collection'
import { usePlaylistFilters } from '../../../src/composables/library/use-playlist-filters'
import { useCatalogTrackFilters } from '../../../src/composables/music-sources/use-catalog-track-filters'
import { useQueueListControls } from '../../../src/composables/music-sources/use-queue-list-controls'
import { UI_CONTRIBUTIONS } from '../../../src/product/ui-contributions'
import { mountCatalogComponent } from '../../components/music-sources/catalog-test-renderer'

const track: Track = {
  id: 'one',
  title: '原曲',
  sourceTags: ['来源标签'],
  artists: [{ name: '作者' }],
  source: { pluginId: 'test', resourceId: '1', mediaKind: 'audio' },
}
const records: LibraryTrackRecord[] = [
  { track, customTags: ['用户标签'], addedAtMs: 1, updatedAtMs: 1 },
]

describe('user tag projection suspension', () => {
  it('suspends filters across collections while retaining visible dormant conditions', () => {
    const enabled = shallowRef(true)
    let catalog!: ReturnType<typeof useCatalogTrackFilters>
    let queue!: ReturnType<typeof useQueueListControls>
    let playlist!: ReturnType<typeof usePlaylistFilters>
    let history!: ReturnType<typeof useHistoryCollection>
    let downloads!: ReturnType<typeof useDownloadListControls>
    const child = defineComponent({
      setup() {
        catalog = useCatalogTrackFilters([track], new Map([['one', ['用户标签']]]))
        queue = useQueueListControls({
          items: [track],
          customTags: new Map([['one', ['用户标签']]]),
          addedAtMsByTrackId: new Map(),
          platformNames: new Map(),
          filterOpen: false,
        })
        playlist = usePlaylistFilters(records, [{ id: 'test', name: 'test' }], [])
        history = useHistoryCollection({
          tracks: [track],
          names: new Map(),
          customTags: new Map([['one', ['用户标签']]]),
          entries: [
            {
              id: 'play',
              trackId: 'one',
              startedAtMs: 1,
              updatedAtMs: 1,
              positionMs: 0,
              completed: false,
            },
          ],
        })
        downloads = useDownloadListControls({
          filterOpen: false,
          platformNames: new Map(),
          customTags: new Map([['one', ['用户标签']]]),
          batches: [
            {
              id: 'batch',
              status: 'completed',
              startedAtMs: 1,
              concurrency: 1,
              origin: { kind: 'queue', label: '待听' },
              items: [
                {
                  id: 'task',
                  track,
                  status: 'succeeded',
                  requestedAtMs: 1,
                  savedAtMs: 2,
                  maxRetryCount: 0,
                  attempts: [],
                },
              ],
            },
          ],
        })
        return () => h('div')
      },
    })
    const host = defineComponent({
      setup() {
        provide(UI_CONTRIBUTIONS, {
          resolve: () =>
            enabled.value
              ? [
                  {
                    id: 'feature.tags/filter',
                    implementationId: 'tag-filter',
                    revision: 1,
                    viewRevision: 1,
                    contextKey: '',
                  },
                ]
              : [],
          accepts: () => enabled.value,
        })
        return () => h(child)
      },
    })
    const mounted = mountCatalogComponent(host, {})
    catalog.filters.value = { ...catalog.filters.value, tags: ['用户标签'] }
    queue.filters.value = { ...queue.filters.value, searchFilters: [{ query: '用户标签' }] }
    playlist.filters.value = { ...playlist.filters.value, regularTag: '用户标签' }
    history.filters.value = { ...history.filters.value, tags: ['不存在'] }
    downloads.filters.value = { ...downloads.filters.value, tags: ['不存在'] }
    expect(history.visible.value).toEqual([])
    expect(downloads.visibleEntries.value).toEqual([])
    expect(catalog.visibleTracks.value).toEqual([track])
    expect(queue.visibleTracks.value).toEqual([track])
    enabled.value = false
    expect(catalog.visibleTracks.value).toEqual([track])
    expect(catalog.filters.value.tagsDormant).toBe(true)
    expect(queue.visibleTracks.value).toEqual([])
    expect(playlist.visibleRecords.value).toEqual(records)
    expect(playlist.filters.value.tagsDormant).toBe(true)
    expect(history.visible.value).toHaveLength(1)
    expect(history.filters.value.tagsDormant).toBe(true)
    expect(downloads.visibleEntries.value).toHaveLength(1)
    expect(downloads.filters.value.tagsDormant).toBe(true)
    catalog.filters.value = { ...catalog.filters.value, searchFilters: [{ query: '来源标签' }] }
    expect(catalog.visibleTracks.value).toEqual([track])
    catalog.filters.value = { ...catalog.filters.value, searchFilters: [{ query: '用户标签' }] }
    expect(catalog.visibleTracks.value).toEqual([])
    enabled.value = true
    expect(catalog.filters.value.tagsDormant).toBe(true)
    expect(history.visible.value).toHaveLength(1)
    expect(downloads.visibleEntries.value).toHaveLength(1)
    history.filters.value = { ...history.filters.value, tagsDormant: false }
    downloads.filters.value = { ...downloads.filters.value, tagsDormant: false }
    expect(history.visible.value).toEqual([])
    expect(downloads.visibleEntries.value).toEqual([])
    expect(catalog.visibleTracks.value).toEqual([track])
    catalog.filters.value = { ...catalog.filters.value, tags: ['不存在'] }
    expect(catalog.visibleTracks.value).toEqual([track])
    catalog.filters.value = { ...catalog.filters.value, tagsDormant: false }
    expect(catalog.visibleTracks.value).toEqual([])
    mounted.unmount()
  })
})
