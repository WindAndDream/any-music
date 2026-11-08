import type { LibraryTrackRecord, MaterialCollection, Track } from '@any-music/core'
import { describe, expect, it } from 'vitest'

import { useMaterialLibraryFilters } from '../../src/vue/use-material-library-filters'

const records = [
  createRecord('bilibili', '山海', '普通作者', ['氛围'], 'audio', 20_000, 2),
  createRecord('local-custom', '夜行混剪', '本地用户', ['夜晚'], 'custom', 10_000, 3),
  createRecord('douyin', '星光', '短视频作者', [], 'video', 30_000, 1),
]
const collection: MaterialCollection = {
  id: 'material-collection:test',
  name: '夜行素材',
  trackIds: [records[0]!.track.id, records[1]!.track.id],
  createdAtMs: 1,
  updatedAtMs: 1,
}

describe('useMaterialLibraryFilters', () => {
  it('filters collection membership and keeps custom tracks available as materials', () => {
    const result = useMaterialLibraryFilters(
      () => records,
      () => collection,
      () => [],
    )
    result.filters.value = {
      ...result.filters.value,
      membership: 'included',
      trackKind: 'custom',
    }

    expect(result.visibleRecords.value.map((record) => record.track.title)).toEqual(['夜行混剪'])
  })

  it('searches normalized title, artist and tag text', () => {
    const result = useMaterialLibraryFilters(
      () => records,
      () => collection,
      () => [],
    )
    result.filters.value = { ...result.filters.value, query: '氛围' }
    expect(result.visibleRecords.value.map((record) => record.track.title)).toEqual(['山海'])
  })

  it('shows every current collection record after a programmatic add or collection switch', () => {
    const result = useMaterialLibraryFilters(
      () => records,
      () => collection,
      () => [],
    )
    result.filters.value = {
      ...result.filters.value,
      query: '夜行混剪',
      membership: 'available',
    }

    result.showCurrentCollectionRecords()

    expect(result.filters.value.query).toBe('')
    expect(result.filters.value.membership).toBe('included')
    expect(result.visibleRecords.value.map((record) => record.track.title)).toEqual([
      '夜行混剪',
      '山海',
    ])
  })
})

function createRecord(
  pluginId: string,
  title: string,
  artistName: string,
  customTags: readonly string[],
  mediaKind: Track['source']['mediaKind'],
  durationMs: number,
  updatedAtMs: number,
): LibraryTrackRecord {
  return {
    track: {
      id: `${pluginId}:${title}`,
      title,
      artists: [{ name: artistName }],
      durationMs,
      source: { pluginId, mediaKind, resourceId: title },
    },
    customTags,
    addedAtMs: 1,
    updatedAtMs,
  }
}
