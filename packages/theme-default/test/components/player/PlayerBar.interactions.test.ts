import type { UiPlayerProps } from '@any-music/ui/theme'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick, shallowReactive } from 'vue'

import PlayerBar from '../../../src/components/player/PlayerBar.vue'
import {
  CatalogTestElement,
  dispatchCatalogEvent,
  findCatalogElement,
  mountCatalogComponent,
} from '../../helpers/test-renderer'

vi.mock('@any-music/ui/components/AppDialog.vue', () => ({
  default: defineComponent({
    props: ['open', 'title'],
    setup:
      (props, { slots }) =>
      () =>
        props.open ? h('section', { 'aria-label': props.title }, slots.default?.()) : null,
  }),
}))
beforeEach(() => {
  vi.stubGlobal('window', {
    matchMedia: () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })
  vi.stubGlobal('HTMLInputElement', CatalogTestElement)
})
afterEach(() => vi.unstubAllGlobals())

function mountPlayer() {
  const overlays = new CatalogTestElement('overlays')
  const props = shallowReactive<UiPlayerProps>({
    track: {
      id: 'song',
      title: '测试歌曲',
      artists: [],
      source: { pluginId: 'source', mediaKind: 'audio', resourceId: '1' },
    },
    mode: 'sequence',
    downloadBusy: false,
    mobileOverlayTarget: overlays as unknown as HTMLElement,
    state: {
      positionMs: 1000,
      durationMs: 20000,
      bufferedUntilMs: 6000,
      playing: false,
      seekDisabled: false,
      playbackRate: 1,
      volume: 0.5,
      qualityOptions: [{ id: 'high', label: '高音质', rank: 1 }],
      selectedQualityId: 'high',
      status: 'ready',
      statusLabel: '准备就绪',
    },
  })
  const events = {
    onPlay: vi.fn(),
    onPause: vi.fn(),
    onPrevious: vi.fn(),
    onNext: vi.fn(),
    onDownload: vi.fn(),
    onSeek: vi.fn(),
    onSetVolume: vi.fn(),
    onSetPlaybackRate: vi.fn(),
    onUpdateMode: vi.fn(),
    onSelectQuality: vi.fn(),
    onSettingsOpenChange: vi.fn(),
  }
  const view = mountCatalogComponent(
    defineComponent({ setup: () => () => h(PlayerBar, { ...props, ...events }) }),
    {},
  )
  const button = (label: string) =>
    findCatalogElement(
      view.root,
      (node) => node.tag === 'button' && node.props['aria-label'] === label,
    )
  return { ...view, props, events, overlays, button }
}

describe('controlled classic player', () => {
  it('forwards transport, queue, download and precise seek without mutating its projection', async () => {
    const view = mountPlayer()
    dispatchCatalogEvent(view.button('播放'), 'onClick')
    expect(view.events.onPlay).toHaveBeenCalledOnce()
    expect(view.props.state.playing).toBe(false)
    view.props.state = { ...view.props.state, playing: true }
    await nextTick()
    dispatchCatalogEvent(view.button('暂停'), 'onClick')
    dispatchCatalogEvent(view.button('上一首'), 'onClick')
    dispatchCatalogEvent(view.button('下一首'), 'onClick')
    dispatchCatalogEvent(view.button('下载当前音乐'), 'onClick')
    expect(view.events.onPause).toHaveBeenCalledOnce()
    expect(view.events.onPrevious).toHaveBeenCalledOnce()
    expect(view.events.onNext).toHaveBeenCalledOnce()
    expect(view.events.onDownload).toHaveBeenCalledExactlyOnceWith(view.props.track)
    const seek = findCatalogElement(
      view.root,
      (node) => node.tag === 'input' && node.props.type === 'range',
    )
    seek.value = '8000'
    dispatchCatalogEvent(seek, 'onChange')
    expect(view.events.onSeek).toHaveBeenCalledExactlyOnceWith(8000)
    expect(view.props.state.positionMs).toBe(1000)
    view.unmount()
  })

  it('forwards volume and settings choices, and releases visual modal state on unmount', async () => {
    const view = mountPlayer()
    dispatchCatalogEvent(view.button('调整音量'), 'onClick')
    await nextTick()
    const input = findCatalogElement(
      view.overlays,
      (node) => node.tag === 'input' && node.props.id === 'am-player-volume',
    )
    input.value = '0.25'
    dispatchCatalogEvent(input, 'onInput')
    expect(view.events.onSetVolume).toHaveBeenCalledExactlyOnceWith(0.25)
    expect(view.props.state.volume).toBe(0.5)
    view.unmount()
    expect(view.events.onSettingsOpenChange).toHaveBeenLastCalledWith(false)
  })

  it('preserves loading, missing-track, unavailable download and error text contracts', async () => {
    const view = mountPlayer()
    view.props.state = { ...view.props.state, status: 'resolving', seekDisabled: true }
    view.props.canDownload = false
    await nextTick()
    expect(view.button('播放').props.disabled).toBe(true)
    expect(view.button('选择音质').props.disabled).toBe(true)
    expect(view.button('下载当前音乐').props.disabled).toBe(true)
    view.props.state = { ...view.props.state, status: 'error', statusLabel: '媒体暂时不可用' }
    await nextTick()
    expect(view.root.textContent).toContain('媒体暂时不可用')
    view.props.track = undefined
    await nextTick()
    expect(view.button('播放').props.disabled).toBe(true)
    view.unmount()
  })
})
