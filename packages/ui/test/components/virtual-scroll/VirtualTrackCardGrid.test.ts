import { readFileSync, writeFileSync } from 'node:fs'

import { describe, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick, onScopeDispose, shallowRef } from 'vue'
import type { Component, CSSProperties } from 'vue'

import type { CatalogTrackDisplayMode } from '../../../src/components/music-sources/catalog-track-display-mode'
import VirtualTrackCardGrid from '../../../src/components/virtual-scroll/VirtualTrackCardGrid.vue'
import type { useVirtualItemRetention } from '../../../src/composables/virtual-scroll/use-virtual-item-retention'
import { virtualCollectionSizes } from '../../fixtures/virtual-scroll/collection-data'
import { mountVirtualGridComponent } from '../../fixtures/virtual-scroll/grid-test-renderer'
import {
  createResizeEnvironment,
  VirtualElement,
} from '../../fixtures/virtual-scroll/resize-observer'
import { findCatalogElement, type CatalogTestElement } from '../music-sources/catalog-test-renderer'

async function settle() {
  await nextTick()
  await nextTick()
  await nextTick()
  await nextTick()
}
function cells(node: CatalogTestElement): CatalogTestElement[] {
  return node.children.flatMap((child) =>
    child.props.role === 'listitem' ? [child] : cells(child),
  )
}

function setup(count: number, withReorder = false, withInteraction = false, withAnchor = false) {
  const env = createResizeEnvironment()
  const root = new VirtualElement(env.document)
  root.clientHeight = 100
  root.scrollTop = 0
  const scrollElement = shallowRef(root.asElement())
  const columns = shallowRef(3),
    gap = shallowRef(12)
  const displayMode = shallowRef<CatalogTrackDisplayMode>('standard'),
    mobileColumns = shallowRef<1 | 2>(1)
  const getComputedStyle = vi.fn(() => ({
    gridTemplateColumns: Array(columns.value).fill('300px').join(' '),
    columnGap: `${gap.value}px`,
    rowGap: `${gap.value}px`,
  }))
  Object.assign(env.view, { getComputedStyle })
  const items = shallowRef(
    Array.from({ length: count }, (_, key) => ({ key: String(key), revision: 0 })),
  )
  const retainedKeys = shallowRef<readonly string[]>([])
  const reorderEnabled = shallowRef(withReorder)
  const interactionEnabled = shallowRef(withInteraction)
  const grid = shallowRef<{ retention?: ReturnType<typeof useVirtualItemRetention> }>()
  const motionStyles = shallowRef<ReadonlyMap<string, CSSProperties>>(new Map())
  const mount = vi.fn(),
    release = vi.fn()
  const Card = defineComponent({
    setup() {
      mount()
      onScopeDispose(release)
      return () => h('article', { class: 'track-card' }, 'Natural card')
    },
  })
  const view = mountVirtualGridComponent(
    defineComponent({
      setup: () => () =>
        h(
          // Vue's generic-SFC type carries required slots that Node h() does not model.
          VirtualTrackCardGrid as unknown as Component,
          {
            ref: (value: unknown) => {
              grid.value = value as typeof grid.value
            },
            items: items.value,
            getItemKey: (item: { key: string }) => item.key,
            getContentGeneration: (item: { revision: number }) => item.revision,
            estimatedItemSize: 20,
            scrollElement: scrollElement.value,
            displayMode: displayMode.value,
            mobileColumns: mobileColumns.value,
            cacheLimit: 32,
            retainedIndexes: retainedKeys.value.map((key) =>
              items.value.findIndex((item) => item.key === key),
            ),
            interaction: interactionEnabled.value,
            anchor: withAnchor,
            reorder: reorderEnabled.value
              ? {
                  attributePrefix: 'test',
                  kind: 'track',
                  getItemId: (row: { key: string | number }) => String(row.key),
                  getItemStyle: (id: string) => motionStyles.value.get(id),
                }
              : undefined,
          },
          { default: () => h(Card) },
        ),
    }),
    env.document,
  )
  return {
    ...env,
    ...view,
    scrollRoot: root,
    scrollElement,
    columns,
    gap,
    displayMode,
    mobileColumns,
    items,
    mount,
    release,
    getComputedStyle,
    retainedKeys,
    reorderEnabled,
    motionStyles,
    interactionEnabled,
    grid,
  }
}

const samples: { count: number; mounted: number; observed: number; released: number }[] = []

describe('controlled virtual track grid (Node renderer; injected natural boxes and resolved CSS)', () => {
  it('keeps the scrolled viewport fixed through reorder commit and landing retention', async () => {
    const test = setup(80, true, true, true)
    await settle()
    try {
      test.scrollRoot.scrollTop = 500
      test.scrollRoot.dispatchEvent(new Event('scroll'))
      await settle()
      const retention = test.grid.value!.retention!
      const source = retention.retain('0', 'reorder')!
      const destination = retention.retain('48', 'reorder')!
      test.items.value = test.items.value.toReversed()
      await settle()
      expect(test.scrollRoot.scrollTop).toBe(500)
      destination()
      await settle()
      expect(test.scrollRoot.scrollTop).toBe(500)
      source()
      await settle()
      expect(test.scrollRoot.scrollTop).toBe(500)
    } finally {
      test.unmount()
    }
  })

  it('changes the live DOM budget with viewport height and resolved columns, then shrinks again', async () => {
    const test = setup(1000)
    await settle()
    try {
      const initial = cells(test.root).length
      for (const [height, columns] of [
        [300, 4],
        [80, 1],
        [100, 3],
      ] as const) {
        test.scrollRoot.clientHeight = height
        test.columns.value = columns
        test.view.dispatchEvent(new Event('resize'))
        // eslint-disable-next-line no-await-in-loop -- Inspect each independent resize and its cleanup.
        await settle()
        const current = cells(test.root).length
        expect(current).toBeLessThanOrEqual((Math.ceil(height / 32) + 5) * columns)
        if (height === 300) expect(current).toBeGreaterThan(initial)
        if (height === 80) expect(current).toBeLessThan(initial)
        expect(test.mount.mock.calls.length - test.release.mock.calls.length).toBe(current)
      }
      expect(cells(test.root)).toHaveLength(initial)
    } finally {
      test.unmount()
    }
  })

  it.each(virtualCollectionSizes)(
    'keeps live DOM, slot scopes and observations bounded after visiting %i occurrences',
    async (count) => {
      const test = setup(count)
      await settle()
      try {
        const initial = cells(test.root).map((cell) => cell.props['data-occurrence'])
        const end = Math.max(0, 12 + Math.ceil(count / 3) * 32 - test.scrollRoot.clientHeight)
        const visited = new Set<CatalogTestElement>()
        for (const fraction of [0, 0.25, 0.5, 0.75, 1, 0.75, 0.5, 0.25, 0]) {
          test.scrollRoot.scrollTop = end * fraction
          test.scrollRoot.dispatchEvent(new Event('scroll'))
          // eslint-disable-next-line no-await-in-loop -- Distinguish cumulative mounts from live scopes at each window.
          await settle()
          const current = cells(test.root)
          for (const cell of current) visited.add(cell)
          expect(current.length).toBeLessThanOrEqual(30)
          expect([...visited].filter((cell) => cell.parent !== null)).toHaveLength(current.length)
          expect(test.mount.mock.calls.length - test.release.mock.calls.length).toBe(current.length)
          const observer = test.observers[0]!
          expect(observer.observe.mock.calls.length - observer.unobserve.mock.calls.length).toBe(
            current.length + 2,
          )
        }
        expect(cells(test.root).map((cell) => cell.props['data-occurrence'])).toEqual(initial)
        if (count >= 80) expect(visited.size).toBeGreaterThan(initial.length)
      } finally {
        test.unmount()
      }
      expect(test.release).toHaveBeenCalledTimes(test.mount.mock.calls.length)
    },
  )

  it('reflows stable cells when resolved styles include stale implicit columns during shrink', async () => {
    const test = setup(1000)
    await settle()
    try {
      const first = cells(test.root)[0]!
      test.getComputedStyle.mockImplementation(() => {
        const columns = test.columns.value
        const previousColumns = Math.max(
          0,
          ...cells(test.root).map(
            (cell) => (cell.props.style as { gridColumnStart: number }).gridColumnStart,
          ),
        )
        return {
          gridTemplateColumns: [
            ...Array(columns).fill('300px'),
            ...Array(Math.max(0, previousColumns - columns)).fill('0px'),
          ].join(' '),
          gridAutoColumns: '0px',
          columnGap: '12px',
          rowGap: '12px',
        }
      })
      for (const columns of [5, 3, 1, 2, 5]) {
        test.columns.value = columns
        test.view.dispatchEvent(new Event('resize'))
        // eslint-disable-next-line no-await-in-loop -- Each resize must commit before the next one.
        await settle()
        expect(cells(test.root)[0]).toBe(first)
        for (const cell of cells(test.root)) {
          const index = Number(cell.props['aria-posinset']) - 1
          expect((cell.props.style as { gridColumnStart: number }).gridColumnStart).toBe(
            (index % columns) + 1,
          )
        }
      }
    } finally {
      test.unmount()
    }
  })

  it.each(['replacement', 'hidden-return'])(
    'keeps stable-cell interaction after %s of the scroll root',
    async (change) => {
      const test = setup(1000, false, true)
      await settle()
      try {
        const source = cells(test.root)[0]!
        const replacement =
          change === 'replacement' ? new VirtualElement(test.document) : test.scrollRoot
        replacement.clientHeight = 100
        replacement.scrollTop = 0
        if (change === 'replacement') test.scrollElement.value = replacement.asElement()
        else {
          replacement.clientHeight = 0
          test.observers[0]!.notify([replacement.asElement()])
          replacement.clientHeight = 100
          test.observers[0]!.notify([replacement.asElement()])
        }
        await settle()
        expect(cells(test.root)).toContain(source)
        ;(source as unknown as EventTarget).dispatchEvent(new Event('focusin'))
        expect(test.grid.value!.retention!.retainedKeys.value).toEqual(['0'])
        replacement.scrollTop = 9000
        replacement.dispatchEvent(new Event('scroll'))
        await settle()
        expect(cells(test.root)).toContain(source)
        ;(source as unknown as EventTarget).dispatchEvent(new Event('focusout'))
        await settle()
        expect(cells(test.root)).not.toContain(source)
      } finally {
        test.unmount()
      }
    },
  )

  it('opts in to stable-cell focus/composition retention without keeping the intervening window', async () => {
    const test = setup(1000, false, true)
    await settle()
    try {
      const source = cells(test.root)[0]!
      const events = source as unknown as EventTarget
      events.dispatchEvent(new Event('focusin'))
      events.dispatchEvent(new Event('compositionstart'))
      expect(test.grid.value!.retention!.retainedKeys.value).toEqual(['0'])
      test.scrollRoot.scrollTop = 9000
      test.scrollRoot.dispatchEvent(new Event('scroll'))
      await settle()
      expect(cells(test.root)).toContain(source)
      expect(cells(test.root).length).toBeLessThan(30)
      events.dispatchEvent(new Event('focusout'))
      await settle()
      expect(cells(test.root)).toContain(source)
      events.dispatchEvent(new Event('compositionend'))
      await settle()
      expect(cells(test.root)).not.toContain(source)
      expect(test.grid.value!.retention!.retainedIndexes.value).toEqual([])
    } finally {
      test.unmount()
    }
  })

  it('combines explicit and interaction leases and drains opt-in listeners on disable/re-enable', async () => {
    const addListener = vi.spyOn(EventTarget.prototype, 'addEventListener')
    const removeListener = vi.spyOn(EventTarget.prototype, 'removeEventListener')
    const test = setup(1000)
    await settle()
    try {
      expect(test.grid.value!.retention).toBeUndefined()
      expect(addListener.mock.calls.filter(([type]) => type === 'focusin')).toHaveLength(0)
      test.interactionEnabled.value = true
      await settle()
      const registered = cells(test.root).length
      expect(addListener.mock.calls.filter(([type]) => type === 'focusin')).toHaveLength(registered)
      const retention = test.grid.value!.retention!
      const release = retention.retain('0', 'reorder')!
      test.retainedKeys.value = ['999']
      test.scrollRoot.scrollTop = 9000
      test.scrollRoot.dispatchEvent(new Event('scroll'))
      await settle()
      expect(cells(test.root).map((cell) => cell.props['data-occurrence'])).toEqual(
        expect.arrayContaining(['0', '999']),
      )
      test.interactionEnabled.value = false
      await settle()
      expect(test.grid.value!.retention).toBeUndefined()
      expect(retention.retainedKeys.value).toEqual([])
      expect(retention.retain('0', 'focus')).toBeUndefined()
      expect(removeListener.mock.calls.filter(([type]) => type === 'focusin').length).toBe(
        addListener.mock.calls.filter(([type]) => type === 'focusin').length,
      )
      expect(cells(test.root).map((cell) => cell.props['data-occurrence'])).not.toContain('0')
      expect(cells(test.root).map((cell) => cell.props['data-occurrence'])).toContain('999')
      release()
      test.interactionEnabled.value = true
      await settle()
      const next = test.grid.value!.retention!
      expect(next).not.toBe(retention)
      expect(next.retainedKeys.value).toEqual([])
      const source = cells(test.root)[0]!
      ;(source as unknown as EventTarget).dispatchEvent(new Event('focusin'))
      expect(next.retainedKeys.value).toEqual([source.props['data-occurrence']])
    } finally {
      test.unmount()
      addListener.mockRestore()
      removeListener.mockRestore()
    }
  })
  it.each(virtualCollectionSizes)(
    'bounds slot scopes and observations for %i occurrences',
    async (count) => {
      const test = setup(count)
      await settle()
      const sample = { count, mounted: cells(test.root).length, observed: 0, released: 0 }
      try {
        const list = findCatalogElement(test.root, (node) => node.props.role === 'list')
        expect(sample.mounted).toBe(Math.min(count, 18))
        expect(test.observers).toHaveLength(1)
        const observer = test.observers[0]!
        sample.observed = observer.observe.mock.calls.length - observer.unobserve.mock.calls.length
        expect(sample.observed).toBe(sample.mounted + 2)
        for (const cell of cells(test.root)) {
          expect(cell.parent).toBe(list)
          expect(cell.props.style).not.toHaveProperty('height')
          expect(cell.props.style).not.toHaveProperty('minHeight')
          expect(cell.props.style).not.toHaveProperty('transform')
          expect(cell.props['aria-setsize']).toBe(count)
        }
        expect(String(list.props.class)).toContain('list__items')
      } finally {
        test.unmount()
      }
      sample.released = test.release.mock.calls.length
      expect(sample.released).toBe(test.mount.mock.calls.length)
      expect(test.observers[0]!.disconnect).toHaveBeenCalledTimes(1)
      samples.push(sample)
      if (
        samples.length === virtualCollectionSizes.length &&
        process.env.AM_VIRTUAL_GRID_BASELINE_OUTPUT
      )
        writeFileSync(
          process.env.AM_VIRTUAL_GRID_BASELINE_OUTPUT,
          `${JSON.stringify({ method: 'Vue Node custom renderer of controlled VirtualTrackCardGrid; installed engine; 100px injected viewport, 20px natural cell boxes, three injected browser-resolved CSS columns, gap12, overscan2, cache32; flat keyed cells/resource-owning slot cards. No real CSS Grid/layout/image decode/frame timing/runtime acceptance.', samples }, null, 2)}\n`,
        )
    },
  )

  it('keeps overlapping cell/card nodes and scopes through density/mobile regrouping and reorder', async () => {
    const test = setup(1000)
    await settle()
    try {
      const original = new Map(
        cells(test.root).map((cell) => [cell.props['data-occurrence'], cell]),
      )
      for (const [mode, columns, mobile] of [
        ['compact', 4, 1],
        ['comfortable', 2, 1],
        ['standard', 2, 2],
        ['standard', 1, 1],
      ] as const) {
        test.displayMode.value = mode
        test.columns.value = columns
        test.mobileColumns.value = mobile
        test.gap.value = mobile === 2 ? 8 : 12
        test.view.dispatchEvent(new Event('resize'))
        // eslint-disable-next-line no-await-in-loop -- Check every committed responsive layout.
        await settle()
        for (const cell of cells(test.root)) {
          const previous = original.get(cell.props['data-occurrence'])
          if (previous) expect(cell).toBe(previous)
        }
      }
      const previous = test.items.value
      const first = cells(test.root)[0]!
      test.items.value = [previous[1]!, previous[0]!, ...previous.slice(2)]
      await settle()
      expect(cells(test.root)[1]).toBe(first)
      expect(test.mount.mock.calls.length - test.release.mock.calls.length).toBe(
        cells(test.root).length,
      )
      for (const offset of [10000, 20000, 0]) {
        test.scrollRoot.scrollTop = offset
        test.scrollRoot.dispatchEvent(new Event('scroll'))
        // eslint-disable-next-line no-await-in-loop -- Verify cleanup after each distant window.
        await settle()
        expect(cells(test.root).length).toBeLessThanOrEqual(10)
        const pool = test.observers[0]!
        expect(pool.observe.mock.calls.length - pool.unobserve.mock.calls.length).toBe(
          cells(test.root).length + 2,
        )
      }
    } finally {
      test.unmount()
    }
    expect(test.release).toHaveBeenCalledTimes(test.mount.mock.calls.length)
  })

  it('keeps virtual placement and natural measurement outside the controlled motion surface', async () => {
    const test = setup(80, true)
    const style: CSSProperties = {
      transform: 'translate3d(12px, 90px, 0) scale(1.03)',
      transition: 'none',
      contentVisibility: 'visible',
    }
    test.motionStyles.value = new Map([['0', style]])
    await settle()
    try {
      const source = cells(test.root)[0]!
      const natural = source.children[0]!
      const flip = natural.children[0]!
      const motion = flip.children[0]!
      const card = findCatalogElement(motion, (node) => node.tag === 'article')
      expect(source.props['data-test-drop-kind']).toBe('track')
      expect(source.props['data-test-drop-id']).toBe('0')
      expect(source.props.style).not.toHaveProperty('transform')
      expect(natural.props.style).toBeUndefined()
      expect(natural.props['data-am-grid-motion']).toBeUndefined()
      expect(flip.props.style).toBeUndefined()
      expect(flip.props['data-am-grid-motion']).toBeUndefined()
      expect(motion.props['data-am-grid-motion']).toBe('')
      expect(motion.props.style).toEqual(style)
      const observed = test.observers[0]!.observe.mock.calls.map(([element]) => element)
      expect(observed).toContain(natural)
      expect(observed).not.toContain(motion)
      expect(observed).not.toContain(flip)
      expect(card.tag).toBe('article')

      test.motionStyles.value = new Map([['0', { contentVisibility: 'visible' }]])
      await settle()
      expect(cells(test.root)[0]).toBe(source)
      expect(natural.children[0]).toBe(flip)
      expect(flip.children[0]).toBe(motion)
      expect(findCatalogElement(motion, (node) => node.tag === 'article')).toBe(card)
      expect(motion.props.style).toEqual({ contentVisibility: 'visible' })
      test.reorderEnabled.value = false
      await settle()
      expect(cells(test.root)[0]).toBe(source)
      expect(source.props['data-test-drop-id']).toBeNull()
      expect(source.props['data-test-drop-kind']).toBeNull()
      expect(motion.props['data-am-grid-motion']).toBeUndefined()
      expect(motion.props.style).toBeUndefined()
      expect(findCatalogElement(motion, (node) => node.tag === 'article')).toBe(card)
    } finally {
      test.unmount()
    }
    expect(test.release).toHaveBeenCalledTimes(test.mount.mock.calls.length)
    expect(test.observers[0]!.disconnect).toHaveBeenCalledExactlyOnceWith()
  })

  it('retains one source/card across a distant window and its controlled landing position', async () => {
    const test = setup(1000, true)
    await settle()
    try {
      const source = cells(test.root)[0]!
      const motion = source.children[0]!.children[0]!.children[0]!
      const card = findCatalogElement(motion, (node) => node.tag === 'article')
      test.retainedKeys.value = ['0']
      test.motionStyles.value = new Map([['0', { transform: 'translate3d(0, 5000px, 0)' }]])
      test.scrollRoot.scrollTop = 5000
      test.scrollRoot.dispatchEvent(new Event('scroll'))
      await settle()
      expect(cells(test.root).filter((cell) => cell.props['data-occurrence'] === '0')).toEqual([
        source,
      ])
      expect(findCatalogElement(motion, (node) => node.tag === 'article')).toBe(card)
      expect(cells(test.root).length).toBeLessThanOrEqual(30)
      expect(source.props.style).not.toHaveProperty('transform')

      const previous = test.items.value
      test.items.value = [...previous.slice(1, 501), previous[0]!, ...previous.slice(501)]
      await settle()
      expect(cells(test.root).find((cell) => cell.props['data-occurrence'] === '0')).toBe(source)
      expect(source.props['aria-posinset']).toBe(501)
      expect(findCatalogElement(motion, (node) => node.tag === 'article')).toBe(card)
      expect(source.parent?.props.role).toBe('list')
      expect(cells(test.root).length).toBeLessThanOrEqual(30)

      test.scrollRoot.scrollTop = 0
      test.scrollRoot.dispatchEvent(new Event('scroll'))
      await settle()
      expect(cells(test.root).find((cell) => cell.props['data-occurrence'] === '0')).toBe(source)
      test.retainedKeys.value = []
      await settle()
      expect(cells(test.root).some((cell) => cell.props['data-occurrence'] === '0')).toBe(false)
      expect(test.observers[0]!.unobserve).toHaveBeenCalledWith(source.children[0])
    } finally {
      test.unmount()
    }
    expect(test.release).toHaveBeenCalledTimes(test.mount.mock.calls.length)
    expect(test.observers[0]!.disconnect).toHaveBeenCalledExactlyOnceWith()
  })

  it('preserves established skin/query aliases, density widths and viewport/mobile rules', () => {
    const source = readFileSync(
      new URL('../../../src/components/virtual-scroll/VirtualTrackCardGrid.vue', import.meta.url),
      'utf8',
    )
    const cell = readFileSync(
      new URL('../../../src/components/virtual-scroll/VirtualGridCell.vue', import.meta.url),
      'utf8',
    )
    expect(source).toContain('class="list virtual-track-list"')
    expect(source).toContain('class="list__items virtual-track-list__items"')
    expect(cell).toContain('class="list__cell virtual-grid-cell"')
    expect(source).toContain('container: am-track-list / inline-size')
    expect(cell).toContain('container: am-track-card / inline-size')
    for (const width of [296, 420, 224])
      expect(source).toContain(`--am-track-card-min-width: ${width}px`)
    expect(source).toContain('@media (max-width: 600px)')
    expect(source).toContain('repeat(2, minmax(0, 1fr))')
    expect(source).toContain('gap: var(--am-space-2)')
    expect(source).toContain('gap: var(--am-space-3)')
    expect(source).toContain(':deep(*)')
    expect(source).toContain('content-visibility: visible')
    expect(source).toContain('contain-intrinsic-block-size: none')
  })
})
