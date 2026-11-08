import { describe, expect, it } from 'vitest'

import {
  reorderQueueIds,
  sanitizePlaybackQueueSnapshot,
} from '#workbench/features/player/playback-queue-state'

describe('sanitizePlaybackQueueSnapshot', () => {
  it('restores only valid queue addition dates and ignores orphan or damaged metadata', () => {
    const snapshot = sanitizePlaybackQueueSnapshot({
      schemaVersion: 1,
      trackIds: ['one', 'two', 'three', 'four'],
      addedAtMsByTrackId: { one: 100, two: '200', three: -1, four: 9e15, missing: 300 },
    })
    expect(snapshot.addedAtMsByTrackId).toEqual({ one: 100 })
  })
  it('deduplicates stable track ids and keeps a valid playback mode', () => {
    expect(
      sanitizePlaybackQueueSnapshot({
        schemaVersion: 1,
        trackIds: ['track:1', 'track:1', '', 42, 'track:2'],
        mode: 'shuffle-no-repeat',
      }),
    ).toEqual({
      schemaVersion: 1,
      trackIds: ['track:1', 'track:2'],
      mode: 'shuffle-no-repeat',
      arrangementMode: 'flat',
    })
  })

  it('falls back safely for a damaged snapshot', () => {
    expect(sanitizePlaybackQueueSnapshot({ schemaVersion: 999 })).toEqual({
      schemaVersion: 1,
      trackIds: [],
      mode: 'sequence',
      arrangementMode: 'flat',
    })
  })

  it('restores platform arrangement and discards unknown view values', () => {
    expect(
      sanitizePlaybackQueueSnapshot({
        schemaVersion: 1,
        trackIds: [],
        mode: 'sequence',
        arrangementMode: 'platform',
      }).arrangementMode,
    ).toBe('platform')
    expect(
      sanitizePlaybackQueueSnapshot({
        schemaVersion: 1,
        trackIds: [],
        mode: 'sequence',
        arrangementMode: 'unknown',
      }).arrangementMode,
    ).toBe('flat')
  })
})

describe('filtered queue ordering', () => {
  const ids = ['one', 'hidden-a', 'two', 'hidden-b', 'three']
  it('moves matching tracks in both directions while preserving hidden positions', () => {
    expect(reorderQueueIds(ids, 'one', 'three', ['one', 'two', 'three'])).toEqual([
      'two',
      'hidden-a',
      'three',
      'hidden-b',
      'one',
    ])
    expect(reorderQueueIds(ids, 'three', 'one', ['one', 'two', 'three'])).toEqual([
      'three',
      'hidden-a',
      'one',
      'hidden-b',
      'two',
    ])
  })
  it('uses the current queue order when a caller passes a stale or duplicated projection', () => {
    expect(reorderQueueIds(ids, 'one', 'two', ['three', 'two', 'one', 'two', 'missing'])).toEqual([
      'two',
      'hidden-a',
      'one',
      'hidden-b',
      'three',
    ])
    expect(reorderQueueIds(ids, 'one', 'hidden-a', ['one', 'two'])).toBe(ids)
    expect(reorderQueueIds(ids, 'missing', 'two')).toBe(ids)
    expect(reorderQueueIds(ids, 'one', 'one')).toBe(ids)
  })
})
