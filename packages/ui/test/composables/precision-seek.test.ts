import { describe, expect, it } from 'vitest'

import {
  calculatePointerPositionMs,
  clampPlaybackPositionMs,
  formatPrecisePlaybackTime,
  seekNativeMedia,
} from '../../src/composables/precision-seek'

describe('precision seek helpers', () => {
  it('maps and clamps the pointer position to the complete timeline', () => {
    expect(calculatePointerPositionMs(150, 100, 200, 120_000)).toBe(30_000)
    expect(calculatePointerPositionMs(50, 100, 200, 120_000)).toBe(0)
    expect(calculatePointerPositionMs(350, 100, 200, 120_000)).toBe(120_000)
  })

  it('clamps seek values and formats tenth-second hover labels', () => {
    expect(clampPlaybackPositionMs(130_000, 120_000)).toBe(120_000)
    expect(clampPlaybackPositionMs(-500, 120_000)).toBe(0)
    expect(formatPrecisePlaybackTime(133_450)).toBe('2:13.4')
    expect(formatPrecisePlaybackTime(3_723_450)).toBe('1:02:03.4')
  })

  it('writes a clamped seek position to the real native media clock', () => {
    const media = { currentTime: 12, duration: 120 }

    expect(seekNativeMedia(media, 45_670)).toBe(45_670)
    expect(media.currentTime).toBe(45.67)
    expect(seekNativeMedia(media, 150_000)).toBe(120_000)
    expect(media.currentTime).toBe(120)
  })
})
