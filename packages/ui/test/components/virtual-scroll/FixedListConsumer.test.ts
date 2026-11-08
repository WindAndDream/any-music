import { writeFileSync } from 'node:fs'

import { describe, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick, onScopeDispose, shallowRef } from 'vue'

import {
  createVirtualCollectionFixture,
  virtualCollectionSizes,
} from '../../fixtures/virtual-scroll/collection-data'
import { FixedListConsumer } from '../../fixtures/virtual-scroll/fixed-list-consumer'
import type { FixedListFixtureItem } from '../../fixtures/virtual-scroll/fixed-list-consumer'
import {
  createResizeEnvironment,
  VirtualElement,
} from '../../fixtures/virtual-scroll/resize-observer'
import { findCatalogElement, mountCatalogComponent } from '../music-sources/catalog-test-renderer'
import type { CatalogTestElement } from '../music-sources/catalog-test-renderer'

const samples: {
  count: number
  mountedCards: number
  hostElements: number
  releasedCards: number
}[] = []
function countElements(root: CatalogTestElement): number {
  return (
    (root.tag === 'root' || root.tag.startsWith('#') ? 0 : 1) +
    root.children.reduce((sum, child) => sum + countElements(child), 0)
  )
}
function rows(root: CatalogTestElement): CatalogTestElement[] {
  return root.children.flatMap((node) => (node.tag === 'li' ? [node] : rows(node)))
}
function setupConsumer(count: number) {
  const env = createResizeEnvironment()
  const root = new VirtualElement(env.document),
    list = new VirtualElement(env.document)
  root.scrollTop = 0
  root.clientHeight = 100
  list.rect.top = 12
  const items = shallowRef(
    createVirtualCollectionFixture(count).occurrences.map((item) => ({
      key: item.occurrenceKey,
      title: item.track.title,
    })),
  )
  const itemSize = shallowRef(20)
  const mount = vi.fn(),
    release = vi.fn()
  const card = defineComponent({
    props: ['item'],
    setup(props) {
      mount()
      onScopeDispose(release)
      return () => h('article', { 'data-card': props.item.key }, props.item.title)
    },
  })
  const view = mountCatalogComponent(
    defineComponent({
      setup: () => () =>
        h(
          FixedListConsumer,
          {
            items: items.value,
            itemSize: itemSize.value,
            scrollElement: root.asElement(),
            listElement: list.asElement(),
          },
          { default: ({ item }: { item: FixedListFixtureItem }) => h(card, { item }) },
        ),
    }),
    {},
  )
  return { ...env, ...view, scrollRoot: root, items, itemSize, mount, release }
}

describe('fixed list rendering consumer (Node renderer, no CSS layout or browser)', () => {
  it.each(virtualCollectionSizes)(
    'allocates only the window and disposes card resources for %i items',
    (count) => {
      const view = setupConsumer(count)
      const sample = {
        count,
        mountedCards: view.mount.mock.calls.length,
        hostElements: countElements(view.root),
        releasedCards: 0,
      }
      try {
        const mountedRows = rows(view.root)
        expect(mountedRows).toHaveLength(Math.min(count, 7))
        expect(view.mount).toHaveBeenCalledTimes(mountedRows.length)
        const list = findCatalogElement(view.root, (node) => node.tag === 'ol')
        expect(list.props['data-logical-count']).toBe(count)
        expect(list.props.style).toMatchObject({ height: `${20 * count}px` })
        for (const [index, row] of mountedRows.entries()) {
          expect(row.parent).toBe(list)
          expect(row.props['aria-setsize']).toBe(count)
          expect(row.props['aria-posinset']).toBe(index + 1)
          expect(row.props.style).toMatchObject({ top: `${index * 20}px`, height: '20px' })
        }
        // These are mounted resource scopes/host nodes, not a simulated FPS measurement.
        expect(view.observers[0]!.observe).toHaveBeenCalledTimes(2)
      } finally {
        view.unmount()
      }
      expect(view.release).toHaveBeenCalledTimes(view.mount.mock.calls.length)
      sample.releasedCards = view.release.mock.calls.length
      samples.push(sample)
      if (
        samples.length === virtualCollectionSizes.length &&
        process.env.AM_FIXED_LIST_BASELINE_OUTPUT
      ) {
        writeFileSync(
          process.env.AM_FIXED_LIST_BASELINE_OUTPUT,
          `${JSON.stringify(
            {
              method:
                'Vue Node custom renderer; real FixedListConsumer using useFixedVirtualList and the installed engine, 100px injected viewport, 20px fixed rows, overscan 2; native ol/li with resource-owning slot cards. No browser/CSS layout/image decode/frame timing; not a full product or same-skin DOM comparison to P03.',
              samples,
            },
            null,
            2,
          )}\n`,
        )
      }
      expect(view.observers.every((observer) => observer.disconnect.mock.calls.length === 1)).toBe(
        true,
      )
    },
  )

  it('preserves overlapping keyed nodes/resources through scroll, controlled reorder and size changes', async () => {
    const view = setupConsumer(10_000)
    try {
      const original = new Map(rows(view.root).map((row) => [row.props['data-occurrence'], row]))
      const previous = view.items.value
      view.items.value = [previous[1]!, previous[0]!, ...previous.slice(2)]
      await nextTick()
      for (const row of rows(view.root))
        expect(row).toBe(original.get(row.props['data-occurrence']))
      expect(view.mount).toHaveBeenCalledTimes(7)
      expect(view.release).not.toHaveBeenCalled()
      view.itemSize.value = 10
      await nextTick()
      expect(rows(view.root)).toHaveLength(12)
      for (const row of rows(view.root).slice(0, 7))
        expect(row).toBe(original.get(row.props['data-occurrence']))
      view.scrollRoot.scrollTop = 30
      view.scrollRoot.dispatchEvent(new Event('scroll'))
      await nextTick()
      const current = rows(view.root)
      expect(current).toHaveLength(14)
      expect(current[0]!.props['aria-posinset']).toBe(2)
      expect(current[0]!).toBe(original.get(previous[0]!.key))
      expect(view.release).toHaveBeenCalledTimes(1)
      view.scrollRoot.scrollTop = 99_900
      view.scrollRoot.dispatchEvent(new Event('scroll'))
      await nextTick()
      expect(rows(view.root)).toHaveLength(12)
      expect(rows(view.root).at(-1)!.props['aria-posinset']).toBe(10_000)
      expect(view.mount.mock.calls.length - view.release.mock.calls.length).toBe(12)
    } finally {
      view.unmount()
    }
    expect(view.release).toHaveBeenCalledTimes(view.mount.mock.calls.length)
  })
})
