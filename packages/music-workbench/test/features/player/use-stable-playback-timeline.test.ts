import { describe, expect, it } from 'vitest'
import { shallowRef } from 'vue'

import { useStablePlaybackTimeline } from '#workbench/features/player/use-stable-playback-timeline'

describe('useStablePlaybackTimeline', () => {
  it.each([
    ['fast-forward', 30_000, 120_000],
    ['rewind', 120_000, 30_000],
  ])(
    'keeps the requested position and known duration during a %s media-source rebuild',
    (_direction, initialPositionMs, targetPositionMs) => {
      const positionMs = shallowRef(initialPositionMs)
      const durationMs = shallowRef<number | undefined>(180_000)
      const pendingPositionMs = shallowRef<number | undefined>()
      const resolvedDurationMs = shallowRef<number | undefined>(180_000)
      const timeline = useStablePlaybackTimeline({
        positionMs,
        durationMs,
        pendingPositionMs,
        resolvedDurationMs,
      })

      pendingPositionMs.value = targetPositionMs
      positionMs.value = 0
      durationMs.value = undefined

      expect(timeline.displayedPositionMs.value).toBe(targetPositionMs)
      expect(timeline.displayedDurationMs.value).toBe(180_000)

      positionMs.value = targetPositionMs
      durationMs.value = 180_000
      pendingPositionMs.value = undefined

      expect(timeline.displayedPositionMs.value).toBe(targetPositionMs)
      expect(timeline.displayedDurationMs.value).toBe(180_000)
    },
  )

  it('follows the native clock when no seek is pending', () => {
    const positionMs = shallowRef(45_000)
    const durationMs = shallowRef<number | undefined>(180_000)
    const pendingPositionMs = shallowRef<number | undefined>()
    const resolvedDurationMs = shallowRef<number | undefined>(180_000)
    const timeline = useStablePlaybackTimeline({
      positionMs,
      durationMs,
      pendingPositionMs,
      resolvedDurationMs,
    })

    positionMs.value = 46_000

    expect(timeline.displayedPositionMs.value).toBe(46_000)
    expect(timeline.displayedDurationMs.value).toBe(180_000)
  })
})
