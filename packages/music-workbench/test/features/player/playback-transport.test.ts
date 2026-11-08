import type { RemoteResolvedMediaSource } from '@any-music/core'
import { describe, expect, it } from 'vitest'

import {
  requiresManagedPlayback,
  selectNativeMediaReferrerPolicy,
  selectPlaybackResumePositionMs,
  shouldAutoplayAfterManagedSeek,
  shouldAutoplayNativeFallback,
  shouldRestartManagedPlaybackForSeek,
} from '#workbench/features/player/playback-transport'

const source: RemoteResolvedMediaSource = {
  type: 'remote-url',
  url: 'https://media.example/video.mp4',
  backupUrls: [],
  quality: { id: 'default', label: '默认', rank: 1 },
  availableQualities: [{ id: 'default', label: '默认', rank: 1 }],
  durationMs: 30_000,
  loadingStrategy: 'range',
}

describe('playback transport policy', () => {
  it('keeps native streaming for Referer-only media because the player suppresses the host referrer', () => {
    const protectedSource = {
      ...source,
      requestHeaders: { Referer: 'https://www.douyin.com/' },
    }

    expect(requiresManagedPlayback(protectedSource)).toBe(false)
    expect(requiresManagedPlayback(source)).toBe(false)
    expect(selectNativeMediaReferrerPolicy(protectedSource, 'https://www.bilibili.com')).toBe(
      'no-referrer',
    )
    expect(
      selectNativeMediaReferrerPolicy(protectedSource, 'https://www.douyin.com'),
    ).toBeUndefined()
  })

  it('uses managed playback for non-Referer request headers', () => {
    expect(
      requiresManagedPlayback({
        ...source,
        requestHeaders: { Authorization: 'ephemeral' },
      }),
    ).toBe(true)
  })

  it('restarts managed playback only when a seek target is outside the retained MSE window', () => {
    const buffered = createBufferedRanges([
      [45, 60],
      [90, 110],
    ])

    expect(shouldRestartManagedPlaybackForSeek(true, buffered, 50)).toBe(false)
    expect(shouldRestartManagedPlaybackForSeek(true, buffered, 10)).toBe(true)
    expect(shouldRestartManagedPlaybackForSeek(true, buffered, 75)).toBe(true)
    expect(shouldRestartManagedPlaybackForSeek(true, buffered, 115)).toBe(true)
    expect(shouldRestartManagedPlaybackForSeek(false, buffered, 10)).toBe(false)
  })

  it('preserves paused and playing intent while a managed seek rebuilds the media source', () => {
    expect(shouldAutoplayAfterManagedSeek(false, true)).toBe(false)
    expect(shouldAutoplayAfterManagedSeek(false, false)).toBe(true)
    expect(shouldAutoplayAfterManagedSeek(true, true)).toBe(true)
  })

  it('does not restart a paused track merely because the current URL needs a fallback', () => {
    expect(shouldAutoplayNativeFallback(false, true)).toBe(false)
    expect(shouldAutoplayNativeFallback(false, false)).toBe(true)
    expect(shouldAutoplayNativeFallback(true, true)).toBe(true)
  })

  it('keeps the custom leaf target when a failed URL resets native currentTime to zero', () => {
    expect(
      selectPlaybackResumePositionMs({
        customSourcePositionMs: 22_000,
        pendingNativePositionMs: 22_000,
        nativePositionMs: 0,
      }),
    ).toBe(22_000)
  })

  it('uses the current native position after every pending seek target has settled', () => {
    expect(
      selectPlaybackResumePositionMs({
        customSourcePositionMs: undefined,
        pendingNativePositionMs: undefined,
        nativePositionMs: 34_500,
      }),
    ).toBe(34_500)
  })
})

function createBufferedRanges(ranges: readonly (readonly [number, number])[]) {
  return {
    length: ranges.length,
    start: (index: number) => ranges[index]![0],
    end: (index: number) => ranges[index]![1],
  }
}
