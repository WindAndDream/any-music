import { writeFileSync } from 'node:fs'

import { describe, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick, onScopeDispose, ref } from 'vue'

import { virtualCollectionSizes } from '../../fixtures/virtual-scroll/collection-data'
import { MeasuredListConsumer } from '../../fixtures/virtual-scroll/measured-list-consumer'
import {
  createResizeEnvironment,
  VirtualElement,
} from '../../fixtures/virtual-scroll/resize-observer'
import { findCatalogElement, mountCatalogComponent } from '../music-sources/catalog-test-renderer'
import type { CatalogTestElement } from '../music-sources/catalog-test-renderer'

function rows(node: CatalogTestElement): CatalogTestElement[] {
  return node.children.flatMap((child) => (child.tag === 'li' ? [child] : rows(child)))
}
async function settle() {
  await nextTick()
  await nextTick()
  await nextTick()
}

function setup(count: number) {
  const env = createResizeEnvironment()
  const root = new VirtualElement(env.document),
    list = new VirtualElement(env.document)
  root.scrollTop = 0
  root.clientHeight = 100
  list.rect.top = 12
  const items = ref(
    Array.from({ length: count }, (_, key) => ({
      key: String(key),
      title: `Title ${key}`,
      revision: 0,
    })),
  )
  const elements = new Map<string, VirtualElement>()
  const mount = vi.fn(),
    release = vi.fn()
  const Card = defineComponent({
    setup() {
      mount()
      onScopeDispose(release)
      return () => h('article', 'Natural card')
    },
  })
  const view = mountCatalogComponent(
    defineComponent({
      setup: () => () =>
        h(
          MeasuredListConsumer,
          {
            items: items.value,
            scrollElement: root.asElement(),
            listElement: list.asElement(),
            measurementElement: (key: string) => {
              const target = new VirtualElement(env.document)
              target.rect.height = 20
              elements.set(key, target)
              return target.asElement()
            },
          },
          { default: () => h(Card) },
        ),
    }),
    {},
  )
  return { ...env, ...view, scrollRoot: root, list, items, elements, mount, release }
}

const samples: {
  count: number
  mounted: number
  observed: number
  cached: number
  released: number
}[] = []

describe('natural-height measured consumer (Node renderer; injected rects, no CSS layout)', () => {
  it.each(virtualCollectionSizes)(
    'observes only mounted units and releases their resources for %i items',
    async (count) => {
      const view = setup(count)
      await settle()
      const sample = {
        count,
        mounted: rows(view.root).length,
        observed: view.observers[0]!.observe.mock.calls.length,
        cached: 0,
        released: 0,
      }
      try {
        const list = findCatalogElement(view.root, (node) => node.tag === 'ol')
        expect(rows(view.root)).toHaveLength(Math.min(count, 7))
        expect(sample.observed).toBe(Math.min(count, 7) + 2)
        expect(view.observers).toHaveLength(1)
        expect(list.props['data-logical-count']).toBe(count)
        sample.cached = Number(list.props['data-cached-heights'])
        expect(sample.cached).toBe(Math.min(count, 7))
        for (const [index, row] of rows(view.root).entries()) {
          expect(row.parent).toBe(list)
          expect(row.props.style).toMatchObject({ top: `${index * 20}px` })
          expect(row.props.style).not.toHaveProperty('height')
          expect(row.props.style).not.toHaveProperty('minHeight')
          expect(row.props['aria-setsize']).toBe(count)
        }
      } finally {
        view.unmount()
      }
      sample.released = view.release.mock.calls.length
      expect(sample.released).toBe(view.mount.mock.calls.length)
      expect(view.observers.every((observer) => observer.disconnect.mock.calls.length === 1)).toBe(
        true,
      )
      samples.push(sample)
      if (
        samples.length === virtualCollectionSizes.length &&
        process.env.AM_MEASURED_LIST_BASELINE_OUTPUT
      )
        writeFileSync(
          process.env.AM_MEASURED_LIST_BASELINE_OUTPUT,
          `${JSON.stringify(
            {
              method:
                'Vue Node keyed MeasuredListConsumer with installed engine; 100px injected viewport, 20px injected natural border boxes, overscan 2, cache limit 32; ol/li semantics and resource-owning slot cards. No browser/CSS layout/image decode/frame timing. Scope counts refer to slot cards only.',
              samples,
            },
            null,
            2,
          )}\n`,
        )
    },
  )

  it('preserves overlapping keyed resources through edits/reorder and unobserves offscreen units during long visits', async () => {
    const view = setup(10_000)
    await settle()
    try {
      const first = view.elements.get('0')!
      first.rect.height = 40
      view.observers[0]!.notify([first.asElement()])
      await settle()
      expect(rows(view.root)[1]!.props.style).toMatchObject({ top: '40px' })
      first.rect.height = 10
      view.items.value[0]!.revision++
      await settle()
      expect(rows(view.root)[1]!.props.style).toMatchObject({ top: '10px' })
      const original = new Map(rows(view.root).map((row) => [row.props['data-occurrence'], row]))
      const previous = view.items.value
      view.items.value = [previous[1]!, previous[0]!, ...previous.slice(2)]
      await settle()
      for (const row of rows(view.root))
        expect(row === original.get(row.props['data-occurrence'])).toBe(true)
      for (const offset of [20_000, 80_000, 150_000, 0]) {
        view.scrollRoot.scrollTop = offset
        view.scrollRoot.dispatchEvent(new Event('scroll'))
        // eslint-disable-next-line no-await-in-loop -- Verify allocation and teardown after each committed distant window.
        await settle()
        const mounted = rows(view.root).length
        expect(mounted).toBeLessThanOrEqual(10)
        expect(view.mount.mock.calls.length - view.release.mock.calls.length).toBe(mounted)
        const pool = view.observers[0]!
        expect(pool.observe.mock.calls.length - pool.unobserve.mock.calls.length).toBe(mounted + 2)
        expect(
          Number(
            findCatalogElement(view.root, (node) => node.tag === 'ol').props['data-cached-heights'],
          ),
        ).toBeLessThanOrEqual(32)
      }
    } finally {
      view.unmount()
    }
    expect(view.release).toHaveBeenCalledTimes(view.mount.mock.calls.length)
  })
})
