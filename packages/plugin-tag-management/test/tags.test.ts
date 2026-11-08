import type { LibraryTrackRecord } from '@any-music/core'
import { describe, expect, it } from 'vitest'

import { addCustomTag, normalizeCustomTag, searchLibraryRecords } from '../src/tags'

const record: LibraryTrackRecord = {
  track: {
    id: 'track-1',
    title: '夜空中最亮的星',
    artists: [{ name: '逃跑计划' }],
    sourceTags: ['摇滚'],
    source: { pluginId: 'test', mediaKind: 'audio', resourceId: '1' },
  },
  customTags: ['通勤'],
  addedAtMs: 0,
  updatedAtMs: 0,
}

describe('custom tags', () => {
  it('normalizes Unicode and deduplicates tags without losing display spelling', () => {
    expect(normalizeCustomTag('  夜间   推荐  ')).toBe('夜间 推荐')
    expect(addCustomTag(['Rock'], 'ｒｏｃｋ')).toEqual(['Rock'])
  })

  it('searches title, artist, source tags, and requires every selected custom tag', () => {
    expect(searchLibraryRecords([record], { query: '逃跑' })).toEqual([record])
    expect(searchLibraryRecords([record], { query: '摇滚', requiredTags: ['通勤'] })).toEqual([
      record,
    ])
    expect(searchLibraryRecords([record], { requiredTags: ['通勤', '收藏'] })).toEqual([])
  })
})
