import MusicAppShell from '@any-music/ui/components/MusicAppShell.vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick, reactive } from 'vue'

import { findCatalogElement, mountCatalogComponent } from './music-sources/catalog-test-renderer'

const cleanups: (() => void)[] = []

beforeEach(() => {
  vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() })
  vi.stubGlobal(
    'ShadowRoot',
    class {
      activeElement = null
    },
  )
})

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup()
  vi.unstubAllGlobals()
})

function mountShell(sidebarSide: 'left' | 'right') {
  const props = reactive({
    sidebarSide,
    sidebarCollapsed: false,
    mobileLayout: false,
    mobileDrawerOpen: false,
    hasPlayer: false,
    hasMobileNavigation: false,
  })
  const view = mountCatalogComponent(
    defineComponent({ setup: () => () => h(MusicAppShell, props) }),
    {},
  )
  cleanups.push(view.unmount)
  const shell = findCatalogElement(view.root, (node) => node.tag === 'section')
  const sidebar = findCatalogElement(view.root, (node) => node.tag === 'aside')
  return {
    props,
    sidebar,
    isAnimated: () =>
      String(shell.props.class).includes('music-app-shell--mobile-drawer-transition'),
    isSidebarAnimated: () =>
      String(shell.props.class).includes('music-app-shell--sidebar-transition'),
    finishSidebarTransition: (target = shell) => {
      const handler = shell.props.onTransitionend as (event: unknown) => void
      handler({ target, currentTarget: shell })
    },
    finishTransition: (propertyName = 'transform', target = sidebar) => {
      const handler = sidebar.props.onTransitionend as (event: unknown) => void
      handler({ propertyName, target, currentTarget: sidebar })
    },
  }
}

describe('MusicAppShell responsive drawer motion', () => {
  it.each(['left', 'right'] as const)(
    'keeps the %s sidebar mounted and hides it without a transition on repeated breakpoint changes',
    async (side) => {
      const view = mountShell(side)
      expect(view.isAnimated()).toBe(false)
      expect(view.isSidebarAnimated()).toBe(false)
      view.props.sidebarCollapsed = true
      await nextTick()
      expect(view.isSidebarAnimated()).toBe(true)
      view.props.sidebarCollapsed = false
      await nextTick()
      expect(view.isSidebarAnimated()).toBe(true)
      view.finishSidebarTransition(view.sidebar)
      await nextTick()
      expect(view.isSidebarAnimated()).toBe(true)
      view.finishSidebarTransition()
      await nextTick()
      expect(view.isSidebarAnimated()).toBe(false)
      view.props.sidebarCollapsed = true
      await nextTick()
      expect(view.isSidebarAnimated()).toBe(true)
      view.props.sidebarSide = side === 'left' ? 'right' : 'left'
      await nextTick()
      expect(view.isSidebarAnimated()).toBe(false)
      view.props.sidebarCollapsed = false
      await nextTick()
      expect(view.isSidebarAnimated()).toBe(true)
      async function checkLayout(mobileLayout: boolean) {
        view.props.mobileLayout = mobileLayout
        await nextTick()
        expect(view.isAnimated()).toBe(false)
        expect(view.isSidebarAnimated()).toBe(false)
        expect(view.sidebar.props['aria-hidden']).toBe(mobileLayout ? 'true' : undefined)
        expect(view.sidebar.props.inert).toBe(mobileLayout ? true : undefined)
        expect(view.sidebar.parent).not.toBeNull()
      }
      await checkLayout(true)
      await checkLayout(false)
      await checkLayout(true)
    },
  )

  it('animates mobile open/close, tolerates quick reversals and clears motion after its own slide', async () => {
    const view = mountShell('left')
    view.props.mobileLayout = true
    await nextTick()
    view.props.mobileDrawerOpen = true
    await nextTick()
    expect(view.isAnimated()).toBe(true)
    expect(view.sidebar.props.role).toBe('dialog')

    view.finishTransition('opacity')
    view.finishTransition('transform', view.sidebar.parent!)
    await nextTick()
    expect(view.isAnimated()).toBe(true)

    view.props.mobileDrawerOpen = false
    await nextTick()
    expect(view.isAnimated()).toBe(true)
    expect(view.sidebar.props.inert).toBe(true)
    view.props.mobileDrawerOpen = true
    await nextTick()
    expect(view.isAnimated()).toBe(true)
    view.finishTransition()
    await nextTick()
    expect(view.isAnimated()).toBe(false)

    view.props.mobileDrawerOpen = false
    await nextTick()
    expect(view.isAnimated()).toBe(true)
    view.finishTransition()
    await nextTick()
    expect(view.isAnimated()).toBe(false)
  })

  it('cancels drawer motion when changing side or leaving mobile even while closing', async () => {
    const view = mountShell('left')
    view.props.mobileLayout = true
    view.props.mobileDrawerOpen = true
    await nextTick()
    expect(view.isAnimated()).toBe(false)
    view.props.sidebarSide = 'right'
    view.props.mobileDrawerOpen = false
    await nextTick()
    expect(view.isAnimated()).toBe(false)

    view.props.mobileDrawerOpen = true
    await nextTick()
    expect(view.isAnimated()).toBe(true)
    view.props.mobileDrawerOpen = false
    await nextTick()
    expect(view.isAnimated()).toBe(true)
    view.props.mobileLayout = false
    await nextTick()
    expect(view.isAnimated()).toBe(false)
    view.props.mobileLayout = true
    await nextTick()
    expect(view.isAnimated()).toBe(false)
  })
})
