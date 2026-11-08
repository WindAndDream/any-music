import type { ResolvedMediaSource, Track } from '@any-music/core'
import { PlayerBar } from '@any-music/theme-default/vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createRenderer, defineComponent, h, nextTick, shallowReactive, shallowRef } from 'vue'

import { createPlayerPresentationState } from '../../../src/features/player/player-presentation'
import { useAudioPlayer } from '../../../src/features/player/use-audio-player'
import type {
  AudioPlayerController,
  AudioPlayerProps,
} from '../../../src/features/player/use-audio-player'

/** Minimal event host: real SFC/controller interaction, without a browser or product launch. */
class TestNode {
  props: Record<string, unknown> = {}
  children: TestNode[] = []
  parent: TestNode | null = null
  text = ''
  value = ''
  style = {}
  readonly tag: string
  constructor(tag: string) {
    this.tag = tag
  }
}
function remove(node: TestNode) {
  if (node.parent) node.parent.children = node.parent.children.filter((child) => child !== node)
  node.parent = null
}
const renderer = createRenderer<TestNode, TestNode>({
  createElement: (tag) => new TestNode(tag),
  createText: (text) => Object.assign(new TestNode('#text'), { text }),
  createComment: () => new TestNode('#comment'),
  setText: (node, text) => {
    node.text = text
  },
  setElementText: (node, text) => {
    node.text = text
    node.children = []
  },
  parentNode: (node) => node.parent,
  nextSibling: (node) => node.parent?.children[node.parent.children.indexOf(node) + 1] ?? null,
  patchProp: (node, key, _previous, value) => {
    node.props[key] = value
    if (key === 'value') node.value = String(value)
  },
  insert: (node, parent, anchor) => {
    remove(node)
    node.parent = parent
    const index = anchor ? parent.children.indexOf(anchor) : -1
    if (index < 0) parent.children.push(node)
    else parent.children.splice(index, 0, node)
  },
  remove,
  setScopeId() {},
})
function find(node: TestNode, label: string): TestNode {
  if (node.props['aria-label'] === label) return node
  for (const child of node.children) {
    try {
      return find(child, label)
    } catch {
      /* continue */
    }
  }
  throw new Error(`Control missing: ${label}`)
}
function event(node: TestNode, name: string): void {
  ;(node.props[name] as (event: { target: TestNode }) => void)({ target: node })
}
afterEach(() => vi.unstubAllGlobals())

describe('classic player with a stable controller', () => {
  it('keeps one in-flight resolution, audio host and subscription across presentation remounts', async () => {
    vi.stubGlobal('window', {
      location: { origin: 'https://example.com' },
      matchMedia: () => ({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })
    vi.stubGlobal('HTMLInputElement', TestNode)
    const constructAudio = vi.fn()
    vi.stubGlobal('Audio', constructAudio)
    const unsubscribe = vi.fn(),
      subscribe = vi.fn(() => unsubscribe)
    const release = vi.fn(),
      next = vi.fn(),
      previous = vi.fn()
    let finish!: (source: ResolvedMediaSource) => void
    const resolveMedia = vi.fn<AudioPlayerProps['resolveMedia']>(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    const track: Track = {
      id: 'song',
      title: '测试歌曲',
      artists: [],
      durationMs: 20000,
      source: { pluginId: 'source', resourceId: '1', mediaKind: 'audio' },
    }
    const props = shallowReactive<AudioPlayerProps>({
      repeatOne: false,
      downloadBusy: false,
      resolveTrack: () => track,
      resolveMedia,
      canPrefetchMedia: () => false,
      renderCustomMedia: vi.fn(),
      loadMediaFile: vi.fn(),
      subscribeSourceInvalidation: subscribe,
    })
    let player!: AudioPlayerController
    const media = {
      src: '',
      currentSrc: '',
      duration: 20,
      currentTime: 0,
      readyState: 1,
      paused: true,
      buffered: { length: 0, start: () => 0, end: () => 0 },
      load: vi.fn(),
      removeAttribute: vi.fn(),
      setAttribute: vi.fn(),
      play: vi.fn(async () => {
        media.paused = false
        player.handleNativePlay()
      }),
      pause: vi.fn(() => {
        media.paused = true
        player?.handleNativePause()
      }),
    }
    const visible = shallowRef(true)
    const root = new TestNode('root')
    const app = renderer.createApp(
      defineComponent({
        setup() {
          player = useAudioPlayer({
            props,
            audio: shallowRef(media as unknown as HTMLAudioElement),
            emit: vi.fn(),
          })
          const state = createPlayerPresentationState(player)
          return () =>
            visible.value
              ? h(PlayerBar, {
                  state: state.value,
                  track: props.track,
                  mode: 'sequence',
                  downloadBusy: false,
                  onPlay: player.toggleCustomPlayback,
                  onPause: player.toggleCustomPlayback,
                  onSeek: player.handlePrecisionSeek,
                  onSetVolume: player.setVolume,
                  onNext: next,
                  onPrevious: previous,
                })
              : null
        },
      }),
    )
    app.mount(root)
    try {
      props.track = track
      await nextTick()
      expect(resolveMedia).toHaveBeenCalledOnce()
      expect(find(root, '播放').props.disabled).toBe(true)
      visible.value = false
      await nextTick()
      expect(unsubscribe).not.toHaveBeenCalled()
      visible.value = true
      await nextTick()
      expect(resolveMedia).toHaveBeenCalledOnce()
      const quality = { id: 'default', label: '默认', rank: 1 }
      finish({
        type: 'remote-url',
        url: 'https://example.com/audio',
        backupUrls: [],
        quality,
        availableQualities: [quality],
        loadingStrategy: 'range',
        release,
      })
      await vi.waitFor(() => expect(player.status.value).toBe('ready'))
      player.handleLoadedMetadata()
      await nextTick()
      expect(media.play).toHaveBeenCalledOnce()
      event(find(root, '暂停'), 'onClick')
      await nextTick()
      expect(media.paused).toBe(true)
      const loads = media.load.mock.calls.length
      event(find(root, '播放'), 'onClick')
      await nextTick()
      expect(media.play).toHaveBeenCalledTimes(2)
      expect(find(root, '暂停')).toBeDefined()
      const seek = find(root, '精确播放进度')
      seek.value = '8000'
      event(seek, 'onChange')
      await nextTick()
      expect(media.currentTime).toBe(8)
      event(find(root, '下一首'), 'onClick')
      event(find(root, '上一首'), 'onClick')
      expect(next).toHaveBeenCalledOnce()
      expect(previous).toHaveBeenCalledOnce()
      visible.value = false
      await nextTick()
      visible.value = true
      await nextTick()
      expect(find(root, '暂停')).toBeDefined()
      expect(media.currentTime).toBe(8)
      expect(resolveMedia).toHaveBeenCalledOnce()
      expect(media.load).toHaveBeenCalledTimes(loads)
      expect(subscribe).toHaveBeenCalledOnce()
      expect(constructAudio).not.toHaveBeenCalled()
      expect(release).not.toHaveBeenCalled()
      event(find(root, '暂停'), 'onClick')
      await nextTick()
      expect(media.paused).toBe(true)
    } finally {
      app.unmount()
    }
    expect(unsubscribe).toHaveBeenCalledOnce()
    expect(release).toHaveBeenCalledOnce()
  })
})
