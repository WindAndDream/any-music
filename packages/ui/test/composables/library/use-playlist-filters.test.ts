import type { LibraryTrackRecord } from '@any-music/core'
import { describe, expect, it } from 'vitest'
import { nextTick, shallowRef } from 'vue'

import { usePlaylistFilters } from '../../../src/composables/library/use-playlist-filters'

describe('usePlaylistFilters', () => {
  it('keeps unliked tracks and preserves playlist order in mixed mode', () => {
    const records = shallowRef<readonly LibraryTrackRecord[]>([
      createRecord('douyin:audio:2', 'douyin', undefined),
      createRecord('bilibili:audio:1', 'bilibili', 200),
    ])
    const filters = usePlaylistFilters(
      records,
      [
        { id: 'bilibili', name: '哔哩哔哩' },
        { id: 'douyin', name: '抖音' },
      ],
      [],
    )

    expect(filters.visibleRecords.value.map((record) => record.track.id)).toEqual([
      'douyin:audio:2',
      'bilibili:audio:1',
    ])
    expect(filters.platformDrawers.value.map((drawer) => drawer.platform.id)).toEqual([
      'bilibili',
      'douyin',
      'local-custom',
    ])
  })

  it('filters playlist members by selected platform and title', async () => {
    const records = shallowRef<readonly LibraryTrackRecord[]>([
      createRecord('douyin:audio:2', 'douyin'),
      createRecord('bilibili:audio:1', 'bilibili'),
    ])
    const result = usePlaylistFilters(
      records,
      [
        { id: 'bilibili', name: '哔哩哔哩' },
        { id: 'douyin', name: '抖音' },
      ],
      [],
    )
    result.filters.value = {
      ...result.filters.value,
      selectedPlatformIds: ['bilibili'],
      titleQuery: '歌曲 1',
    }
    await nextTick()

    expect(result.visibleRecords.value.map((record) => record.track.id)).toEqual([
      'bilibili:audio:1',
    ])
  })

  it('combines platform, favorite status and duration without changing playlist order', () => {
    const records = shallowRef<readonly LibraryTrackRecord[]>([
      {
        ...createRecord('douyin:audio:1', 'douyin', 100),
        track: { ...createRecord('douyin:audio:1', 'douyin').track, durationMs: 180_000 },
      },
      {
        ...createRecord('douyin:audio:2', 'douyin'),
        track: { ...createRecord('douyin:audio:2', 'douyin').track, durationMs: 600_000 },
      },
      {
        ...createRecord('bilibili:audio:3', 'bilibili', 100),
        track: { ...createRecord('bilibili:audio:3', 'bilibili').track, durationMs: 180_000 },
      },
    ])
    const result = usePlaylistFilters(
      records,
      [
        { id: 'douyin', name: '抖音' },
        { id: 'bilibili', name: '哔哩哔哩' },
      ],
      [],
    )

    result.filters.value = {
      ...result.filters.value,
      selectedPlatformIds: ['douyin'],
      favoriteOnly: true,
      durationRange: 'short',
    }

    expect(result.visibleRecords.value.map((record) => record.track.id)).toEqual(['douyin:audio:1'])
    expect(result.filters.value.arrangementMode).toBe('mixed')
  })
})

function createRecord(id: string, pluginId: string, favoritedAtMs?: number): LibraryTrackRecord {
  return {
    track: {
      id,
      title: `歌曲 ${id.at(-1)}`,
      artists: [{ name: `${pluginId} 作者` }],
      publishedAtMs: 1_700_000_000_000,
      source: { pluginId, mediaKind: 'audio', resourceId: id },
    },
    customTags: [],
    favoritedAtMs,
    addedAtMs: 100,
    updatedAtMs: 100,
  }
}
