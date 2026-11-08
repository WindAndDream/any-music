import { afterEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick, shallowRef } from 'vue'

import AppDialog from '../../src/components/AppDialog.vue'
import { findCatalogElement, mountCatalogComponent } from './music-sources/catalog-test-renderer'
import type { CatalogTestElement } from './music-sources/catalog-test-renderer'

vi.mock('vue', async (load) => {
  const vue = await load<typeof import('vue')>()
  return {
    ...vue,
    Transition: vue.defineComponent({
      inheritAttrs: false,
      props: ['appear'],
      setup:
        (props, { attrs, slots }) =>
        () =>
          vue.h(
            'div',
            { 'data-transition': true, appear: props.appear, onFinishLeave: attrs.onAfterLeave },
            slots.default?.(),
          ),
    }),
  }
})

afterEach(() => vi.unstubAllGlobals())

it('keeps nested overlays outside suspended content and forwards panel styling attributes', () => {
  const view = mountCatalogComponent(
    defineComponent({
      setup: () => () =>
        h(
          AppDialog,
          { open: true, title: '添加歌单', suspended: true, class: 'picker-dialog' },
          {
            default: () => h('p', '歌单列表'),
            overlays: () => h('section', { 'data-child-dialog': true }, '展示方式'),
          },
        ),
    }),
    {},
  )
  const parent = findCatalogElement(view.root, (node) =>
    String(node.props.class).includes('picker-dialog'),
  )
  const child = findCatalogElement(view.root, (node) => Boolean(node.props['data-child-dialog']))
  expect(parent.props.inert).toBe(true)
  expect(String(parent.props.class)).toMatch(/^app-dialog\b/)
  expect(child.parent?.props.class).toBe('app-dialog__overlays')
  for (let node = child.parent; node; node = node.parent) expect(node.props.inert).toBeUndefined()
  view.unmount()
})

it('enables the initial transition only when requested', () => {
  vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() })
  for (const appear of [false, true]) {
    const view = mountCatalogComponent(AppDialog, { open: false, title: '歌曲操作', appear })
    const transition = findCatalogElement(view.root, (node) => 'appear' in node.props)
    expect(transition.props.appear).toBe(appear)
    view.unmount()
  }
})

describe('dialog focus restoration', () => {
  it('returns focus after the owner unmounts the closed dialog and releases the background', async () => {
    const open = shallowRef(true)
    const mounted = shallowRef(true)
    const order: string[] = []
    let background: CatalogTestElement | undefined
    class FocusTarget {
      isConnected = true
      parentElement = null
      ownerDocument = { defaultView: { getComputedStyle: () => ({ visibility: 'visible' }) } }
      matches(selector: string) {
        return selector.includes('[inert]') && (!background || background.props.inert === true)
      }
      getRootNode() {
        return {}
      }
      getClientRects() {
        return [{}]
      }
      focus = vi.fn(() => order.push('focus returned'))
    }
    const opener = new FocusTarget()
    vi.stubGlobal('HTMLElement', FocusTarget)
    vi.stubGlobal('document', { activeElement: opener })
    vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() })
    const view = mountCatalogComponent(
      defineComponent({
        setup: () => () =>
          h('div', [
            h('main', { inert: mounted.value ? true : undefined }),
            mounted.value
              ? h(AppDialog, {
                  open: open.value,
                  title: '歌单操作',
                  onAfterLeave: () => {
                    order.push('owner closed')
                    mounted.value = false
                  },
                })
              : null,
          ]),
      }),
      {},
    )
    background = findCatalogElement(view.root, (node) => node.tag === 'main')
    try {
      open.value = false
      await nextTick()
      const transition = findCatalogElement(view.root, (node) =>
        Boolean(node.props['data-transition']),
      )
      const pending = (transition.props.onFinishLeave as () => Promise<void>)()
      expect(order).toEqual(['owner closed'])
      await pending
      expect(order).toEqual(['owner closed', 'focus returned'])
      expect(opener.focus).toHaveBeenCalledOnce()
    } finally {
      view.unmount()
    }
  })
})
