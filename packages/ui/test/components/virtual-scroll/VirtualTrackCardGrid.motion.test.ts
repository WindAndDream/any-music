import { afterEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick, shallowRef } from 'vue'
import type { Component, VNode } from 'vue'

import type { CatalogTrackDisplayMode } from '../../../src/components/music-sources/catalog-track-display-mode'
import VirtualTrackCardGrid from '../../../src/components/virtual-scroll/VirtualTrackCardGrid.vue'
import { mountVirtualGridComponent } from '../../fixtures/virtual-scroll/grid-test-renderer'
import {
  createResizeEnvironment,
  VirtualElement,
} from '../../fixtures/virtual-scroll/resize-observer'
import { findCatalogElement } from '../music-sources/catalog-test-renderer'
import type { CatalogTestElement } from '../music-sources/catalog-test-renderer'

const cleanups: (() => void)[] = []
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup()
})

async function settle() {
  await nextTick()
  await nextTick()
  await nextTick()
  await nextTick()
}

async function setup(count = 10_000, naturalHeight = 20) {
  const env = createResizeEnvironment()
  const scroll = new VirtualElement(env.document)
  scroll.clientHeight = 100
  scroll.scrollTop = 0
  const media = Object.assign(new EventTarget(), { matches: false })
  const view = Object.assign(env.view, {
    matchMedia: () => media,
    getComputedStyle: () => ({
      gridTemplateColumns: '300px 300px 300px',
      rowGap: '12px',
      columnGap: '12px',
      getPropertyValue: (name: string) => (name === '--am-motion-normal' ? '220ms' : 'ease'),
    }),
  })
  const items = shallowRef(
    Array.from({ length: count }, (_, index) => ({ key: `occurrence:${index}`, revision: 0 })),
  )
  const displayMode = shallowRef<CatalogTrackDisplayMode>('standard')
  const animate = vi.fn(function (
    this: { key: string },
    _frames: Keyframe[],
    _options: KeyframeAnimationOptions,
  ) {
    const cancel = vi.fn()
    const animation = Object.assign(new EventTarget(), { cancel }) as unknown as Animation
    events.push({ key: this.key, cancel })
    return animation
  })
  const reads = vi.fn((cell: CatalogTestElement) => {
    const position = Number(cell.props['aria-posinset']) - 1
    // Attribute changes reflow CSS during the patch, before the post-render layout reader.
    // These boxes deliberately model that timing, rather than using the requested prop.
    const compact = cell.parent?.getAttribute('data-display-mode') === 'compact'
    return {
      left: (position % 3) * (compact ? 240 : 300),
      top: 12 + Math.floor(position / 3) * (compact ? 24 : 32) - scroll.scrollTop,
    }
  })
  const events: { key: string; cancel: ReturnType<typeof vi.fn> }[] = []
  const mounted = mountVirtualGridComponent(
    defineComponent({
      setup: () => () =>
        h(
          VirtualTrackCardGrid as unknown as Component,
          {
            items: items.value,
            getItemKey: (item: { key: string }) => item.key,
            getContentGeneration: (item: { revision: number }) => item.revision,
            estimatedItemSize: 20,
            scrollElement: scroll.asElement(),
            displayMode: displayMode.value,
            mobileColumns: 1,
            cacheLimit: 32,
          },
          {
            default: () =>
              h(
                'article',
                {
                  onVnodeMounted: (node: VNode) => {
                    const natural = (node.el as unknown as CatalogTestElement).parent?.parent
                      ?.parent
                    Object.assign(natural!, {
                      getBoundingClientRect: () =>
                        ({ top: 12, left: 0, width: 300, height: naturalHeight }) as DOMRect,
                    })
                  },
                },
                'Natural card',
              ),
          },
        ),
    }),
    env.document,
  )
  cleanups.push(mounted.unmount)
  await settle()
  const list = findCatalogElement(mounted.root, (node) => node.props.role === 'list')
  function attachAnimationTargets() {
    for (const cell of list.children) {
      if (cell.props.role !== 'listitem') continue
      const natural = cell.children[0]!
      const flip = natural.children[0]!
      Object.assign(flip, {
        key: cell.props['data-occurrence'],
        animate,
        getBoundingClientRect: () => reads(cell),
      })
    }
  }
  attachAnimationTargets()
  return {
    ...mounted,
    ...env,
    view,
    list,
    items,
    displayMode,
    media,
    scroll,
    reads,
    animate,
    events,
    attachAnimationTargets,
  }
}

describe('controlled virtual grid FLIP composition (installed engine; injected boxes)', () => {
  it('reads no motion boxes when newly mounted natural heights differ from their estimates', async () => {
    const grid = await setup(10_000, 60)
    for (const offset of [20_000, 50_000, 0]) {
      grid.scroll.scrollTop = offset
      grid.scroll.dispatchEvent(new Event('scroll'))
      // eslint-disable-next-line no-await-in-loop -- Test complete window entry and cache eviction in both directions.
      await settle()
      grid.attachAnimationTargets()
      expect(
        grid.list.children.filter((cell) => cell.props.role === 'listitem').length,
      ).toBeLessThanOrEqual(24)
      expect(grid.reads).not.toHaveBeenCalled()
      expect(grid.animate).not.toHaveBeenCalled()
    }
  })

  it('does not animate the estimate round trip of taller natural cards during width changes', async () => {
    const grid = await setup(6)
    const natural = grid.list.children
      .filter((cell) => cell.props.role === 'listitem')
      .map((cell) => cell.children[0]!)
    for (const element of natural)
      Object.assign(element, {
        getBoundingClientRect: () => ({ top: 12, left: 0, width: 300, height: 60 }) as DOMRect,
      })
    grid.observers[0]!.notify(natural as unknown as Element[])
    await settle()
    grid.reads.mockClear()
    grid.animate.mockClear()
    for (const width of [980, 940, 900, 960, 1000]) {
      Object.assign(grid.list, {
        getBoundingClientRect: () => ({ top: 12, left: 0, width, height: 20 }) as DOMRect,
      })
      grid.observers[0]!.notify([grid.list as unknown as Element])
      // eslint-disable-next-line no-await-in-loop -- Each frame must avoid intermediate-estimate animation.
      await settle()
      expect(grid.reads).not.toHaveBeenCalled()
      expect(grid.animate).not.toHaveBeenCalled()
    }
  })

  it('lets CSS resize equal-height rows without reading or restarting FLIP on every width frame', async () => {
    const grid = await setup()
    for (const width of [980, 940, 900, 960, 1000]) {
      Object.assign(grid.list, {
        getBoundingClientRect: () => ({ top: 12, left: 0, width, height: 20 }) as DOMRect,
      })
      grid.observers[0]!.notify([grid.list as unknown as Element])
      // eslint-disable-next-line no-await-in-loop -- Each settled frame must keep mounted FLIP work at zero.
      await settle()
      expect(grid.reads).not.toHaveBeenCalled()
      expect(grid.animate).not.toHaveBeenCalled()
    }
    // Column changes still flow through actual row geometry and animate the intersection.
    const style = grid.view.getComputedStyle
    grid.view.getComputedStyle = () => ({ ...style(), gridTemplateColumns: '440px 440px' })
    Object.assign(grid.list, {
      getBoundingClientRect: () => ({ top: 12, left: 0, width: 880, height: 20 }) as DOMRect,
    })
    grid.observers[0]!.notify([grid.list as unknown as Element])
    await settle()
    expect(grid.reads).toHaveBeenCalled()
  })

  it('captures density changes before their DOM attributes reflow CSS', async () => {
    const grid = await setup()
    grid.displayMode.value = 'compact'
    await settle()
    expect(grid.animate).toHaveBeenCalled()
    const second = grid.animate.mock.contexts.findIndex(({ key }) => key === 'occurrence:1')
    expect(grid.animate.mock.calls[second]?.[0]).toEqual([
      { transform: 'translate(60px, 0px)' },
      { transform: 'translate(0, 0)' },
    ])
    expect(grid.reads.mock.calls.length).toBeLessThanOrEqual(36)
  })

  it('animates actual stable-key moves, while metadata replacement and distant scrolling read no motion boxes', async () => {
    const grid = await setup()
    const first = grid.list.children.find(
      (cell) => cell.props['data-occurrence'] === 'occurrence:0',
    )!
    const flip = first.children[0]!.children[0]!
    grid.items.value = grid.items.value.map((item) => ({ ...item, revision: 1 }))
    await settle()
    expect(grid.reads).not.toHaveBeenCalled()
    expect(grid.animate).not.toHaveBeenCalled()
    const previous = grid.items.value
    grid.items.value = [previous[1]!, previous[0]!, ...previous.slice(2)]
    await settle()
    expect(
      grid.list.children.find((cell) => cell.props['data-occurrence'] === 'occurrence:0'),
    ).toBe(first)
    expect(first.children[0]!.children[0]).toBe(flip)
    expect(grid.animate).toHaveBeenCalledTimes(2)
    expect(grid.animate.mock.contexts).toContain(flip)
    expect(grid.animate).toHaveBeenCalledWith(
      [{ transform: 'translate(-300px, 0px)' }, { transform: 'translate(0, 0)' }],
      { duration: 220, easing: 'ease' },
    )
    expect(grid.reads.mock.calls.length).toBeLessThanOrEqual(36)
    grid.reads.mockClear()
    grid.animate.mockClear()
    grid.scroll.scrollTop = 20_000
    grid.scroll.dispatchEvent(new Event('scroll'))
    await settle()
    expect(
      grid.list.children.filter((cell) => cell.props.role === 'listitem').length,
    ).toBeLessThanOrEqual(24)
    expect(grid.reads).not.toHaveBeenCalled()
    expect(grid.animate).not.toHaveBeenCalled()
    for (const { cancel } of grid.events) expect(cancel).toHaveBeenCalledOnce()
    grid.attachAnimationTargets()
    grid.items.value = grid.items.value.map((item) => ({ ...item, revision: item.revision + 1 }))
    await settle()
    expect(grid.reads).not.toHaveBeenCalled()
  })

  it('excludes entering keys after removal, and honors landing and live reduced-motion cancellation', async () => {
    const grid = await setup()
    grid.items.value = grid.items.value.slice(1)
    await settle()
    expect(grid.animate).toHaveBeenCalled()
    expect(
      grid.animate.mock.contexts.every(({ key }) =>
        grid.reads.mock.calls.some(([cell]) => cell.props['data-occurrence'] === key),
      ),
    ).toBe(true)
    const previousAnimations = [...grid.events]
    const landing = grid.list.children.find((cell) => cell.props.role === 'listitem')!
    landing.setAttribute('data-am-grid-landing', '')
    grid.reads.mockClear()
    grid.animate.mockClear()
    const previous = grid.items.value
    grid.items.value = [previous[1]!, previous[0]!, ...previous.slice(2)]
    await settle()
    for (const { cancel } of previousAnimations) expect(cancel).toHaveBeenCalledOnce()
    expect(grid.reads).not.toHaveBeenCalled()
    expect(grid.animate).not.toHaveBeenCalled()
    landing.removeAttribute('data-am-grid-landing')
    grid.items.value = previous
    await settle()
    expect(grid.animate).toHaveBeenCalledTimes(2)
    const currentAnimations = grid.events.slice(previousAnimations.length)
    grid.media.matches = true
    grid.media.dispatchEvent(new Event('change'))
    for (const { cancel } of currentAnimations) expect(cancel).toHaveBeenCalledOnce()
    grid.reads.mockClear()
    grid.animate.mockClear()
    grid.items.value = [...previous.slice(1), previous[0]!]
    await settle()
    expect(grid.reads).not.toHaveBeenCalled()
    expect(grid.animate).not.toHaveBeenCalled()
  })
})
