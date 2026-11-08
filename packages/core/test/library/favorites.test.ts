import { describe, expect, it } from 'vitest'

import { filterFavoriteRecords } from '../../src/library/favorites'
import type { LibraryTrackRecord } from '../../src/library/models'

const records: readonly LibraryTrackRecord[] = [
  createRecord({
    id: 'bilibili:audio:1',
    title: '清晨电台',
    artist: '山海 UP',
    pluginId: 'bilibili',
    publishedAtMs: 1_700_000_000_000,
    customTags: ['通勤', '轻音乐'],
    favoritedAtMs: 30,
  }),
  createRecord({
    id: 'douyin:video:2',
    title: '夜晚现场',
    artist: '星光博主',
    pluginId: 'douyin',
    publishedAtMs: 1_710_000_000_000,
    customTags: ['现场'],
    favoritedAtMs: 20,
  }),
  createRecord({
    id: 'local:custom:3',
    title: '晨昏拼接版',
    artist: '自定义歌曲',
    pluginId: 'local-custom',
    mediaKind: 'custom',
    addedAtMs: 1_720_000_000_000,
    favoritedAtMs: 40,
  }),
  createRecord({
    id: 'bilibili:audio:4',
    title: '未喜欢歌曲',
    artist: '山海 UP',
    pluginId: 'bilibili',
    publishedAtMs: 1_700_000_000_000,
  }),
]

describe('filterFavoriteRecords', () => {
  it('finds a renamed favorite by either name without replacing its original title', () => {
    const renamed = { ...records[0]!, customName: '通勤精选' }
    for (const titleQuery of ['通勤精选', '清晨电台']) {
      expect(filterFavoriteRecords([renamed], { kind: 'regular', titleQuery })).toEqual([renamed])
    }
    expect(renamed.track.title).toBe('清晨电台')
  })
  it('combines platform, title, artist, publication time and tag filters for regular tracks', () => {
    expect(
      filterFavoriteRecords(records, {
        kind: 'regular',
        pluginId: 'bilibili',
        titleQuery: '清晨',
        artistQuery: '山海',
        requiredTags: ['通勤'],
        occurredFromMs: 1_699_000_000_000,
        occurredBeforeMs: 1_701_000_000_000,
      }).map((record) => record.track.id),
    ).toEqual(['bilibili:audio:1'])
  })

  it('uses the record creation time for custom splice tracks', () => {
    expect(
      filterFavoriteRecords(records, {
        kind: 'custom',
        titleQuery: '拼接',
        occurredFromMs: 1_719_000_000_000,
        occurredBeforeMs: 1_721_000_000_000,
      }).map((record) => record.track.id),
    ).toEqual(['local:custom:3'])
  })

  it('matches a regular blogger by stable user id', () => {
    expect(
      filterFavoriteRecords(
        [
          {
            ...records[0]!,
            track: { ...records[0]!.track, artists: [{ id: 'up-42', name: '山海 UP' }] },
          },
        ],
        { kind: 'regular', artistQuery: 'up-42' },
      ).map((record) => record.track.id),
    ).toEqual(['bilibili:audio:1'])
  })

  it('excludes non-favorite records and keeps newest favorites first', () => {
    expect(
      filterFavoriteRecords(records, { kind: 'regular' }).map((record) => record.track.id),
    ).toEqual(['bilibili:audio:1', 'douyin:video:2'])
  })
})

function createRecord(options: {
  id: string
  title: string
  artist: string
  pluginId: string
  mediaKind?: 'audio' | 'custom'
  publishedAtMs?: number
  customTags?: readonly string[]
  favoritedAtMs?: number
  addedAtMs?: number
}): LibraryTrackRecord {
  return {
    track: {
      id: options.id,
      title: options.title,
      artists: [{ name: options.artist }],
      publishedAtMs: options.publishedAtMs,
      source: {
        pluginId: options.pluginId,
        mediaKind: options.mediaKind ?? 'audio',
        resourceId: options.id,
      },
    },
    customTags: options.customTags ?? [],
    favoritedAtMs: options.favoritedAtMs,
    addedAtMs: options.addedAtMs ?? 10,
    updatedAtMs: 10,
  }
}
