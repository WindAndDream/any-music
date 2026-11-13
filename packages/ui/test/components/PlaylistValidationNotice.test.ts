import { createAppErrorState } from '@any-music/core'
import { describe, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick } from 'vue'

import PlaylistValidationNotice from '../../src/components/PlaylistValidationNotice.vue'
import {
  dispatchCatalogEvent,
  findCatalogElement,
  mountCatalogComponent,
} from './music-sources/catalog-test-renderer'

vi.mock('../../src/components/AppDialog.vue', () => ({
  default: defineComponent({
    props: ['open'],
    setup:
      (props, { slots }) =>
      () =>
        props.open ? h('section', slots.default?.()) : null,
  }),
}))

describe('playlist source error notice', () => {
  it('shows a compact summary and opens per-song codes, reasons and source messages', async () => {
    const retry = vi.fn()
    const view = mountCatalogComponent(PlaylistValidationNotice, {
      validation: {
        status: 'complete',
        checkedCount: 3,
        totalCount: 3,
        issues: [
          {
            trackId: 'a',
            title: '离线歌曲',
            error: createAppErrorState('network-error', '连接失败'),
          },
          {
            trackId: 'b',
            title: '失效歌曲',
            error: createAppErrorState('not-found', '资源不存在'),
          },
          {
            trackId: 'c',
            title: '私密歌曲',
            error: createAppErrorState('access-denied', '仅作者可见'),
          },
        ],
      },
      onRetry: retry,
    })
    try {
      expect(view.root.textContent).toContain('3 首歌曲未通过检查')
      expect(view.root.textContent).toContain('AM-4001 · AM-1004 · AM-2002')
      dispatchCatalogEvent(
        findCatalogElement(view.root, (node) => node.props.title === '点击查看错误详情'),
        'onClick',
        false,
      )
      await nextTick()
      expect(view.root.textContent).toContain('歌曲不存在或已下架')
      expect(view.root.textContent).toContain('无权访问')
      expect(view.root.textContent).toContain('仅作者可见')
      dispatchCatalogEvent(
        findCatalogElement(
          view.root,
          (node) => node.tag === 'button' && node.textContent.trim() === '重新检查',
        ),
        'onClick',
        false,
      )
      expect(retry).toHaveBeenCalledOnce()
    } finally {
      view.unmount()
    }
  })
})
