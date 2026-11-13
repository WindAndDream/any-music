import { describe, expect, it } from 'vitest'

import { getPlaybackHistoryStartedAfterMs } from '../../../src/composables/library/playback-history-filters'

describe('playback history time filters', () => {
  const nowMs = new Date(2026, 8, 13, 15, 30).getTime()

  it('uses the local start of day for the today range', () => {
    expect(getPlaybackHistoryStartedAfterMs('today', nowMs)).toBe(new Date(2026, 8, 13).getTime())
  })

  it('uses rolling day windows for longer ranges', () => {
    expect(getPlaybackHistoryStartedAfterMs('week', nowMs)).toBe(nowMs - 7 * 24 * 60 * 60 * 1000)
    expect(getPlaybackHistoryStartedAfterMs('month', nowMs)).toBe(nowMs - 30 * 24 * 60 * 60 * 1000)
  })

  it('does not constrain the all range', () => {
    expect(getPlaybackHistoryStartedAfterMs('all', nowMs)).toBeUndefined()
  })
})
