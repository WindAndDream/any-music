import type { Track } from '@any-music/core'
import { describe, expect, it, vi } from 'vitest'
import { nextTick, reactive } from 'vue'

import TrackRow from '../../../src/components/music-sources/TrackRow.vue'
import {
  dispatchCatalogEvent,
  findCatalogElement,
  mountCatalogComponent,
} from '../../helpers/test-renderer'

const track: Track = {
  id: 'one',
  title: '测试歌曲',
  artists: [{ name: '测试作者' }],
  source: { pluginId: 'test', resourceId: 'one', mediaKind: 'audio' },
}

describe('TrackRow operator selection', () => {
  it.each(['default', 'minimal'] as const)(
    'uses native selection controls without playback or editing in the %s association view',
    async (itemStyle) => {
      const select = vi.fn()
      const play = vi.fn()
      const actions = vi.fn()
      const props = reactive({
        track,
        itemStyle,
        active: false,
        invalid: false,
        favorite: false,
        selected: false,
        selectable: true,
        selectionOnly: true,
        disabled: false,
        displayMode: 'standard' as const,
        onSelect: select,
        onPlay: play,
        onShowActions: actions,
      })
      const view = mountCatalogComponent(TrackRow, props)
      try {
        const checkbox = findCatalogElement(view.root, (node) => node.tag === 'input')
        expect(checkbox.parent?.props.class).toBe(
          itemStyle === 'minimal' ? 'am-minimal-track__select' : 'track__select',
        )
        expect(() => findCatalogElement(view.root, (node) => node.tag === 'button')).toThrow()
        dispatchCatalogEvent(
          findCatalogElement(view.root, (node) => node.tag === 'h3'),
          'onClick',
        )
        expect(select).toHaveBeenCalledExactlyOnceWith(track.id)
        props.disabled = true
        await nextTick()
        expect(checkbox.props.disabled).toBe(true)
        dispatchCatalogEvent(
          findCatalogElement(view.root, (node) => node.tag === 'h3'),
          'onClick',
        )
        expect(select).toHaveBeenCalledOnce()
        expect(play).not.toHaveBeenCalled()
        expect(actions).not.toHaveBeenCalled()
      } finally {
        view.unmount()
      }
    },
  )

  it.each(['default', 'minimal'] as const)(
    'toggles the whole %s card once while keeping its menu and native checkbox independent',
    async (itemStyle) => {
      const play = vi.fn(),
        favorite = vi.fn(),
        download = vi.fn(),
        actions = vi.fn()
      const select = vi.fn(() => {
        props.selected = !props.selected
      })
      const props = reactive({
        track,
        itemStyle,
        active: true,
        invalid: true,
        favorite: false,
        selected: false,
        selectable: false,
        displayMode: 'standard' as const,
        onPlay: play,
        onFavorite: favorite,
        onDownload: download,
        onShowActions: actions,
        onSelect: select,
      })
      const view = mountCatalogComponent(TrackRow, props)
      const find = (key: string) =>
        findCatalogElement(
          view.root,
          (node) => node.props['data-am-focus-key'] === `track:one:${key}`,
        )
      try {
        const article = findCatalogElement(view.root, (node) => node.tag === 'article')
        const title = findCatalogElement(article, (node) => node.tag === 'h3')
        dispatchCatalogEvent(title, 'onClick')
        expect(select).not.toHaveBeenCalled()

        props.selectable = true
        await nextTick()
        for (const target of [
          title,
          article,
          findCatalogElement(article, (node) => node.tag === 'p'),
        ]) {
          dispatchCatalogEvent(target, 'onClick')
        }
        await nextTick()
        expect(select).toHaveBeenCalledTimes(3)
        expect(find('select').props.checked).toBe(true)

        const menu = find('actions')
        dispatchCatalogEvent(
          findCatalogElement(menu, (node) => node.tag === 'path'),
          'onClick',
        )
        expect(actions).toHaveBeenCalledExactlyOnceWith(track)
        expect(select).toHaveBeenCalledTimes(3)

        const checkbox = find('select')
        dispatchCatalogEvent(checkbox.parent!, 'onClick')
        dispatchCatalogEvent(checkbox, 'onClick')
        expect(select).toHaveBeenCalledTimes(3)
        dispatchCatalogEvent(checkbox, 'onChange')
        await nextTick()
        expect(select).toHaveBeenCalledTimes(4)
        expect(checkbox.props.checked).toBe(false)

        dispatchCatalogEvent(find('play'), 'onClick')
        expect(select).toHaveBeenCalledTimes(5)
        expect(play).not.toHaveBeenCalled()
        expect(favorite).not.toHaveBeenCalled()
        expect(download).not.toHaveBeenCalled()

        props.selectable = false
        props.invalid = false
        await nextTick()
        dispatchCatalogEvent(title, 'onClick')
        dispatchCatalogEvent(find('play'), 'onClick')
        expect(select).toHaveBeenCalledTimes(5)
        expect(play).toHaveBeenCalledExactlyOnceWith(track)
      } finally {
        view.unmount()
      }
    },
  )
})
