import { createDefaultAppShellPreferences, PRODUCT_DESTINATIONS } from '@any-music/ui'
import type { UiThemeFeatureMap } from '@any-music/ui/theme'
import { describe, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick, shallowRef } from 'vue'

import ClassicNavigation from '../../../src/components/shell/ClassicNavigation.vue'
import {
  dispatchCatalogEvent,
  findCatalogElement,
  mountCatalogComponent,
} from '../../helpers/test-renderer'

describe('classic navigation projection', () => {
  it('honors host order/visibility, rejects disabled operations and keeps a mobile drawer expanded', async () => {
    const navigate = vi.fn()
    const feature = shallowRef<UiThemeFeatureMap['navigation']>({
      state: {
        activeViewId: 'catalog',
        destinations: PRODUCT_DESTINATIONS,
        preferences: {
          ...createDefaultAppShellPreferences(),
          isSidebarCollapsed: true,
          destinationOrder: ['queue', 'catalog', 'favorites'],
          hiddenDestinationIds: ['queue'],
        },
      },
      actions: { navigate, setPreferences: vi.fn() },
      availability: { status: 'available' },
      status: { status: 'ready' },
    })
    const view = mountCatalogComponent(
      defineComponent({
        setup: () => () => h(ClassicNavigation, { feature: feature.value, form: 'mobile' }),
      }),
      {},
    )
    try {
      const nav = findCatalogElement(view.root, (node) => node.tag === 'nav')
      expect(nav.props.class).not.toContain('navigation-rail--collapsed')
      const buttons = nav.children.filter((node) => node.tag === 'button')
      expect(buttons.map((button) => button.props['data-am-focus-key'])).toEqual([
        'navigation:catalog',
        'navigation:favorites',
      ])
      dispatchCatalogEvent(buttons[1]!, 'onClick')
      expect(navigate).toHaveBeenCalledExactlyOnceWith('favorites')
      feature.value = { ...feature.value, availability: { status: 'disabled', reason: '暂不可用' } }
      await nextTick()
      expect(nav.props.inert).toBe(true)
      dispatchCatalogEvent(buttons[1]!, 'onClick')
      expect(navigate).toHaveBeenCalledOnce()
    } finally {
      view.unmount()
    }
  })
})
