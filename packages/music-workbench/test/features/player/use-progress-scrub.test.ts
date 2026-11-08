import { describe, expect, it } from 'vitest'
import { shallowRef } from 'vue'

import { useProgressScrub } from '#workbench/features/player/use-progress-scrub'

describe('useProgressScrub', () => {
  it('keeps the dragged position stable until seek finishes', async () => {
    const playbackPositionMs = shallowRef(1_000)
    let finishSeek: (() => void) | undefined
    const seekFinished = new Promise<void>((resolve) => {
      finishSeek = resolve
    })
    const scrub = useProgressScrub({
      playbackPositionMs,
      seek: async (positionMs) => {
        await seekFinished
        playbackPositionMs.value = positionMs
      },
    })

    scrub.preview(8_000)
    playbackPositionMs.value = 1_100

    expect(scrub.displayedPositionMs.value).toBe(8_000)

    const pendingSeek = scrub.commit(8_000)
    playbackPositionMs.value = 1_200

    expect(scrub.displayedPositionMs.value).toBe(8_000)

    finishSeek?.()
    await pendingSeek
    playbackPositionMs.value = 8_100

    expect(scrub.displayedPositionMs.value).toBe(8_100)
  })

  it('does not let an older seek clear a newer drag preview', async () => {
    const playbackPositionMs = shallowRef(1_000)
    let finishSeek: (() => void) | undefined
    const seekFinished = new Promise<void>((resolve) => {
      finishSeek = resolve
    })
    const scrub = useProgressScrub({
      playbackPositionMs,
      seek: () => seekFinished,
    })

    scrub.preview(4_000)
    const pendingSeek = scrub.commit(4_000)
    scrub.preview(9_000)
    finishSeek?.()
    await pendingSeek

    expect(scrub.displayedPositionMs.value).toBe(9_000)
  })
})
