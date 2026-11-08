import type { CompiledSegmentRecipe, ResolvedMediaSource, Track } from '@any-music/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick, shallowReactive, shallowRef } from 'vue'

import { useAudioPlayer, type AudioPlayerProps } from '#workbench/features/player/use-audio-player'

const track: Track = {
  id: 'leaf',
  title: 'Leaf',
  artists: [],
  durationMs: 20000,
  source: { pluginId: 'test', resourceId: '1', mediaKind: 'audio' },
}
const source = (release = vi.fn()): ResolvedMediaSource => ({
  type: 'remote-url',
  url: 'https://example.com/audio',
  backupUrls: [],
  loadingStrategy: 'range',
  quality: { id: 'default', label: 'Default', rank: 1 },
  availableQualities: [{ id: 'default', label: 'Default', rank: 1 }],
  release,
})
const segments: CompiledSegmentRecipe[] = [
  { sourceTrackId: 'leaf', startMs: 2000, endMs: 7000, virtualStartMs: 0, virtualEndMs: 5000 },
  { sourceTrackId: 'leaf', startMs: 9000, endMs: 14000, virtualStartMs: 5000, virtualEndMs: 10000 },
]
function setup(resolveMedia: AudioPlayerProps['resolveMedia'] = async () => source()) {
  let blocked = false
  let interrupt!: () => void
  const unsubscribe = vi.fn()
  const element = {
    src: '',
    currentSrc: '',
    currentTime: 0,
    duration: 20,
    readyState: 1,
    paused: true,
    ended: false,
    buffered: { length: 0 },
    playbackRate: 1,
    volume: 1,
    preload: 'metadata',
    play: vi.fn(async () => {
      element.paused = false
    }),
    pause: vi.fn(() => {
      element.paused = true
    }),
    load: vi.fn(() => {
      element.currentTime = 0
    }),
    removeAttribute: vi.fn((name: string) => {
      if (name === 'src') element.src = ''
    }),
    setAttribute: vi.fn(),
  }
  vi.stubGlobal('document', { baseURI: 'https://example.com/' })
  vi.stubGlobal('window', { location: { origin: 'https://example.com' } })
  const props = shallowReactive<AudioPlayerProps>({
    repeatOne: false,
    downloadBusy: false,
    resolveMedia,
    resolveTrack: () => track,
    canPrefetchMedia: () => true,
    renderCustomMedia: vi.fn(),
    loadMediaFile: vi.fn(),
    playbackEnvironment: {
      preferMediaElement: true,
      isBlocked: () => blocked,
      subscribeInterruption: (listener) => {
        interrupt = listener
        return unsubscribe
      },
    },
  })
  const emit = vi.fn()
  const scope = effectScope()
  const player = scope.run(() =>
    useAudioPlayer({ props, audio: shallowRef(element as unknown as HTMLAudioElement), emit }),
  )!
  return {
    props,
    player,
    element,
    emit,
    scope,
    unsubscribe,
    interrupt: () => interrupt(),
    block: (value: boolean) => {
      blocked = value
    },
  }
}
afterEach(() => vi.unstubAllGlobals())
describe('runtime playback interruption', () => {
  it('restarts the first leaf on the first play after segmented completion', async () => {
    const view = setup()
    view.props.virtualSegments = segments
    view.props.track = {
      ...track,
      id: 'custom',
      source: { pluginId: 'local', mediaKind: 'custom', resourceId: 'custom' },
    }
    await vi.waitFor(() => expect(view.player.status.value).toBe('ready'))
    view.player.handleLoadedMetadata()
    view.player.handleNativePlay()
    view.element.currentTime = 7
    view.player.handleTimeUpdate()
    await vi.waitFor(() => expect(view.player.status.value).toBe('ready'))
    view.player.handleLoadedMetadata()
    expect(view.element.currentTime).toBe(9)
    view.player.handleNativePlay()
    view.element.currentTime = 14
    view.player.handleTimeUpdate()
    view.player.handleNativePause()
    expect(view.player.displayedPositionMs.value).toBe(10000)
    view.element.play.mockClear()
    view.player.toggleCustomPlayback()
    await vi.waitFor(() => expect(view.player.status.value).toBe('ready'))
    view.player.handleLoadedMetadata()
    expect(view.element.currentTime).toBe(2)
    expect(view.player.displayedPositionMs.value).toBe(0)
    expect(view.element.play).toHaveBeenCalledOnce()
    view.scope.stop()
  })
  it('restarts from zero when an already ended track was interrupted by backgrounding', async () => {
    const resolve = vi.fn(async () => source())
    const view = setup(resolve)
    view.props.track = track
    await vi.waitFor(() => expect(view.player.status.value).toBe('ready'))
    view.element.currentTime = 20
    view.player.handleTimeUpdate()
    view.interrupt()
    view.player.toggleCustomPlayback()
    await vi.waitFor(() => expect(resolve).toHaveBeenCalledTimes(2))
    await vi.waitFor(() => expect(view.player.status.value).toBe('ready'))
    view.player.handleLoadedMetadata()
    expect(view.element.currentTime).toBe(0)
    view.scope.stop()
  })
  it('replays a naturally ended ordinary track on the first explicit play', async () => {
    const view = setup()
    view.props.track = track
    await vi.waitFor(() => expect(view.player.status.value).toBe('ready'))
    view.player.handleLoadedMetadata()
    view.player.handleNativePlay()
    view.player.toggleCustomPlayback()
    view.player.handleNativePause()
    view.player.toggleCustomPlayback()
    view.player.handleNativePlay()
    view.element.paused = true
    view.element.ended = true
    view.player.handleNativePause()
    view.player.handleEnded()
    view.element.play.mockClear()
    view.player.toggleCustomPlayback()
    expect(view.element.play).toHaveBeenCalledOnce()
    view.scope.stop()
  })
  it('cancels an unresolved descriptor, releases its late grant and requires explicit resume', async () => {
    let finish!: (source: ResolvedMediaSource) => void
    let cancelled = false
    const release = vi.fn()
    const resolve = vi.fn<AudioPlayerProps['resolveMedia']>((_, options) => {
      options?.cancellation?.subscribe(() => {
        cancelled = true
      })
      return new Promise((done) => {
        finish = done
      })
    })
    const view = setup(resolve)
    view.props.track = track
    await nextTick()
    view.block(true)
    view.interrupt()
    expect(cancelled).toBe(true)
    finish(source(release))
    await nextTick()
    expect(release).toHaveBeenCalledOnce()
    expect(view.element.src).toBe('')
    expect(view.player.errorState.value).toBeUndefined()
    view.player.handleLoadedMetadata()
    view.player.handleEnded()
    view.player.handleMediaError()
    expect(view.element.play).not.toHaveBeenCalled()
    expect(view.emit).not.toHaveBeenCalledWith('ended')
    view.player.toggleCustomPlayback()
    expect(resolve).toHaveBeenCalledOnce()
    view.block(false)
    await nextTick()
    expect(resolve).toHaveBeenCalledOnce()
    resolve.mockResolvedValue(source())
    view.player.toggleCustomPlayback()
    await vi.waitFor(() => expect(resolve).toHaveBeenCalledTimes(2))
    await vi.waitFor(() => expect(view.player.status.value).toBe('ready'))
    view.scope.stop()
    expect(view.unsubscribe).toHaveBeenCalledOnce()
  })
  it('retains the logical position, ignores old media events and resolves fresh media on resume', async () => {
    const release = vi.fn()
    const resolve = vi.fn(async () => source(release))
    const view = setup(resolve)
    view.props.track = track
    await vi.waitFor(() => expect(view.player.status.value).toBe('ready'))
    view.player.handleLoadedMetadata()
    view.element.currentTime = 6
    view.player.handleTimeUpdate()
    view.interrupt()
    expect(release).toHaveBeenCalledOnce()
    expect(view.player.displayedPositionMs.value).toBe(6000)
    view.element.currentTime = 0
    view.player.handleTimeUpdate()
    view.player.handleEnded()
    expect(view.player.displayedPositionMs.value).toBe(6000)
    view.player.handlePrecisionSeek(8000)
    view.player.toggleCustomPlayback()
    await vi.waitFor(() => expect(resolve).toHaveBeenCalledTimes(2))
    await vi.waitFor(() => expect(view.player.status.value).toBe('ready'))
    view.player.handleLoadedMetadata()
    expect(view.element.currentTime).toBe(8)
    view.scope.stop()
  })
  it('uses bounded leaf descriptors without constructing Web Audio and stops after focus pause', async () => {
    const construct = vi.fn(() => {
      throw Error('Web Audio must not be used')
    })
    vi.stubGlobal('AudioContext', construct)
    const resolve = vi.fn(async () => source())
    const view = setup(resolve)
    view.props.virtualSegments = segments
    view.props.track = {
      ...track,
      id: 'custom',
      source: { pluginId: 'local', mediaKind: 'custom', resourceId: 'custom' },
    }
    await vi.waitFor(() => expect(view.player.status.value).toBe('ready'))
    view.player.handleLoadedMetadata()
    view.player.handleNativePlay()
    expect(view.player.displayedIsPlaying.value).toBe(true)
    expect(view.element.currentTime).toBe(2)
    expect(construct).not.toHaveBeenCalled()
    expect(resolve).toHaveBeenCalledOnce()
    view.element.paused = true
    view.player.handleNativePause()
    expect(view.player.displayedIsPlaying.value).toBe(false)
    view.element.currentTime = 7
    view.player.handleTimeUpdate()
    await nextTick()
    expect(resolve).toHaveBeenCalledOnce()
    view.player.handleNativePlay()
    view.element.currentTime = 4
    view.player.handleTimeUpdate()
    view.interrupt()
    expect(view.player.displayedPositionMs.value).toBe(2000)
    view.player.toggleCustomPlayback()
    await vi.waitFor(() => expect(resolve).toHaveBeenCalledTimes(2))
    await vi.waitFor(() => expect(view.player.status.value).toBe('ready'))
    view.player.handleLoadedMetadata()
    expect(view.element.currentTime).toBe(4)
    view.scope.stop()
  })
  it('does no media work when a track is selected while the runtime is blocked', async () => {
    const resolve = vi.fn(async () => source())
    const view = setup(resolve)
    view.block(true)
    view.props.track = track
    await nextTick()
    expect(resolve).not.toHaveBeenCalled()
    expect(view.player.displayedIsPlaying.value).toBe(false)
    view.scope.stop()
  })
})
