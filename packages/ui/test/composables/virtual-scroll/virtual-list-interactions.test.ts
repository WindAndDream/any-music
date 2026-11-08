import { describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick, shallowRef, watch } from 'vue'

import { createVirtualRetainedRange } from '../../../src/composables/virtual-scroll/virtual-retained-range'
import {
  useFixedVirtualList,
  useMeasuredVirtualList,
  useVirtualScrollAnchor,
  useVirtualItemRetention,
} from '../../../src/virtual-scroll'
import {
  createResizeEnvironment,
  VirtualElement,
} from '../../fixtures/virtual-scroll/resize-observer'

async function settle() {
  await nextTick()
  await nextTick()
  await nextTick()
}

function setup(measured = false) {
  const env = createResizeEnvironment()
  const root = new VirtualElement(env.document)
  const list = new VirtualElement(env.document)
  root.scrollTop = 0
  root.clientHeight = 100
  list.rect.top = 12
  list.getBoundingClientRect.mockImplementation(
    () => ({ ...list.rect, top: list.rect.top - root.scrollTop }) as DOMRect,
  )
  const items = shallowRef(Array.from({ length: 10_000 }, (_, key) => ({ key, revision: 0 })))
  const retainedIndexes = shallowRef<readonly number[]>([])
  const getItemKey = vi.fn((item: { key: number }) => item.key)
  const scope = effectScope()
  const options = {
    items,
    getItemKey,
    scrollElement: root.asElement(),
    listElement: list.asElement(),
    gap: 2,
    retainedIndexes,
  }
  const result = scope.run(() =>
    measured
      ? useMeasuredVirtualList({
          ...options,
          estimatedItemSize: 20,
          getContentGeneration: (item) => item.revision,
        })
      : useFixedVirtualList({ ...options, itemSize: 20 }),
  )!
  return {
    ...env,
    scope,
    root,
    list,
    items,
    retainedIndexes,
    getItemKey,
    result,
    stop: () => scope.stop(),
  }
}

describe('public list interaction geometry (installed engine, injected layout)', () => {
  it('rejects excess raw interaction holds before they can mount the whole collection', () => {
    expect(() =>
      createVirtualRetainedRange(
        Array.from({ length: 33 }, (_, index) => index),
        10_000,
      ),
    ).toThrow(RangeError)
    const extract = createVirtualRetainedRange([...Array(50).fill(9999), -1, NaN], 10_000, 3)
    expect(extract({ startIndex: 0, endIndex: 1, overscan: 0, count: 3334 })).toEqual([0, 1, 3333])
  })
  it.each([false, true])(
    'adds only retained occurrences without filling gaps (measured=%s)',
    async (measured) => {
      const test = setup(measured)
      try {
        await settle()
        test.retainedIndexes.value = [9_999, -1, 10_000, 0.5, NaN, 9_999]
        await settle()
        expect(test.result.virtualItems.value.map((item) => item.index)).toEqual([
          0, 1, 2, 3, 4, 5, 6, 9_999,
        ])
        expect(test.result.count.value).toBe(10_000)
        expect(test.result.totalSize.value).toBe(219_998)
        test.retainedIndexes.value = []
        await settle()
        expect(test.result.virtualItems.value).toHaveLength(7)
      } finally {
        test.stop()
      }
    },
  )

  it.each([false, true])(
    'keeps immutable semantic snapshots and does no indexing on scroll (measured=%s)',
    async (measured) => {
      const test = setup(measured)
      try {
        await settle()
        const previous = test.result.geometry.value
        expect(previous.getItem(2)).toEqual({ key: 2, index: 2, start: 44, end: 64, size: 20 })
        expect(previous.findItemAtOffset(43)?.key).toBe(1)
        const first = test.items.value[0]!
        test.items.value = [...test.items.value.slice(1), first]
        await settle()
        expect(test.result.geometry.value.getItem(0)?.key).toBe(1)
        expect(test.result.geometry.value.indexOf(0)).toBe(9_999)
        expect(previous.indexOf(0)).toBe(0)
        expect(previous.getItem(0)?.key).toBe(0)
        const snapshot = test.result.geometry.value
        test.getItemKey.mockClear()
        test.root.scrollTop = 100_000
        test.root.dispatchEvent(new Event('scroll'))
        await settle()
        expect(test.result.geometry.value).toBe(snapshot)
        expect(test.getItemKey).not.toHaveBeenCalled()
        expect(test.result.virtualItems.value.length).toBeLessThanOrEqual(10)
      } finally {
        test.stop()
      }
    },
  )

  it.each([false, true])(
    'anchors the installed list after insertion and honors an intentional reset (measured=%s)',
    async (measured) => {
      const test = setup(measured)
      const resetKey = shallowRef(0)
      const anchor = test.scope.run(() =>
        useVirtualScrollAnchor({
          context: test.result.context,
          geometry: test.result.geometry,
          resetKey,
        }),
      )!
      try {
        await settle()
        test.root.scrollTop = 113
        test.root.dispatchEvent(new Event('scroll'))
        expect(anchor.anchor.value).toMatchObject({ key: 5, offset: 3 })
        await settle()
        test.items.value = [{ key: 10_000, revision: 0 }, ...test.items.value]
        await settle()
        expect(test.root.scrollTop).toBe(135)
        // The browser reports the helper's scroll write on its normal scroll task.
        test.root.dispatchEvent(new Event('scroll'))
        await settle()
        expect(test.result.virtualItems.value.some((item) => item.key === 5)).toBe(true)
        resetKey.value++
        test.root.scrollTop = 0
        test.root.dispatchEvent(new Event('scroll'))
        test.items.value = test.items.value.toReversed()
        await settle()
        expect(test.root.scrollTop).toBe(0)
        expect(anchor.pending.value).toBe(false)
      } finally {
        test.stop()
      }
    },
  )

  it('mounts a remote focus destination, preserves explicit editor holds and releases scopes', async () => {
    const test = setup()
    const targets = new Map<
      number,
      { element: HTMLElement; release: () => void; focus: ReturnType<typeof vi.fn> }
    >()
    const retention = test.scope.run(() =>
      useVirtualItemRetention({ context: test.result.context, geometry: test.result.geometry }),
    )!
    test.scope.run(() => {
      watch(
        retention.retainedIndexes,
        (indexes) => {
          test.retainedIndexes.value = indexes
        },
        { immediate: true, flush: 'sync' },
      )
      watch(
        test.result.virtualItems,
        (items) => {
          const visible = new Set(items.map((item) => item.key))
          for (const [key, target] of targets)
            if (!visible.has(key)) {
              target.release()
              targets.delete(key)
            }
          for (const item of items) {
            if (targets.has(Number(item.key))) continue
            const focus = vi.fn(() => {
              Object.assign(test.document, { activeElement: target })
            })
            const target = Object.assign(new VirtualElement(test.document), {
              nodeType: 1,
              focus,
              contains(node: unknown) {
                return node === this
              },
              getRootNode() {
                return test.document
              },
            }).asElement()
            targets.set(Number(item.key), {
              element: target,
              focus,
              release: retention.registerItem(item.key, target),
            })
          }
        },
        { immediate: true, flush: 'post' },
      )
    })
    try {
      await settle()
      const releaseEditor = retention.retain(0, 'editor')!
      expect(await retention.focusItem(9_999, { align: 'end' })).toBe(true)
      expect(targets.get(9_999)!.focus).toHaveBeenCalledWith({ preventScroll: true })
      expect(test.result.virtualItems.value.some((item) => item.key === 0)).toBe(true)
      expect(test.result.virtualItems.value.length).toBeLessThanOrEqual(12)
      expect(retention.retainedKeys.value).toEqual([0, 9_999])
      releaseEditor()
      targets.get(9_999)!.element.dispatchEvent(new Event('focusout'))
      await settle()
      expect(retention.retainedKeys.value).toEqual([])
      expect(test.result.virtualItems.value.some((item) => item.key === 0)).toBe(false)
    } finally {
      test.stop()
    }
    expect(retention.retainedKeys.value).toEqual([])
    expect(test.observers.every((observer) => observer.disconnect.mock.calls.length === 1)).toBe(
      true,
    )
  })

  it('compensates natural measurement growth and shrink before the visible occurrence', async () => {
    const test = setup(true)
    const measurements = (
      test.result as ReturnType<typeof useMeasuredVirtualList<{ key: number; revision: number }>>
    ).measurements
    test.scope.run(() =>
      useVirtualScrollAnchor({ context: test.result.context, geometry: test.result.geometry }),
    )
    const first = new VirtualElement(test.document)
    first.rect.height = 20
    const release = measurements.observeItem(0, first.asElement())
    try {
      await settle()
      test.root.scrollTop = 113
      test.root.dispatchEvent(new Event('scroll'))
      first.rect.height = 50
      test.observers[0]!.notify([first.asElement()])
      await settle()
      expect(test.root.scrollTop).toBe(143)
      test.root.dispatchEvent(new Event('scroll'))
      first.rect.height = 10
      test.observers[0]!.notify([first.asElement()])
      await settle()
      expect(test.root.scrollTop).toBe(103)
      expect(test.result.geometry.value.getItem(5)?.start).toBe(100)
    } finally {
      release()
      test.stop()
    }
  })
})
