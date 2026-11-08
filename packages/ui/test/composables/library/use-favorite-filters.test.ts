import type { CustomTrackDefinition, LibraryTrackRecord } from '@any-music/core'
import { describe, expect, it } from 'vitest'
import { effectScope, shallowRef } from 'vue'

import {
  CUSTOM_TRACK_PLATFORM_ID,
  useFavoriteFilters,
} from '../../../src/composables/library/use-favorite-filters'

describe('useFavoriteFilters', () => {
  it('selects platforms independently and derives both drawer and mixed results', () => {
    const regularTime = new Date(2026, 0, 15, 12).getTime()
    const customTime = new Date(2026, 1, 20, 12).getTime()
    const records = shallowRef<readonly LibraryTrackRecord[]>([
      createRecord('bili', '哔哩歌曲', 'bilibili', 'audio', regularTime, 'bili-up'),
      createRecord('douyin', '抖音歌曲', 'douyin', 'audio', regularTime, 'douyin-user'),
      createRecord('custom', '跨站拼接', CUSTOM_TRACK_PLATFORM_ID, 'custom', customTime),
    ])
    const definitions = shallowRef<readonly CustomTrackDefinition[]>([
      createCustomDefinition(customTime),
    ])
    const scope = effectScope()
    const favoriteFilters = scope.run(() =>
      useFavoriteFilters(
        records,
        [
          { id: 'bilibili', name: '哔哩哔哩' },
          { id: 'douyin', name: '抖音' },
        ],
        definitions,
      ),
    )!

    expect(favoriteFilters.platformOptions.value.map((platform) => platform.id)).toEqual([
      'bilibili',
      'douyin',
      CUSTOM_TRACK_PLATFORM_ID,
    ])

    favoriteFilters.filters.value = {
      ...favoriteFilters.filters.value,
      selectedPlatformIds: ['bilibili', CUSTOM_TRACK_PLATFORM_ID],
      titleQuery: '歌',
    }
    expect(favoriteFilters.visibleRecords.value.map((record) => record.track.id)).toEqual(['bili'])
    expect(
      favoriteFilters.platformDrawers.value.map((drawer) => [
        drawer.platform.id,
        drawer.records.length,
      ]),
    ).toEqual([
      ['bilibili', 1],
      [CUSTOM_TRACK_PLATFORM_ID, 0],
    ])
    scope.stop()
  })

  it('filters a custom splice by source blogger id and original splice time', () => {
    const customTime = new Date(2026, 1, 20, 12).getTime()
    const records = shallowRef<readonly LibraryTrackRecord[]>([
      createRecord('custom', '跨站拼接', CUSTOM_TRACK_PLATFORM_ID, 'custom', customTime),
    ])
    const scope = effectScope()
    const favoriteFilters = scope.run(() =>
      useFavoriteFilters(records, [], [createCustomDefinition(customTime)]),
    )!

    favoriteFilters.filters.value = {
      ...favoriteFilters.filters.value,
      selectedPlatformIds: [CUSTOM_TRACK_PLATFORM_ID],
      artistQuery: 'douyin-88',
      customCreatedFrom: '2026-02-20',
      customCreatedTo: '2026-02-20',
    }

    expect(favoriteFilters.hasRegularSelection.value).toBe(false)
    expect(favoriteFilters.hasCustomSelection.value).toBe(true)
    expect(favoriteFilters.visibleRecords.value.map((record) => record.track.id)).toEqual([
      'custom',
    ])
    scope.stop()
  })
})

function createRecord(
  id: string,
  title: string,
  pluginId: string,
  mediaKind: 'audio' | 'custom',
  occurredAtMs: number,
  artistId?: string,
): LibraryTrackRecord {
  return {
    track: {
      id,
      title,
      artists: [{ id: artistId, name: mediaKind === 'custom' ? '测试用户' : '测试博主' }],
      publishedAtMs: occurredAtMs,
      source: { pluginId, mediaKind, resourceId: id },
    },
    customTags: [],
    favoritedAtMs: occurredAtMs,
    addedAtMs: occurredAtMs,
    updatedAtMs: occurredAtMs,
  }
}

function createCustomDefinition(createdAtMs: number): CustomTrackDefinition {
  return {
    trackId: 'custom',
    version: 1,
    materialCollectionId: 'material-collection:test',
    recipe: [{ sourceTrackId: 'leaf', startMs: 0, endMs: 1_000 }],
    compiledSegments: [
      {
        sourceTrackId: 'leaf',
        startMs: 0,
        endMs: 1_000,
        virtualStartMs: 0,
        virtualEndMs: 1_000,
      },
    ],
    creator: { id: 'local-user:test', displayName: '测试用户' },
    sourceCredits: [
      { pluginId: 'bilibili', artistId: 'bili-42', artistName: 'B站博主' },
      { pluginId: 'douyin', artistId: 'douyin-88', artistName: '抖音博主' },
    ],
    createdAtMs,
  }
}
