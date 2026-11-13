import { describe, expect, it, vi } from 'vitest'

import CatalogTrackOperatorPanel from '../../../src/components/music-sources/CatalogTrackOperatorPanel.vue'
import {
  dispatchCatalogEvent,
  findCatalogElement,
  mountCatalogComponent,
} from '../../helpers/test-renderer'

describe('CatalogTrackOperatorPanel action groups', () => {
  it.each(['queue', 'favorites'] as const)(
    'places the %s removal second, between playlist and download',
    (context) => {
      const onRemoveSelected = vi.fn()
      const view = mountCatalogComponent(CatalogTrackOperatorPanel, {
        context,
        selectedCount: 2,
        visibleCount: 2,
        areAllVisibleSelected: true,
        areSomeVisibleSelected: false,
        downloadBusy: false,
        hasSelectedCustomNames: true,
        onRemoveSelected,
      })
      const content = findCatalogElement(
        view.root,
        (node) => node.props.class === 'catalog-operator-actions__content',
      )
      const buttons = content.children.filter((node) => node.tag === 'button')
      expect(buttons.slice(0, 3).map((node) => node.props['aria-label'])).toEqual([
        '将已选歌曲加入歌单',
        context === 'favorites' ? '将已选歌曲移出我的喜欢' : '将已选歌曲移出待听',
        '下载已选歌曲',
      ])
      const removeButton = buttons[1]!
      expect(removeButton.props.class).toBe('catalog-actions__remove')
      expect(removeButton.textContent).toContain(context === 'favorites' ? '移出喜欢' : '移出待听')
      expect(removeButton.props.disabled).toBe(false)
      dispatchCatalogEvent(removeButton, 'onClick')
      expect(onRemoveSelected).toHaveBeenCalledOnce()
      view.unmount()
    },
  )
  it.each([
    [false, false, 4],
    [true, false, 3],
    [false, true, 3],
    [true, true, 2],
  ])(
    'hides existing queue=%s and favorites=%s actions while keeping download and playlist',
    (queued, favorited, count) => {
      const view = mountCatalogComponent(CatalogTrackOperatorPanel, {
        selectedCount: 2,
        visibleCount: 2,
        areAllVisibleSelected: true,
        areSomeVisibleSelected: false,
        areAllSelectedQueued: queued,
        areAllSelectedFavorited: favorited,
        downloadBusy: false,
      })
      const content = findCatalogElement(
        view.root,
        (node) => node.props.class === 'catalog-operator-actions__content',
      )
      const buttons = content.children.filter((node) => node.tag === 'button')
      expect(buttons).toHaveLength(count)
      expect(
        buttons.some((node) => node.props['aria-label'] === '按勾选顺序添加已选歌曲到待听'),
      ).toBe(!queued)
      expect(buttons.some((node) => node.props['aria-label'] === '将已选歌曲添加到我的喜欢')).toBe(
        !favorited,
      )
      expect(buttons.some((node) => node.props['aria-label'] === '下载已选歌曲')).toBe(true)
      expect(buttons.some((node) => node.props['aria-label'] === '将已选歌曲加入歌单')).toBe(true)
      view.unmount()
    },
  )
  it('keeps select all above playlist, download, queue and favorites actions', () => {
    const onToggleAllVisible = vi.fn()
    const onDownloadSelected = vi.fn()
    const onAddSelectedToQueue = vi.fn()
    const onAddSelectedToFavorites = vi.fn()
    const onAddToPlaylist = vi.fn()
    const onRestoreNames = vi.fn()
    const view = mountCatalogComponent(CatalogTrackOperatorPanel, {
      selectedCount: 2,
      visibleCount: 3,
      areAllVisibleSelected: false,
      areSomeVisibleSelected: true,
      areAllSelectedFavorited: false,
      downloadBusy: false,
      hasSelectedCustomNames: true,
      onToggleAllVisible,
      onDownloadSelected,
      onAddSelectedToQueue,
      onAddSelectedToFavorites,
      onAddToPlaylist,
      onRestoreNames,
    })
    const manage = findCatalogElement(
      view.root,
      (node) => node.props.class === 'catalog-actions__manage',
    )
    expect(manage.textContent).toContain('全选')
    expect(manage.textContent).not.toContain('加入歌单')
    dispatchCatalogEvent(
      findCatalogElement(manage, (node) => node.tag === 'input'),
      'onChange',
    )
    expect(onToggleAllVisible).toHaveBeenCalledOnce()
    expect(manage.textContent).not.toContain('恢复原名')
    const buttons = findCatalogElement(
      view.root,
      (node) => node.props.class === 'catalog-operator-actions__content',
    ).children.filter((node) => node.tag === 'button')
    expect(buttons.map((node) => node.props['aria-label'])).toEqual([
      '将已选歌曲加入歌单',
      '下载已选歌曲',
      '按勾选顺序添加已选歌曲到待听',
      '将已选歌曲添加到我的喜欢',
      '恢复已选歌曲的原名',
    ])
    for (const button of buttons) dispatchCatalogEvent(button, 'onClick')
    for (const action of [
      onRestoreNames,
      onAddSelectedToQueue,
      onDownloadSelected,
      onAddSelectedToFavorites,
      onAddToPlaylist,
    ])
      expect(action).toHaveBeenCalledOnce()
    view.unmount()
  })
})
