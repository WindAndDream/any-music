import { AppError, createAppErrorState } from '@any-music/core'
import type { ResolvedMediaSource, Track } from '@any-music/core'
import { describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick, shallowReactive, shallowRef } from 'vue'

import { useAudioPlayer } from '#workbench/features/player/use-audio-player'
import type { AudioPlayerProps } from '#workbench/features/player/use-audio-player'
import type { SourceInvalidation } from '#workbench/runtime/workbench-runtime'

const track: Track = {
  id: 'same-song',
  title: '音乐',
  artists: [],
  source: { pluginId: 'source', mediaKind: 'audio', resourceId: '1' },
}
function setup(resolveMedia: AudioPlayerProps['resolveMedia']) {
  let invalidate!: (event: SourceInvalidation) => void
  const unsubscribe = vi.fn()
  const props = shallowReactive<AudioPlayerProps>({
    repeatOne: false,
    downloadBusy: false,
    resolveMedia,
    resolveTrack: () => track,
    canPrefetchMedia: () => true,
    renderCustomMedia: vi.fn(),
    loadMediaFile: vi.fn(),
    subscribeSourceInvalidation: (listener) => {
      invalidate = listener
      return unsubscribe
    },
  })
  const emit = vi.fn()
  const scope = effectScope()
  const player = scope.run(() => useAudioPlayer({ props, audio: shallowRef(null), emit }))!
  return {
    props,
    player,
    emit,
    scope,
    unsubscribe,
    invalidate: (event: SourceInvalidation) => invalidate(event),
  }
}
describe('player source invalidation', () => {
  it('retries the same failed descriptor once and does not restart a pending or ready load', async () => {
    const release = vi.fn()
    const source: ResolvedMediaSource = {
      type: 'remote-url',
      url: 'https://example.com/audio',
      backupUrls: [],
      quality: { id: 'default', label: '默认', rank: 1 },
      availableQualities: [{ id: 'default', label: '默认', rank: 1 }],
      loadingStrategy: 'range',
      release,
    }
    const resolveMedia = vi
      .fn<AudioPlayerProps['resolveMedia']>()
      .mockRejectedValueOnce(new AppError('media-unavailable', 'retryable'))
      .mockResolvedValue(source)
    const view = setup(resolveMedia)
    view.props.track = track
    await vi.waitFor(() => expect(view.player.status.value).toBe('error'))
    expect(view.player.errorState.value?.code).toBe('media-unavailable')
    const pending = view.player.retry()
    await view.player.retry()
    await pending
    expect(resolveMedia).toHaveBeenCalledTimes(2)
    expect(resolveMedia.mock.calls.map(([value]) => value.id)).toEqual([track.id, track.id])
    await view.player.retry()
    expect(resolveMedia).toHaveBeenCalledTimes(2)
    view.scope.stop()
    expect(release).toHaveBeenCalledOnce()
    expect(view.unsubscribe).toHaveBeenCalledOnce()
  })
  it('reports actual playback, pause, resume and clears the state during a track change', async () => {
    const source: ResolvedMediaSource = {
      type: 'remote-url',
      url: 'https://example.com/audio',
      backupUrls: [],
      quality: { id: 'default', label: '默认', rank: 1 },
      availableQualities: [{ id: 'default', label: '默认', rank: 1 }],
      loadingStrategy: 'range',
    }
    let finishNext!: (source: ResolvedMediaSource) => void
    const resolveMedia = vi
      .fn<AudioPlayerProps['resolveMedia']>()
      .mockResolvedValueOnce(source)
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishNext = resolve
          }),
      )
    const view = setup(resolveMedia)
    expect(view.emit).toHaveBeenLastCalledWith('playbackStateChange', undefined)
    view.props.track = track
    await vi.waitFor(() => expect(view.player.status.value).toBe('ready'))
    view.player.handleNativePlay()
    await nextTick()
    expect(view.emit).toHaveBeenLastCalledWith('playbackStateChange', {
      trackId: track.id,
      status: 'playing',
    })
    view.player.handleNativePause()
    await nextTick()
    expect(view.emit).toHaveBeenLastCalledWith('playbackStateChange', {
      trackId: track.id,
      status: 'paused',
    })
    view.player.handleNativePlay()
    await nextTick()
    expect(view.emit).toHaveBeenLastCalledWith('playbackStateChange', {
      trackId: track.id,
      status: 'playing',
    })
    expect(view.emit).not.toHaveBeenCalledWith('trackAvailable', track.id)
    view.player.handleNativePlaying()
    expect(view.emit).toHaveBeenCalledWith('trackAvailable', track.id)
    view.emit.mockClear()
    view.props.track = { ...track, id: 'next-song' }
    await nextTick()
    expect(view.emit).toHaveBeenCalledExactlyOnceWith('playbackStateChange', undefined)
    finishNext(source)
    await vi.waitFor(() => expect(view.player.status.value).toBe('ready'))
    view.props.track = undefined
    await nextTick()
    expect(view.emit).toHaveBeenLastCalledWith('playbackStateChange', undefined)
    view.scope.stop()
  })
  it('cancels source resolution when the current track is cleared', async () => {
    let cancelled = false
    const resolveMedia = vi.fn<AudioPlayerProps['resolveMedia']>(
      (_track, options) =>
        new Promise((_resolve, reject) => {
          options?.cancellation?.subscribe(() => {
            cancelled = true
            reject(new AppError('operation-cancelled'))
          })
        }),
    )
    const view = setup(resolveMedia)
    view.props.track = track
    await vi.waitFor(() => expect(resolveMedia).toHaveBeenCalledOnce())
    view.props.track = undefined
    await vi.waitFor(() => expect(view.player.status.value).toBe('idle'))
    expect(cancelled).toBe(true)
    expect(view.emit).not.toHaveBeenCalledWith('sourceInvalidated')
    view.scope.stop()
  })
  it('resets only the actual media account even when another account uses the same track ID', async () => {
    const release = vi.fn()
    const source: ResolvedMediaSource = {
      type: 'remote-url',
      accountId: 'playing',
      url: 'https://example.com/audio',
      backupUrls: [],
      quality: { id: 'default', label: '默认', rank: 1 },
      availableQualities: [{ id: 'default', label: '默认', rank: 1 }],
      loadingStrategy: 'range',
      release,
    }
    const view = setup(async () => source)
    view.props.track = track
    await vi.waitFor(() => expect(view.player.status.value).toBe('ready'))
    const error = createAppErrorState('operation-cancelled')
    view.invalidate({ pluginId: 'source', accountId: 'downloading', trackIds: [track.id], error })
    expect(view.player.status.value).toBe('ready')
    expect(view.emit).not.toHaveBeenCalledWith('sourceInvalidated')
    view.invalidate({ pluginId: 'source', accountId: 'playing', trackIds: [track.id], error })
    expect(view.player.status.value).toBe('idle')
    expect(release).toHaveBeenCalledOnce()
    expect(view.emit).toHaveBeenCalledWith('sourceInvalidated')
    view.scope.stop()
    expect(view.unsubscribe).toHaveBeenCalledOnce()
  })
  it('returns to idle when the account is removed during media resolution', async () => {
    const view = setup(async () => {
      throw new AppError('operation-cancelled', '账号已删除')
    })
    view.props.track = track
    await vi.waitFor(() => expect(view.emit).toHaveBeenCalledWith('sourceInvalidated'))
    expect(view.player.status.value).toBe('idle')
    view.scope.stop()
  })
})
