import { getProductDestination, PRODUCT_DESTINATIONS } from '@any-music/ui'
import type { UiWorkbenchShellProps } from '@any-music/ui/theme'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { defineComponent as defineHost, h as render, nextTick, shallowReactive } from 'vue'

import ProductWorkbench from '../../../src/components/shell/ProductWorkbench.vue'
import {
  dispatchCatalogEvent,
  findCatalogElement,
  mountCatalogComponent,
} from '../../helpers/test-renderer'

// Exercise the real chrome/navigation events; DOM animation and modal focus are
// independently covered by UI primitives and require live inspection for acceptance.
vi.mock('vue', async (original) => {
  const vue = await original<typeof import('vue')>()
  return {
    ...vue,
    Transition: vue.defineComponent({
      setup:
        (_props, { slots }) =>
        () =>
          slots.default?.(),
    }),
  }
})
vi.mock('@any-music/ui/components/MusicAppShell.vue', async () => {
  const { defineComponent, h } = await import('vue')
  return {
    default: defineComponent({
      setup:
        (_props, { slots }) =>
        () =>
          h(
            'main',
            {},
            Object.values(slots).flatMap((slot) => slot?.() ?? []),
          ),
    }),
  }
})
vi.mock('@any-music/ui/components/BottomSheet.vue', async () => {
  const { defineComponent } = await import('vue')
  return {
    default: defineComponent({ render: () => null }),
  }
})
vi.mock('../../../src/components/settings/AppShellPreferenceDialog.vue', async () => {
  const { defineComponent } = await import('vue')
  return {
    default: defineComponent({ render: () => null }),
  }
})
afterEach(() => vi.unstubAllGlobals())

describe('controlled classic shell events', () => {
  it('forwards desktop/mobile navigation and sidebar state, and hides/restores without disposing content', async () => {
    const disposed = vi.fn(),
      mounted = vi.fn()
    const props = shallowReactive<UiWorkbenchShellProps>({
      activeDestination: getProductDestination('catalog'),
      activeDescription: '',
      navigationItems: PRODUCT_DESTINATIONS,
      mobileNavigationItems: [getProductDestination('catalog'), getProductDestination('favorites')],
      activeMobileNavigationId: 'catalog',
      preferenceDestinations: PRODUCT_DESTINATIONS,
      hiddenDestinationIds: [],
      sidebarSide: 'right',
      sidebarCollapsed: false,
      mobileDrawerOpen: false,
      mobileNavigationEnabled: true,
      mobileLayout: true,
      preferencesOpen: false,
      theme: 'system',
      resolvedTheme: 'dark',
      canHideProduct: true,
      productHidden: false,
    })
    const select = vi.fn(),
      mobileSelect = vi.fn(),
      collapse = vi.fn()
    const Content = defineHost({
      setup() {
        mounted()
        return () => render('article', { onVnodeUnmounted: disposed }, '稳定内容')
      },
    })
    const view = mountCatalogComponent(
      defineHost({
        setup: () => () =>
          render(
            ProductWorkbench,
            {
              ...props,
              onSelectNavigation: select,
              onSelectMobileNavigation: mobileSelect,
              onToggleSidebarCollapsed: collapse,
              onHideProduct: () => {
                props.productHidden = true
              },
              onShowProduct: () => {
                props.productHidden = false
              },
            },
            { default: () => render(Content) },
          ),
      }),
      {},
    )
    try {
      dispatchCatalogEvent(
        findCatalogElement(
          view.root,
          (node) => node.props['data-am-focus-key'] === 'navigation:queue',
        ),
        'onClick',
      )
      expect(select).toHaveBeenCalledExactlyOnceWith('queue')
      const mobile = findCatalogElement(
        view.root,
        (node) => node.tag === 'nav' && node.props['aria-label'] === '移动导航',
      )
      dispatchCatalogEvent(
        findCatalogElement(
          mobile,
          (node) => node.tag === 'button' && node.textContent.includes('喜欢'),
        ),
        'onClick',
      )
      expect(mobileSelect).toHaveBeenCalledExactlyOnceWith('favorites')
      dispatchCatalogEvent(
        findCatalogElement(
          view.root,
          (node) => node.tag === 'button' && node.props['aria-label'] === '收起侧栏',
        ),
        'onClick',
      )
      expect(collapse).toHaveBeenCalledOnce()
      dispatchCatalogEvent(
        findCatalogElement(
          view.root,
          (node) => node.tag === 'button' && node.props['aria-label'] === '隐藏 Any Music',
        ),
        'onClick',
      )
      await nextTick()
      expect(props.productHidden).toBe(true)
      expect(disposed).not.toHaveBeenCalled()
      dispatchCatalogEvent(
        findCatalogElement(
          view.root,
          (node) => node.tag === 'button' && node.props['aria-label'] === '显示 Any Music',
        ),
        'onClick',
      )
      await nextTick()
      expect(props.productHidden).toBe(false)
      expect(mounted).toHaveBeenCalledOnce()
      expect(disposed).not.toHaveBeenCalled()
    } finally {
      view.unmount()
    }
    expect(disposed).toHaveBeenCalledOnce()
  })
})
