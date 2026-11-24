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
  const reducedMotion = { matches: false }
  const frames = new Map<number, FrameRequestCallback>()
  let frameId = 0
  const getAnimations = vi.fn<() => { transitionProperty: string; finished: Promise<void> }[]>(
    () => [],
  )
  Object.assign(shell, {
    getAnimations,
    ownerDocument: {
      defaultView: {
        matchMedia: () => reducedMotion,
        requestAnimationFrame(callback: FrameRequestCallback) {
          frames.set(++frameId, callback)
          return frameId
        },
        cancelAnimationFrame: (id: number) => frames.delete(id),
      },
    },
  })
  return {
    props,
    sidebar,
    reducedMotion,
    getAnimations,
    isAnimated: () =>
      String(shell.props.class).includes('music-app-shell--mobile-drawer-transition'),
    isSidebarAnimated: () =>
      String(shell.props.class).includes('music-app-shell--sidebar-transition'),
    isPreparingExpansion: () =>
      String(shell.props.class).includes('music-app-shell--preparing-sidebar-expansion'),
    runAnimationFrames() {
      for (let frame = 0; frame < 2; frame++) {
        const callbacks = [...frames.values()]
        frames.clear()
        for (const callback of callbacks) callback(0)
      }
    },
    finishTransition: (propertyName = 'transform', target = sidebar) => {
      const handler = sidebar.props.onTransitionend as (event: unknown) => void
      handler({ propertyName, target, currentTarget: sidebar })
    },
  }
}

function createTransition(transitionProperty = 'grid-template-columns') {
  let finish!: () => void
  let cancel!: () => void
  const finished = new Promise<void>((resolve, reject) => {
    finish = resolve
    cancel = () => reject(new Error('Transition cancelled'))
  })
  return { transitionProperty, finished, finish, cancel }
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
      view.props.sidebarSide = side === 'left' ? 'right' : 'left'
      await nextTick()
      expect(view.isSidebarAnimated()).toBe(false)
      view.props.sidebarCollapsed = true
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

  it('keeps the width stable through reversals until the current grid transition settles', async () => {
    const view = mountShell('left')
    const collapse = createTransition()
    const opacity = createTransition('opacity')
    view.getAnimations.mockReturnValue([opacity, collapse])
    view.props.sidebarCollapsed = true
    await nextTick()
    view.runAnimationFrames()

    const expand = createTransition()
    view.getAnimations.mockReturnValue([opacity, expand])
    view.props.sidebarCollapsed = false
    await nextTick()
    view.runAnimationFrames()

    opacity.finish()
    collapse.cancel()
    await Promise.resolve()
    await nextTick()
    expect(view.isSidebarAnimated()).toBe(true)

    expand.finish()
    await Promise.resolve()
    await nextTick()
    expect(view.isSidebarAnimated()).toBe(false)
  })

  it('clears the desktop transition when no grid animation starts or motion is reduced', async () => {
    const view = mountShell('right')
    view.props.sidebarCollapsed = true
    await nextTick()
    view.runAnimationFrames()
    await nextTick()
    expect(view.isSidebarAnimated()).toBe(false)

    view.reducedMotion.matches = true
    view.props.sidebarCollapsed = false
    await nextTick()
    expect(view.isSidebarAnimated()).toBe(false)
    expect(view.getAnimations).toHaveBeenCalledTimes(1)
  })

  it('lets the content reflow before opening a settled desktop rail', async () => {
    const view = mountShell('left')
    view.props.sidebarCollapsed = true
    await nextTick()
    view.runAnimationFrames()
    await nextTick()
    view.getAnimations.mockClear()

    const expand = createTransition()
    view.getAnimations.mockReturnValue([expand])
    view.props.sidebarCollapsed = false
    await nextTick()
    expect(view.isPreparingExpansion()).toBe(true)

    view.runAnimationFrames()
    await nextTick()
    expect(view.isPreparingExpansion()).toBe(false)
    expect(view.isSidebarAnimated()).toBe(true)
    expect(view.getAnimations).not.toHaveBeenCalled()

    view.runAnimationFrames()
    expand.finish()
    await Promise.resolve()
    await nextTick()
    expect(view.isSidebarAnimated()).toBe(false)
  })

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
