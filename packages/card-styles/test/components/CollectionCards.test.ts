import { describe, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick, shallowRef } from 'vue'

import CoverPlaylistCard from '../../src/components/CoverPlaylistCard.vue'
import { click, find, mount } from '../helpers/renderer'

describe('controlled collection cards', () => {
  it('renders associated playlists without selection, navigation or editing actions', () => {
    const open = vi.fn(),
      actions = vi.fn(),
      select = vi.fn(),
      press = vi.fn()
    const view = mount(
      defineComponent({
        setup: () => () =>
          h(CoverPlaylistCard, {
            id: 'readonly',
            name: '关联歌单',
            count: 2,
            tags: ['通勤'],
            readonly: true,
            onOpen: open,
            onActions: actions,
            onSelect: select,
            onPress: press,
          }),
      }),
    )
    try {
      const artwork = find(view.root, (node) => node.props.class === 'am-cover-playlist__art')
      const title = find(view.root, (node) => node.props.class === 'am-cover-playlist__name')
      expect(artwork.tag).toBe('div')
      expect(title.tag).toBe('span')
      expect(artwork.props['data-queue-handle']).toBeUndefined()
      click(artwork)
      click(title)
      expect(() =>
        find(view.root, (node) => node.tag === 'button' || node.tag === 'input'),
      ).toThrow()
      for (const handler of [open, actions, select, press]) expect(handler).not.toHaveBeenCalled()
      expect(view.root.textContent).toContain('通勤')
    } finally {
      view.unmount()
    }
  })
  it('opens playlists and keeps the inline song count between the title and tags', async () => {
    const open = vi.fn(),
      actions = vi.fn()
    const selectable = shallowRef(false)
    const select = vi.fn()
    const view = mount(
      defineComponent({
        setup: () => () =>
          h(CoverPlaylistCard, {
            id: 'playlist',
            name: '歌单',
            count: 12,
            index: 0,
            coverUrl: 'https://example.com/cover.jpg',
            tags: ['通勤', '夜晚', '收藏'],
            selectable: selectable.value,
            onSelect: select,
            onOpen: open,
            onActions: actions,
          }),
      }),
    )
    try {
      expect(view.root.textContent).toContain('12 首')
      expect(view.root.textContent).not.toContain('01')
      click(find(view.root, (node) => node.props.class === 'am-cover-playlist__art'))
      expect(open).toHaveBeenCalledOnce()
      expect(
        find(view.root, (node) => node.props.class === 'am-cover-playlist__art').textContent,
      ).toContain('12 首歌曲')
      const body = find(view.root, (node) => node.props.class === 'am-cover-playlist__body')
      expect(body.textContent).toContain('共 12 首歌曲')
      expect(body.textContent.indexOf('共 12 首歌曲')).toBeGreaterThan(
        body.textContent.indexOf('歌单'),
      )
      expect(body.textContent.indexOf('共 12 首歌曲')).toBeLessThan(
        body.textContent.indexOf('通勤'),
      )
      expect(view.root.textContent).toContain('通勤')
      expect(view.root.textContent).not.toContain('+1')
      expect(view.root.textContent).toContain('收藏')
      click(find(view.root, (node) => node.props.class === 'am-cover-playlist__name'))
      click(find(view.root, (node) => node.props.class === 'am-cover-playlist__more'))
      expect(open).toHaveBeenCalledTimes(2)
      expect(actions).toHaveBeenCalledOnce()
      expect(find(view.root, (node) => node.tag === 'img').props.referrerpolicy).toBe('no-referrer')
      expect(() => find(view.root, (node) => node.tag === 'dialog')).toThrow()
      selectable.value = true
      await nextTick()
      click(find(view.root, (node) => node.props.class === 'am-cover-playlist__art'))
      expect(select).toHaveBeenCalledOnce()
      expect(open).toHaveBeenCalledTimes(2)
    } finally {
      view.unmount()
    }
  })
})
