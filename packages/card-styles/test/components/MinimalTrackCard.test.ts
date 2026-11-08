import type { Track } from '@any-music/core'
import TrackCardGrid from '@any-music/ui/components/music-sources/TrackCardGrid.vue'
import { describe, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick, reactive, shallowRef } from 'vue'

import MinimalTrackCard from '../../src/components/MinimalTrackCard.vue'
import { playbackProgress } from '../../src/index'
import { provideCardPresentation, useCardPresentation } from '../../src/presentation'
import { click, find, mount } from '../helpers/renderer'

const track: Track = {
  id: 'one',
  title: '音乐',
  durationMs: 1000,
  artists: [],
  artworkUrl: 'https://example.com/art.jpg',
  source: { pluginId: 'test', resourceId: 'one', mediaKind: 'audio' },
}
describe('minimal track presentation', () => {
  it('renders readonly artwork and metadata without selection or playback controls', () => {
    const view = mount(
      defineComponent({
        setup: () => () =>
          h(MinimalTrackCard, {
            track,
            title: track.title,
            readonly: true,
            selectable: true,
            reorderable: true,
          }),
      }),
    )
    try {
      expect(view.root.textContent).toContain(track.title)
      expect(() =>
        find(view.root, (node) => node.tag === 'button' || node.tag === 'input'),
      ).toThrow()
      const artwork = find(view.root, (node) => node.props['data-readonly'] === 'true')
      expect(artwork.tag).toBe('div')
    } finally {
      view.unmount()
    }
  })
  it.each([false, true])(
    'keeps invalid tracks reorderable with selection mode %s',
    (selectable) => {
      const play = vi.fn(),
        pause = vi.fn(),
        press = vi.fn(),
        shift = vi.fn(),
        select = vi.fn()
      const view = mount(
        defineComponent({
          setup: () => () =>
            h(MinimalTrackCard, {
              track,
              title: track.title,
              invalid: true,
              playing: true,
              reorderable: true,
              selectable,
              onPlay: play,
              onPause: pause,
              onCoverPress: press,
              onShift: shift,
              onSelect: select,
            }),
        }),
      )
      try {
        const cover = find(view.root, (node) => node.props['data-queue-handle'] !== undefined)
        click(cover)
        ;(cover.props.onPointerdown as (event: object) => void)({ pointerId: 1 })
        const handlers = cover.props.onKeydown as ((event: object) => void)[]
        handlers.forEach((handler) => handler({ key: 'ArrowDown', preventDefault() {} }))
        expect(play).not.toHaveBeenCalled()
        expect(pause).not.toHaveBeenCalled()
        expect(select).toHaveBeenCalledTimes(selectable ? 1 : 0)
        expect(press).toHaveBeenCalledOnce()
        expect(shift).toHaveBeenCalledExactlyOnceWith(1)
      } finally {
        view.unmount()
      }
    },
  )
  it('projects the real clock through seeks, looping, switches and grid rearrangement without timers', async () => {
    const player = reactive({
      track: { id: 'one' },
      playing: true,
      positionMs: 250,
      durationMs: 1000,
    })
    const pause = vi.fn(() => {
      player.playing = false
    })
    const resume = vi.fn(() => {
      player.playing = true
    })
    const mode = shallowRef<'standard' | 'compact'>('standard')
    const timers = vi.spyOn(globalThis, 'setInterval')
    const card = defineComponent({
      setup() {
        const {
          active,
          playing,
          progress,
          pause: requestPause,
          resume: requestResume,
        } = useCardPresentation(() => track.id)
        return () =>
          h(MinimalTrackCard, {
            track,
            title: track.title,
            active: active.value,
            playing: playing.value,
            progress: progress.value,
            onPause: requestPause,
            onPlay: requestResume,
          })
      },
    })
    const view = mount(
      defineComponent({
        setup() {
          provideCardPresentation({
            itemStyle: () => 'minimal',
            player: () => player,
            actions: { play: resume, pause },
          })
          return () =>
            h(TrackCardGrid, { displayMode: mode.value, mobileColumns: 1 }, () => h(card))
        },
      }),
    )
    try {
      const article = find(view.root, (node) => node.tag === 'article')
      const border = () => find(view.root, (node) => node.tag === 'rect')
      expect(border().props['stroke-dasharray']).toBe('25 100')
      const cover = () =>
        find(view.root, (node) => node.props['data-am-focus-key'] === 'track:one:play')
      expect(cover().props.title).toBe('正在播放，点击暂停')
      expect(cover().props['aria-label']).toBe('暂停《音乐》')
      click(cover())
      await nextTick()
      expect(pause).toHaveBeenCalledOnce()
      expect(cover().props['aria-label']).toBe('播放《音乐》')
      expect(cover().props.title).toBeUndefined()
      click(cover())
      await nextTick()
      expect(resume).toHaveBeenCalledOnce()
      expect(player.positionMs).toBe(250)
      mode.value = 'compact'
      player.positionMs = 700
      await nextTick()
      expect(find(view.root, (node) => node.tag === 'article')).toBe(article)
      expect(border().props['stroke-dasharray']).toBe('70 100')
      player.positionMs = 1000
      await nextTick()
      expect(border().props['stroke-dasharray']).toBe('0 100')
      player.positionMs = 20
      await nextTick()
      expect(border().props['stroke-dasharray']).toBe('2 100')
      player.track.id = 'another'
      await nextTick()
      expect(() => border()).toThrow()
      expect(cover().props['aria-label']).toBe('播放《音乐》')
      click(cover())
      expect(resume).toHaveBeenCalledOnce()
      expect(pause).toHaveBeenCalledOnce()
      expect(timers).not.toHaveBeenCalled()
    } finally {
      view.unmount()
      timers.mockRestore()
    }
  })
  it.each([
    { invalid: false, playing: false },
    { invalid: false, playing: true },
    { invalid: true, playing: false },
    { invalid: true, playing: true },
  ])(
    'switches cover playback to selection and back for invalid=$invalid, playing=$playing',
    async ({ invalid, playing }) => {
      const selectable = shallowRef(false),
        selected = shallowRef(false)
      const play = vi.fn(),
        pause = vi.fn(),
        select = vi.fn(() => {
          selected.value = !selected.value
        })
      const view = mount(
        defineComponent({
          setup: () => () =>
            h(MinimalTrackCard, {
              track,
              title: track.title,
              invalid,
              playing,
              selectable: selectable.value,
              selected: selected.value,
              focusId: 'history-entry',
              selectionDescription: '音乐的播放记录',
              onPlay: play,
              onPause: pause,
              onSelect: select,
            }),
        }),
      )
      try {
        const cover = () =>
          find(
            view.root,
            (node) => node.tag === 'button' && node.props['aria-haspopup'] === undefined,
          )
        const checkbox = () => find(view.root, (node) => node.props.type === 'checkbox')
        const playOverlay = () =>
          find(view.root, (node) => node.props.class === 'am-minimal-track__play')
        const playbackLabel = `${playing ? '暂停' : '播放'}《音乐》`
        expect(cover().props['aria-label']).toBe(playbackLabel)
        expect(cover().props.disabled).toBe(invalid)
        expect(() => checkbox()).toThrow()
        expect(playOverlay()).toBeDefined()

        selectable.value = true
        await nextTick()
        expect(cover().props.disabled).toBe(false)
        expect(cover().props['aria-disabled']).toBeUndefined()
        expect(cover().props['aria-label']).toBe('选择音乐的播放记录')
        expect(cover().props.title).toBeUndefined()
        expect(cover().props['aria-pressed']).toBe(false)
        expect(checkbox().props['data-am-focus-key']).toBe('track:history-entry:select')
        expect(() => playOverlay()).toThrow()

        click(cover())
        await nextTick()
        expect(select).toHaveBeenCalledTimes(1)
        expect(checkbox().props.checked).toBe(true)
        expect(cover().props['aria-label']).toBe('取消选择音乐的播放记录')
        expect(cover().props['aria-pressed']).toBe(true)
        click(cover())
        await nextTick()
        expect(select).toHaveBeenCalledTimes(2)
        expect(checkbox().props.checked).toBe(false)
        ;(checkbox().props.onChange as () => void)()
        await nextTick()
        expect(select).toHaveBeenCalledTimes(3)
        expect(cover().props['aria-pressed']).toBe(true)
        expect(play).not.toHaveBeenCalled()
        expect(pause).not.toHaveBeenCalled()

        selectable.value = false
        await nextTick()
        expect(() => checkbox()).toThrow()
        expect(playOverlay()).toBeDefined()
        expect(cover().props['aria-label']).toBe(playbackLabel)
        expect(cover().props['aria-pressed']).toBeUndefined()
        expect(cover().props.disabled).toBe(invalid)
        click(cover())
        expect(play).toHaveBeenCalledTimes(!invalid && !playing ? 1 : 0)
        expect(pause).toHaveBeenCalledTimes(!invalid && playing ? 1 : 0)
        expect(select).toHaveBeenCalledTimes(3)
      } finally {
        view.unmount()
      }
    },
  )
  it('emits cover playback and menu intents while retaining the image privacy boundary', () => {
    const play = vi.fn(),
      actions = vi.fn()
    const view = mount(
      defineComponent({
        setup: () => () =>
          h(MinimalTrackCard, {
            track,
            title: track.title,
            onPlay: play,
            onActions: actions,
          }),
      }),
    )
    try {
      click(find(view.root, (node) => node.props['aria-label'] === '播放《音乐》'))
      click(find(view.root, (node) => node.props['aria-label'] === '打开《音乐》的操作'))
      expect(play).toHaveBeenCalledOnce()
      expect(actions).toHaveBeenCalledOnce()
      expect(find(view.root, (node) => node.tag === 'img').props.referrerpolicy).toBe('no-referrer')
      expect(view.root.textContent).not.toContain('播放于')
    } finally {
      view.unmount()
    }
  })
  it.each([
    [NaN, 100],
    [10, Infinity],
    [10, 0],
    [-1, 100],
    [101, 100],
  ])('bounds invalid or ended clock %s/%s', (position, duration) => {
    expect(playbackProgress(position, duration)).toBe(0)
  })
})
