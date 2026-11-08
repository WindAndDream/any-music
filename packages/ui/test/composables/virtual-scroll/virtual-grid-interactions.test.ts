import { describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick, shallowRef, watch } from 'vue'

import { useMeasuredVirtualGrid } from '../../../src/composables/virtual-scroll/use-measured-virtual-grid'
import { useVirtualItemRetention } from '../../../src/composables/virtual-scroll/use-virtual-item-retention'
import { useVirtualScrollAnchor } from '../../../src/composables/virtual-scroll/use-virtual-scroll-anchor'
import {
  createResizeEnvironment,
  VirtualElement,
} from '../../fixtures/virtual-scroll/resize-observer'

async function settle() {
  await nextTick()
  await nextTick()
  await nextTick()
}

function setup() {
  const environment = createResizeEnvironment()
  const root = new VirtualElement(environment.document)
  const list = new VirtualElement(environment.document)
  root.scrollTop = 0
  root.clientHeight = 100
  const scrollElement = shallowRef<HTMLElement | null>(root.asElement())
  const listElement = shallowRef<HTMLElement | null>(list.asElement())
  const origin = 20
  list.rect.width = 1_000
  list.getBoundingClientRect.mockImplementation(
    () =>
      ({
        ...list.rect,
        top: origin + root.rect.top + root.clientTop - (scrollElement.value?.scrollTop ?? 0),
      }) as DOMRect,
  )
  const items = shallowRef(Array.from({ length: 10_000 }, (_, key) => ({ key, revision: 0 })))
  const columns = shallowRef(3)
  const enabled = shallowRef(true)
  const retainedIndexes = shallowRef<readonly number[]>([])
  const resetKey = shallowRef(0)
  const scope = effectScope()
  const grid = scope.run(() =>
    useMeasuredVirtualGrid({
      items,
      columns,
      enabled,
      retainedIndexes,
      scrollElement,
      listElement,
      getItemKey: (item) => item.key,
      getContentGeneration: (item) => item.revision,
      estimatedItemSize: 20,
      gap: 2,
      columnGap: 12,
      cacheLimit: 32,
    }),
  )!
  const anchor = scope.run(() =>
    useVirtualScrollAnchor({
      context: grid.context,
      geometry: grid.geometry,
      resetKey,
    }),
  )!
  const beforeScroll = vi.fn(anchor.cancel)
  const retention = scope.run(() =>
    useVirtualItemRetention({
      context: grid.context,
      geometry: grid.geometry,
      beforeScroll,
      limit: 4,
    }),
  )!
  scope.run(() =>
    watch(
      retention.retainedIndexes,
      (indexes) => {
        retainedIndexes.value = indexes
      },
      { immediate: true, flush: 'sync' },
    ),
  )
  function scroll(offset: number) {
    root.scrollTop = offset
    root.dispatchEvent(new Event('scroll'))
  }
  function mount(key: number, height: number) {
    const element = new VirtualElement(environment.document)
    element.rect.height = height
    return { element, release: grid.measurements.observeItem(key, element.asElement()) }
  }
  return {
    ...environment,
    root,
    list,
    origin,
    grid,
    anchor,
    retention,
    beforeScroll,
    items,
    columns,
    enabled,
    scrollElement,
    listElement,
    resetKey,
    scroll,
    mount,
    stop: () => scope.stop(),
  }
}

describe('measured grid, anchor and retention composition (installed engine; injected layout)', () => {
  it('preserves the occurrence and intra-row offset through responsive column regrouping', async () => {
    const test = setup()
    try {
      await settle()
      expect(test.grid.context.metrics.value.listOffset).toBe(test.origin)
      test.scroll(test.origin + 10 * 22 + 5)
      await settle()
      expect(test.anchor.anchor.value).toEqual({ key: 30, index: 30, offset: 5 })
      test.columns.value = 2
      await settle()
      expect(test.root.scrollTop).toBe(test.origin + 15 * 22 + 5)
      test.root.dispatchEvent(new Event('scroll'))
      await settle()
      expect(test.anchor.anchor.value).toEqual({ key: 30, index: 30, offset: 5 })
      expect(test.grid.virtualItems.value.some((item) => item.key === 30)).toBe(true)
      expect(test.grid.virtualItems.value.length).toBeLessThanOrEqual(22)
      test.columns.value = 1
      await settle()
      expect(test.root.scrollTop).toBe(test.origin + 30 * 22 + 5)
    } finally {
      test.stop()
    }
  })

  it('compensates natural tallest-cell growth and shrink before the visible row', async () => {
    const test = setup()
    const cells = [test.mount(0, 20), test.mount(1, 20), test.mount(2, 20)]
    try {
      await settle()
      const original = test.origin + 10 * 22 + 5
      test.scroll(original)
      await settle()
      cells[1]!.element.rect.height = 50
      test.observers[0]!.notify([cells[1]!.element.asElement()])
      await settle()
      expect(test.root.scrollTop).toBe(original + 30)
      test.root.dispatchEvent(new Event('scroll'))
      await settle()
      expect(test.anchor.anchor.value).toEqual({ key: 30, index: 30, offset: 5 })
      for (const cell of cells) cell.element.rect.height = 10
      test.observers[0]!.notify(cells.map((cell) => cell.element.asElement()))
      await settle()
      expect(test.root.scrollTop).toBe(original - 10)
      expect(test.grid.geometry.value.getItem(30)).toMatchObject({ start: 210, size: 20 })
      expect(test.grid.measurements.cacheSize.value).toBe(3)
      expect(test.grid.virtualItems.value.length).toBeLessThanOrEqual(30)
    } finally {
      for (const cell of cells) cell.release()
      test.stop()
    }
  })

  it('retains only bounded remote rows and releases them after editor/popover completion', async () => {
    const test = setup()
    try {
      await settle()
      test.scroll(test.origin + 1_000 * 22 + 5)
      await settle()
      const releaseEditor = test.retention.retain(0, 'editor')!
      const releasePopover = test.retention.retain(9_999, 'popover')!
      await settle()
      expect(test.retention.retainedKeys.value).toEqual([0, 9_999])
      expect(test.grid.virtualItems.value.some((item) => item.key === 0)).toBe(true)
      expect(test.grid.virtualItems.value.some((item) => item.key === 9_999)).toBe(true)
      expect(test.grid.virtualItems.value.length).toBeLessThanOrEqual(34)
      expect(test.grid.renderLayout.value.templateRows.split(' ').length).toBeLessThanOrEqual(15)
      expect(test.grid.count.value).toBe(10_000)
      expect(test.grid.measurements.cacheSize.value).toBe(0)
      releaseEditor()
      releasePopover()
      await settle()
      expect(test.retention.retainedKeys.value).toEqual([])
      expect(
        test.grid.virtualItems.value.some((item) => item.key === 0 || item.key === 9_999),
      ).toBe(false)
      expect(test.grid.virtualItems.value.length).toBeLessThanOrEqual(30)
    } finally {
      test.stop()
    }
    expect(test.observers.every((observer) => observer.disconnect.mock.calls.length === 1)).toBe(
      true,
    )
  })

  it('gives deliberate keyed navigation priority over a queued anchor correction', async () => {
    const test = setup()
    try {
      await settle()
      test.scroll(test.origin + 10 * 22 + 5)
      await settle()
      test.items.value = [{ key: 10_000, revision: 0 }, ...test.items.value]
      expect(test.anchor.pending.value).toBe(true)
      expect(test.retention.scrollToKey(9_999, { align: 'end' })).toBe(true)
      const navigationOffset = test.root.scrollTop
      expect(test.beforeScroll).toHaveBeenCalledTimes(1)
      await settle()
      expect(test.root.scrollTop).toBe(navigationOffset)
      expect(test.anchor.pending.value).toBe(false)
      expect(test.grid.context.metrics.value.scrollOffset).toBe(navigationOffset)
      expect(test.grid.virtualItems.value.some((item) => item.key === 9_999)).toBe(true)
      expect(test.grid.virtualItems.value.length).toBeLessThanOrEqual(30)
    } finally {
      test.stop()
    }
  })

  it.each(['hidden', 'root', 'reset'] as const)(
    'cancels stale grid compensation on %s replacement',
    async (change) => {
      const test = setup()
      try {
        await settle()
        const original = test.origin + 10 * 22 + 5
        test.scroll(original)
        await settle()
        test.columns.value = 2
        expect(test.anchor.pending.value).toBe(true)
        if (change === 'hidden') test.enabled.value = false
        if (change === 'root') {
          const replacement = new VirtualElement(test.document)
          replacement.scrollTop = 41
          replacement.clientHeight = 100
          test.scrollElement.value = replacement.asElement()
        }
        if (change === 'reset') {
          test.resetKey.value++
          test.root.scrollTop = 0
          test.root.dispatchEvent(new Event('scroll'))
        }
        await settle()
        expect(test.root.scrollTop).toBe(change === 'reset' ? 0 : original)
        expect(test.anchor.pending.value).toBe(false)
        if (change === 'hidden') {
          expect(test.grid.virtualItems.value).toEqual([])
          test.enabled.value = true
          await settle()
          expect(test.root.scrollTop).toBe(original)
        }
        if (change === 'root') expect(test.scrollElement.value!.scrollTop).toBe(41)
      } finally {
        test.stop()
      }
    },
  )
})
