import { describe, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick, shallowRef } from 'vue'

import DialogPages from '../../src/components/DialogPages.vue'
import { findCatalogElement, mountCatalogComponent } from './music-sources/catalog-test-renderer'

vi.mock('vue', async (load) => {
  const vue = await load<typeof import('vue')>()
  return {
    ...vue,
    Transition: vue.defineComponent({
      inheritAttrs: false,
      setup:
        (_, { attrs, slots }) =>
        () =>
          vue.h(
            'div',
            {
              'data-transition': attrs.name,
              onBeforeEnter: attrs.onBeforeEnter,
              onBeforeLeave: attrs.onBeforeLeave,
              onLeaveCancelled: attrs.onLeaveCancelled,
              onAfterEnter: attrs.onAfterEnter,
            },
            slots.default?.(),
          ),
    }),
  }
})

describe('dialog page navigation', () => {
  it('withdraws leaving pages, restores cancelled pages and focuses only the current page', async () => {
    const page = shallowRef('tags')
    const returning = shallowRef(false)
    const view = mountCatalogComponent(
      defineComponent({
        setup: () => () =>
          h(
            DialogPages,
            {
              page: page.value,
              returning: returning.value,
              focusSelector: '[name="playlist-tag"]',
            },
            {
              default: () => h('input', { name: 'playlist-tag' }),
            },
          ),
      }),
      {},
    )
    const transition = () =>
      findCatalogElement(view.root, (node) => 'data-transition' in node.props)
    const current = () =>
      findCatalogElement(view.root, (node) => node.props['data-dialog-page'] === page.value)
    try {
      expect(transition().props['data-transition']).toBe('dialog-page-forward')
      const oldPage = current()
      ;(transition().props.onBeforeLeave as (element: unknown) => void)(oldPage)
      expect(oldPage.getAttribute('inert')).toBe('')
      expect(oldPage.getAttribute('aria-hidden')).toBe('true')
      ;(transition().props.onLeaveCancelled as (element: unknown) => void)(oldPage)
      expect(oldPage.getAttribute('inert')).toBeNull()
      expect(oldPage.getAttribute('aria-hidden')).toBeNull()
      returning.value = true
      page.value = 'actions'
      await nextTick()
      expect(transition().props['data-transition']).toBe('dialog-page-back')
      const input = findCatalogElement(current(), (node) => node.tag === 'input')
      await (transition().props.onAfterEnter as (element: unknown) => Promise<void>)(oldPage)
      expect(input.isFocused).toBe(false)
      await (transition().props.onAfterEnter as (element: unknown) => Promise<void>)(current())
      expect(input.isFocused).toBe(true)
    } finally {
      view.unmount()
    }
  })
})
