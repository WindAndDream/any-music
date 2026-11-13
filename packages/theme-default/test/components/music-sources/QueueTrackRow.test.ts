import { provideCardPresentation } from '@any-music/card-styles/vue'
import type { Track } from '@any-music/core'
import { describe, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick, reactive, shallowRef, type CSSProperties } from 'vue'

import QueueTrackRow from '../../../src/components/music-sources/QueueTrackRow.vue'
import {
  dispatchCatalogEvent,
  findCatalogElement,
  mountCatalogComponent,
} from '../../helpers/test-renderer'

const track: Track = {
  id: 'track',
  title: '测试歌曲',
  artists: [],
  source: { pluginId: 'test', mediaKind: 'audio', resourceId: 'track' },
}

describe('QueueTrackRow drag surface', () => {
  it('switches the minimal cover between playback and batch selection while preserving sorting', async () => {
    const selectable = shallowRef(false)
    const player = reactive({ track: { ...track, id: 'other' }, playing: true })
    const play = vi.fn(),
      select = vi.fn(),
      drag = vi.fn(),
      actions = vi.fn()
    const pause = vi.fn(() => {
      player.playing = false
    })
    const resume = vi.fn(() => {
      player.playing = true
    })
    const view = mountCatalogComponent(
      defineComponent({
        setup() {
          provideCardPresentation({
            itemStyle: () => 'minimal',
            player: () => ({ ...player, positionMs: 250, durationMs: 1000 }),
            actions: { play: resume, pause },
          })
          return () =>
            h(QueueTrackRow, {
              track,
              position: 1,
              contextLabel: '平台',
              active: true,
              selected: false,
              selectable: selectable.value,
              dragging: false,
              getReorderStyle: () => undefined,
              favorite: false,
              invalid: false,
              downloadBusy: false,
              displayMode: 'standard',
              mobileColumns: 1,
              onPlay: play,
              onSelect: select,
              onDragStart: drag,
              onShowActions: actions,
            })
        },
      }),
      {},
    )
    try {
      const cover = findCatalogElement(
        view.root,
        (node) => node.tag === 'button' && node.props['data-queue-handle'] !== undefined,
      )
      dispatchCatalogEvent(cover, 'onClick', false)
      dispatchCatalogEvent(cover, 'onPointerdown', false)
      expect(play).toHaveBeenCalledExactlyOnceWith(track.id)
      expect(select).not.toHaveBeenCalled()
      expect(drag.mock.lastCall?.[1]).toBe(track.id)
      player.track = track
      await nextTick()
      expect(cover.props.title).toBe('正在播放，点击暂停')
      dispatchCatalogEvent(cover, 'onClick', false)
      await nextTick()
      expect(pause).toHaveBeenCalledOnce()
      dispatchCatalogEvent(cover, 'onClick', false)
      await nextTick()
      expect(resume).toHaveBeenCalledOnce()
      expect(play).toHaveBeenCalledTimes(1)
      selectable.value = true
      await nextTick()
      dispatchCatalogEvent(cover, 'onClick', false)
      dispatchCatalogEvent(cover, 'onPointerdown', false)
      expect(play).toHaveBeenCalledTimes(1)
      expect(select).toHaveBeenCalledExactlyOnceWith(track.id)
      expect(pause).toHaveBeenCalledOnce()
      expect(resume).toHaveBeenCalledOnce()
      expect(drag).toHaveBeenCalledTimes(2)
      dispatchCatalogEvent(
        findCatalogElement(view.root, (node) => node.tag === 'input'),
        'onChange',
        false,
      )
      expect(select).toHaveBeenCalledTimes(2)
      expect(select).toHaveBeenLastCalledWith(track.id)
      dispatchCatalogEvent(
        findCatalogElement(
          view.root,
          (node) => node.props['aria-label'] === '打开《测试歌曲》的操作',
        ),
        'onClick',
        false,
      )
      expect(actions).toHaveBeenCalledExactlyOnceWith(track.id)
      expect(
        findCatalogElement(view.root, (node) => node.tag === 'rect').props['stroke-dasharray'],
      ).toBe('25 100')
    } finally {
      view.unmount()
    }
  })
  it.each(['standard', 'compact'] as const)(
    'keeps scoped drag styles on the animated surface through the real %s row renderer',
    async (displayMode) => {
      const style = shallowRef<CSSProperties>()
      const dragging = shallowRef(false)
      const selectable = shallowRef(false)
      const onSelect = vi.fn(),
        onDragStart = vi.fn(),
        onShift = vi.fn()
      const view = mountCatalogComponent(
        defineComponent({
          setup: () => () =>
            h(QueueTrackRow, {
              track,
              position: 1,
              contextLabel: '测试平台',
              active: false,
              selected: false,
              selectable: selectable.value,
              onSelect,
              onDragStart,
              onShift,
              dragging: dragging.value,
              getReorderStyle: () => style.value,
              favorite: false,
              invalid: false,
              downloadBusy: false,
              displayMode,
              mobileColumns: 1,
            }),
        }),
        {},
      )
      try {
        const row = findCatalogElement(
          view.root,
          (node) => node.props['data-queue-drop-id'] === track.id,
        )
        const surface = findCatalogElement(row, (node) =>
          String(node.props.class).split(' ').includes('queue-track__surface'),
        )
        // Class/style forwarding alone cannot prove that the owning SFC's scoped transitions match.
        const scopeId = Object.keys(row.props).find((key) => key.startsWith('data-v-'))
        expect(scopeId).toBeDefined()
        expect(surface.props).toHaveProperty(scopeId!, '')
        expect(findCatalogElement(surface, (node) => node.tag === 'article').textContent).toContain(
          track.title,
        )

        const handle = findCatalogElement(
          row,
          (node) => node.tag === 'button' && node.props['data-queue-handle'] !== undefined,
        )
        dispatchCatalogEvent(handle, 'onClick', false)
        expect(onSelect).not.toHaveBeenCalled()
        expect(() => findCatalogElement(row, (node) => node.tag === 'input')).toThrow()
        dispatchCatalogEvent(handle, 'onPointerdown', false)
        expect(onDragStart.mock.lastCall?.[1]).toBe(track.id)
        const keys = handle.props.onKeydown as ((event: unknown) => void)[]
        keys.forEach((handler) =>
          handler({ key: 'ArrowDown', preventDefault() {}, stopPropagation() {} }),
        )
        expect(onShift).toHaveBeenCalledExactlyOnceWith(track.id, 1)
        selectable.value = true
        await nextTick()
        expect(findCatalogElement(row, (node) => node.tag === 'input').props.type).toBe('checkbox')
        dispatchCatalogEvent(handle, 'onClick', false)
        expect(onSelect).toHaveBeenCalledExactlyOnceWith(track.id)

        style.value = { transform: 'translate3d(0px, -110px, 0)' }
        await nextTick()
        expect(surface.props.style).toEqual(style.value)
        expect(surface.props.class).toContain('queue-track__surface--shifted')

        dragging.value = true
        style.value = { transform: 'translate3d(20px, 120px, 0)' }
        await nextTick()
        expect(row.props.class).toContain('queue-track--dragging')
        expect(surface.props.style).toEqual(style.value)
        expect(surface.props.class).not.toContain('queue-track__surface--shifted')

        dragging.value = false
        style.value = undefined
        await nextTick()
        expect(surface.props.style).toBeUndefined()
        expect(surface.props.class).not.toContain('queue-track__surface--shifted')
      } finally {
        view.unmount()
      }
    },
  )
})
