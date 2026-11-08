import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick } from 'vue'

import PlaylistTrackHeading from '../../../src/components/library/PlaylistTrackHeading.vue'
import {
  CatalogTestElement,
  dispatchCatalogEvent,
  findCatalogElement,
  mountCatalogComponent,
} from '../../helpers/test-renderer'

beforeEach(() => vi.stubGlobal('HTMLElement', CatalogTestElement))
afterEach(() => vi.unstubAllGlobals())

describe('PlaylistTrackHeading', () => {
  it.each([false, true])(
    'keeps only accessible collection controls (compact: %s)',
    async (hideDisplay) => {
      const arrange = vi.fn()
      const view = mountCatalogComponent(
        defineComponent({
          setup: () => () =>
            h(
              PlaylistTrackHeading,
              {
                title: 'My playlist',
                arrangementMode: 'flat',
                displayMode: 'standard',
                mobileColumns: 1,
                overlayTarget: null,
                suspended: false,
                hideDisplay,
                onUpdateArrangementMode: arrange,
              },
              {
                navigation: () => h('button', { 'aria-label': '返回我的歌单' }, '返回'),
                ...(!hideDisplay
                  ? { actions: () => h('button', { 'aria-label': '歌单信息' }, '歌单信息') }
                  : {}),
              },
            ),
        }),
        {},
      )
      try {
        await nextTick()
        expect(view.root.textContent).not.toContain('My playlist')
        expect(view.root.querySelectorAll('[aria-label="收起列表信息"]')).toHaveLength(0)
        const arrangement = findCatalogElement(
          view.root,
          (node) => node.props['aria-label'] === 'My playlist排列方式',
        )
        expect(arrangement.children.filter((node) => node.tag === 'button')).toHaveLength(2)
        expect(view.root.querySelectorAll('[aria-label="返回我的歌单"]')).toHaveLength(1)
        const platform = findCatalogElement(
          view.root,
          (node) => node.tag === 'button' && node.textContent.trim() === '按平台',
        )
        dispatchCatalogEvent(platform, 'onClick', false)
        expect(arrange).toHaveBeenCalledExactlyOnceWith('platform')
        expect(view.root.querySelectorAll('[aria-label="选择歌曲展示方式"]')).toHaveLength(
          hideDisplay ? 0 : 1,
        )
        expect(view.root.querySelectorAll('[aria-label="歌单信息"]')).toHaveLength(
          hideDisplay ? 0 : 1,
        )
      } finally {
        view.unmount()
      }
    },
  )
})
