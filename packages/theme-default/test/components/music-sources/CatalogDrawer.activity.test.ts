import type { CatalogDrawerView } from '@any-music/ui'
import { provideConfirmationDialog } from '@any-music/ui/catalog'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick, shallowRef } from 'vue'
import type { Component } from 'vue'

import CatalogDrawer from '../../../src/components/music-sources/CatalogDrawer.vue'
import CatalogDrawerList from '../../../src/components/music-sources/CatalogDrawerList.vue'
import {
  CatalogTestElement,
  dispatchCatalogEvent,
  findCatalogElement,
  mountCatalogComponent,
} from '../../helpers/test-renderer'

// 保留真实 Teleport，验证隐藏板块确实把浮层移出公共宿主，而不只是暂停点击。
vi.mock('vue', async (load) => {
  const vue = await load<typeof import('vue')>()
  const transition = vue.defineComponent({
    inheritAttrs: false,
    setup:
      (_, { slots }) =>
      () =>
        slots.default?.(),
  })
  return { ...vue, Transition: transition, TransitionGroup: transition }
})
vi.mock('@any-music/ui/components/BottomSheet.vue', async () => {
  const vue = await import('vue')
  return {
    default: vue.defineComponent({
      props: ['open', 'suspended'],
      setup:
        (props, { slots }) =>
        () =>
          props.open
            ? vue.h('section', { 'data-filter-suspended': props.suspended }, slots.default?.())
            : null,
    }),
  }
})
vi.mock('@any-music/ui/components/SidePanel.vue', async () => {
  const vue = await import('vue')
  return {
    default: vue.defineComponent({
      props: ['open', 'suspended'],
      setup: (props) => () =>
        props.open
          ? vue.h('aside', { 'data-operator-suspended': props.suspended }, '操作器')
          : null,
    }),
  }
})
vi.mock('../../../src/components/music-sources/CatalogTrackFilterPanel.vue', async () => {
  const vue = await import('vue')
  return {
    default: vue.defineComponent({
      setup() {
        const edits = vue.shallowRef(0)
        return () => vue.h('button', { onClick: () => (edits.value += 1) }, `草稿 ${edits.value}`)
      },
    }),
  }
})

beforeEach(() => {
  vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() })
  vi.stubGlobal('Document', CatalogTestElement)
})
afterEach(() => vi.unstubAllGlobals())

it.each([
  { name: 'list', component: CatalogDrawerList },
  { name: 'tracks', component: CatalogDrawer },
])(
  'keeps catalog filter editors alive while hiding and suspending their overlays ($name)',
  async ({ component }) => {
    const active = shallowRef(true)
    const overlay = new CatalogTestElement('overlay')
    const drawer: CatalogDrawerView = {
      id: 'test',
      title: '测试',
      input: '测试',
      kind: 'search',
      pluginId: 'test',
      pluginName: '测试源',
      isExpanded: true,
      isSourceEnabled: true,
      tracks: [],
      loadedPageCount: 0,
      hasMore: false,
      isLoading: false,
      status: 'ready',
      errorMessage: '',
      invalidReason: '',
    }
    const view = mountCatalogComponent(
      defineComponent({
        setup() {
          provideConfirmationDialog()
          return () =>
            h('div', { hidden: !active.value }, [
              h(component as Component, {
                active: active.value,
                ...(component === CatalogDrawer
                  ? {
                      drawer,
                      playlists: [],
                      displayMode: 'standard',
                      mobileColumns: 1,
                      favoriteTrackIds: new Set(),
                      customTagsByTrackId: new Map(),
                    }
                  : { drawers: [], discoveryLabel: '搜索与导入' }),
                invalidTrackIds: new Set(),
                filterOpen: true,
                operatorOpen: true,
                overlayTarget: overlay,
                operatorOverlayTarget: overlay,
              }),
            ])
        },
      }),
      {},
    )
    await nextTick()
    dispatchCatalogEvent(
      findCatalogElement(overlay, (node) => node.tag === 'button'),
      'onClick',
    )
    await nextTick()
    expect(overlay.textContent).toContain('草稿 1')
    expect(overlay.textContent).toContain('操作器')
    active.value = false
    await nextTick()
    expect(() =>
      findCatalogElement(overlay, (node) => 'data-filter-suspended' in node.props),
    ).toThrow()
    expect(() =>
      findCatalogElement(overlay, (node) => 'data-operator-suspended' in node.props),
    ).toThrow()
    expect(
      findCatalogElement(view.root, (node) => 'data-filter-suspended' in node.props).props[
        'data-filter-suspended'
      ],
    ).toBe(true)
    expect(
      findCatalogElement(view.root, (node) => 'data-operator-suspended' in node.props).props[
        'data-operator-suspended'
      ],
    ).toBe(true)
    active.value = true
    await nextTick()
    expect(overlay.textContent).toContain('草稿 1')
    expect(overlay.textContent).toContain('操作器')
    expect(
      findCatalogElement(overlay, (node) => 'data-filter-suspended' in node.props).props[
        'data-filter-suspended'
      ],
    ).toBe(false)
    view.unmount()
  },
)
