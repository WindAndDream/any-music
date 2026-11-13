import { describe, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick, shallowRef } from 'vue'

import ImagePreviewDialog from '../../src/components/ImagePreviewDialog.vue'
import {
  dispatchCatalogEvent,
  findCatalogElement,
  mountCatalogComponent,
} from './music-sources/catalog-test-renderer'

vi.mock('../../src/components/AppDialog.vue', async () => {
  const vue = await import('vue')
  return {
    default: vue.defineComponent({
      props: ['open', 'title'],
      emits: ['close'],
      setup:
        (props, { emit, slots }) =>
        () =>
          props.open
            ? vue.h('section', { 'aria-label': props.title }, [
                vue.h('button', { 'aria-label': '关闭图片预览', onClick: () => emit('close') }),
                slots.default?.(),
              ])
            : null,
    }),
  }
})

describe('single image preview', () => {
  it('bounds zoom, resets for another image/reopening and forwards close without bypassing the image boundary', async () => {
    const open = shallowRef(true)
    const src = shallowRef('data:image/jpeg;base64,AA==')
    const close = vi.fn()
    const view = mountCatalogComponent(
      defineComponent({
        setup: () => () =>
          h(ImagePreviewDialog, {
            open: open.value,
            src: src.value,
            title: '封面预览',
            onClose: close,
          }),
      }),
      {},
    )
    const button = (label: string) =>
      findCatalogElement(
        view.root,
        (node) => node.tag === 'button' && node.props['aria-label'] === label,
      )
    try {
      const image = findCatalogElement(view.root, (node) => node.tag === 'img')
      expect(image.props.referrerpolicy).toBe('no-referrer')
      expect(image.props.loading).toBe('eager')
      expect(view.root.textContent).not.toContain('适应窗口')
      expect(button('缩小图片').props.disabled).toBe(true)
      for (let index = 0; index < 8; index++)
        dispatchCatalogEvent(button('放大图片'), 'onClick', false)
      await nextTick()
      expect(view.root.textContent).toContain('400%')
      expect(button('放大图片').props.disabled).toBe(true)
      src.value = 'data:image/jpeg;base64,AQ=='
      await nextTick()
      expect(view.root.textContent).toContain('100%')
      dispatchCatalogEvent(
        findCatalogElement(view.root, (node) => node.tag === 'img'),
        'onDblclick',
        false,
      )
      await nextTick()
      expect(view.root.textContent).toContain('200%')
      dispatchCatalogEvent(button('关闭图片预览'), 'onClick', false)
      expect(close).toHaveBeenCalledOnce()
      open.value = false
      await nextTick()
      open.value = true
      await nextTick()
      expect(view.root.textContent).toContain('100%')
    } finally {
      view.unmount()
    }
  })
})
