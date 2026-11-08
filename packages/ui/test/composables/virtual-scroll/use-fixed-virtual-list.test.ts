import { describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick, shallowRef } from 'vue'

import { useFixedVirtualList } from '../../../src/virtual-scroll'
import {
  createVirtualCollectionFixture,
  virtualCollectionSizes,
} from '../../fixtures/virtual-scroll/collection-data'
import {
  createResizeEnvironment,
  VirtualElement,
} from '../../fixtures/virtual-scroll/resize-observer'

function setupList(count = 1_000, listOffset = 0) {
  const env = createResizeEnvironment()
  const root = new VirtualElement(env.document),
    list = new VirtualElement(env.document)
  root.clientHeight = 100
  root.scrollTop = 0
  list.rect.top = root.rect.top + root.clientTop + listOffset
  const items = shallowRef(createVirtualCollectionFixture(count).occurrences)
  const scrollElement = shallowRef(root.asElement())
  const listElement = shallowRef<HTMLElement | null>(list.asElement())
  const itemSize = shallowRef(20),
    gap = shallowRef(0),
    enabled = shallowRef(true)
  const getItemKey = vi.fn((item: (typeof items.value)[number]) => item.occurrenceKey)
  const addListener = vi.spyOn(root, 'addEventListener')
  const scope = effectScope()
  const result = scope.run(() =>
    useFixedVirtualList({
      items,
      scrollElement,
      listElement,
      getItemKey,
      itemSize,
      gap,
      enabled,
    }),
  )!
  return {
    ...env,
    root,
    list,
    items,
    scrollElement,
    listElement,
    itemSize,
    gap,
    enabled,
    getItemKey,
    addListener,
    result,
    stop: () => scope.stop(),
  }
}

describe('fixed virtual list with the real scroll context and installed Vue engine', () => {
  it.each(virtualCollectionSizes)(
    'bounds the rendered range for %i full logical items',
    (count) => {
      const test = setupList(count)
      try {
        expect(test.result.count.value).toBe(count)
        expect(test.result.totalSize.value).toBe(count * 20)
        const visible = test.result.virtualItems.value
        expect(visible.length).toBe(Math.min(count, 7))
        for (const row of visible) {
          expect(row.item).toBe(test.items.value[row.index])
          expect(row.key).toBe(test.items.value[row.index]!.occurrenceKey)
          expect(row.start).toBe(row.index * 20)
          expect(row.end).toBe(row.start + 20)
        }
        expect(test.getItemKey).toHaveBeenCalledTimes(count)
      } finally {
        test.stop()
      }
    },
  )

  it('jumps to either end and distant windows without rescanning keys or reading layout on scroll', async () => {
    const test = setupList(10_000)
    try {
      test.root.getBoundingClientRect.mockClear()
      test.list.getBoundingClientRect.mockClear()
      for (const offset of [20_000, 199_900, 960, 0]) {
        test.root.scrollTop = offset
        test.root.dispatchEvent(new Event('scroll'))
        // eslint-disable-next-line no-await-in-loop -- Each distant committed window must remain bounded.
        await nextTick()
        const visible = test.result.virtualItems.value
        expect(visible.length).toBeLessThanOrEqual(10)
        expect(visible[0]!.index).toBe(Math.max(0, offset / 20 - 2))
        expect(visible.at(-1)!.index).toBe(Math.min(9_999, offset / 20 + 6))
        expect(test.result.totalSize.value).toBe(200_000)
      }
      expect(test.getItemKey).toHaveBeenCalledTimes(10_000)
      expect(test.root.getBoundingClientRect).not.toHaveBeenCalled()
      expect(test.list.getBoundingClientRect).not.toHaveBeenCalled()
      expect(test.observers[0]!.observe).toHaveBeenCalledTimes(2)
    } finally {
      test.stop()
    }
  })

  it('uses the list origin below headers and keeps list-local positions when that origin changes', async () => {
    const test = setupList(80, 120)
    try {
      test.root.scrollTop = 320
      test.list.rect.top = 12 + 120 - 320
      test.root.dispatchEvent(new Event('scroll'))
      await nextTick()
      expect(test.result.context.metrics.value.listOffset).toBe(120)
      expect(test.result.virtualItems.value[0]!.index).toBe(8)
      expect(test.result.virtualItems.value[0]!.start).toBe(160)
      test.list.rect.top += 40
      test.observers[0]!.notify([test.list.asElement()])
      await nextTick()
      expect(test.result.context.metrics.value.listOffset).toBe(160)
      expect(test.result.virtualItems.value[0]!.index).toBe(6)
      expect(test.result.virtualItems.value[0]!.start).toBe(120)
      expect(test.result.totalSize.value).toBe(1_600)
      expect(test.root.scrollTop).toBe(320)
      expect(test.getItemKey).toHaveBeenCalledTimes(80)
    } finally {
      test.stop()
    }
  })

  it('shares only the context viewport/list observations and updates the visible range on resize', async () => {
    const test = setupList()
    try {
      expect(test.observers).toHaveLength(1)
      test.root.clientHeight = 220
      test.observers[0]!.notify([test.root.asElement(), test.list.asElement()])
      await nextTick()
      expect(test.result.virtualItems.value).toHaveLength(13)
      expect(test.observers).toHaveLength(1)
      expect(test.observers[0]!.observe).toHaveBeenCalledTimes(2)
      expect(test.addListener.mock.calls.filter(([type]) => type === 'scroll')).toHaveLength(1)
      expect(test.getItemKey).toHaveBeenCalledTimes(1_000)
    } finally {
      test.stop()
    }
    expect(test.observers.every((observer) => observer.disconnect.mock.calls.length === 1)).toBe(
      true,
    )
  })

  it('keeps the spacer but mounts nothing for hidden, disabled or absent lists, then resumes at the caller offset', async () => {
    const test = setupList()
    try {
      test.root.clientHeight = 0
      test.observers[0]!.notify([test.root.asElement()])
      await nextTick()
      expect(test.result.virtualItems.value).toEqual([])
      expect(test.result.totalSize.value).toBe(20_000)
      test.root.scrollTop = 1_000
      test.root.clientHeight = 100
      test.list.rect.top = 12 - 1_000
      test.observers[0]!.notify([test.root.asElement(), test.list.asElement()])
      await nextTick()
      expect(test.result.virtualItems.value[0]!.index).toBe(48)
      expect(test.root.scrollTop).toBe(1_000)
      test.enabled.value = false
      await nextTick()
      expect(test.result.virtualItems.value).toEqual([])
      test.root.scrollTop = 2_000
      test.list.rect.top = 12 - 2_000
      test.enabled.value = true
      await nextTick()
      expect(test.result.virtualItems.value[0]!.index).toBe(98)
      expect(test.root.scrollTop).toBe(2_000)
      test.listElement.value = null
      await nextTick()
      expect(test.result.virtualItems.value).toEqual([])
      test.listElement.value = test.list.asElement()
      await nextTick()
      expect(test.result.virtualItems.value[0]!.index).toBe(98)
    } finally {
      test.stop()
    }
  })

  it('rebinds the actual scroll root and ignores old events and callbacks after replacement/disposal', async () => {
    const test = setupList()
    const oldObserver = test.observers[0]!
    const nextRoot = new VirtualElement(test.document)
    nextRoot.clientHeight = 100
    nextRoot.scrollTop = 600
    test.list.rect.top = 12 - 600
    try {
      test.scrollElement.value = nextRoot.asElement()
      await nextTick()
      expect(test.result.virtualItems.value[0]!.index).toBe(28)
      test.root.scrollTop = 9_000
      test.root.dispatchEvent(new Event('scroll'))
      oldObserver.notify([test.root.asElement(), test.list.asElement()])
      await nextTick()
      expect(test.result.virtualItems.value[0]!.index).toBe(28)
      expect(nextRoot.scrollTop).toBe(600)
    } finally {
      test.stop()
    }
    nextRoot.scrollTop = 7_000
    nextRoot.dispatchEvent(new Event('scroll'))
    // Only observers with actual targets can have pending native entries. The engine's
    // unused internal measurement observer is created/disconnected empty during teardown.
    for (const observer of test.observers.filter(
      (candidate) => candidate.observe.mock.calls.length,
    ))
      observer.notify([nextRoot.asElement(), test.list.asElement()])
    await nextTick()
    expect(test.result.virtualItems.value).toEqual([])
    expect(test.observers.every((observer) => observer.disconnect.mock.calls.length === 1)).toBe(
      true,
    )
  })

  it('updates fixed size and gaps in both directions without stale measurements or a key rescan', async () => {
    const test = setupList(80)
    try {
      test.itemSize.value = 40
      test.gap.value = 5
      await nextTick()
      expect(test.result.totalSize.value).toBe(80 * 40 + 79 * 5)
      expect(test.result.virtualItems.value[1]).toMatchObject({ start: 45, size: 40, end: 85 })
      test.itemSize.value = 10
      test.gap.value = 0
      await nextTick()
      expect(test.result.totalSize.value).toBe(800)
      expect(test.result.virtualItems.value[1]).toMatchObject({ start: 10, size: 10, end: 20 })
      expect(test.result.virtualItems.value).toHaveLength(12)
      expect(test.getItemKey).toHaveBeenCalledTimes(80)
    } finally {
      test.stop()
    }
  })

  it('tracks complete collection replacement, shrinking, clearing and refill without writing scroll', async () => {
    const test = setupList(80)
    try {
      const previous = test.items.value
      expect(previous[0]!.track).toBe(previous[1]!.track)
      expect(test.result.virtualItems.value[0]!.key).not.toBe(
        test.result.virtualItems.value[1]!.key,
      )
      test.items.value = previous.toReversed()
      await nextTick()
      expect(test.result.virtualItems.value[0]!.key).toBe(previous.at(-1)!.occurrenceKey)
      test.items.value = previous.slice(0, 1)
      await nextTick()
      expect(test.result.count.value).toBe(1)
      expect(test.result.virtualItems.value).toHaveLength(1)
      expect(test.result.totalSize.value).toBe(20)
      test.items.value = []
      await nextTick()
      expect(test.result.count.value).toBe(0)
      expect(test.result.virtualItems.value).toEqual([])
      expect(test.result.totalSize.value).toBe(0)
      test.items.value = previous
      await nextTick()
      expect(test.result.count.value).toBe(80)
      expect(test.result.virtualItems.value).toHaveLength(7)
      expect(test.root.scrollTop).toBe(0)
    } finally {
      test.stop()
    }
  })

  it.each([0, 1])('keeps padding and header offset correct with %i items', (count) => {
    const scope = effectScope()
    const env = createResizeEnvironment()
    const root = new VirtualElement(env.document),
      list = new VirtualElement(env.document)
    list.rect.top = 132
    try {
      const result = scope.run(() =>
        useFixedVirtualList({
          items: Array.from({ length: count }, (_, index) => index),
          getItemKey: (item) => item,
          itemSize: 20,
          gap: 8,
          paddingStart: 12,
          paddingEnd: 16,
          scrollElement: root.asElement(),
          listElement: list.asElement(),
        }),
      )!
      expect(result.totalSize.value).toBe(count * 20 + 28)
      expect(result.virtualItems.value[0]?.start).toBe(count ? 12 : undefined)
    } finally {
      scope.stop()
    }
  })

  it.each([
    { itemSize: 0 },
    { itemSize: -1 },
    { itemSize: NaN },
    { itemSize: Infinity },
    { itemSize: Number.MAX_VALUE },
    { gap: -1 },
    { paddingStart: -1 },
    { paddingEnd: Infinity },
    { overscan: -1 },
    { overscan: 1.5 },
    { overscan: Infinity },
  ])('rejects invalid geometry instead of admitting an unbounded range: %j', (invalid) => {
    const scope = effectScope()
    try {
      expect(() =>
        scope.run(() => {
          const result = useFixedVirtualList({
            items: [1, 2],
            getItemKey: (item) => item,
            listElement: null,
            scrollElement: null,
            itemSize: 20,
            ...invalid,
          })
          return result.virtualItems.value
        }),
      ).toThrow(RangeError)
    } finally {
      scope.stop()
    }
  })

  it('rejects duplicate occurrence keys before rendering aliased rows', () => {
    const scope = effectScope()
    try {
      expect(() =>
        scope.run(() =>
          useFixedVirtualList({
            items: ['same', 'same'],
            getItemKey: (item) => item,
            itemSize: 20,
            listElement: null,
            scrollElement: null,
          }),
        ),
      ).toThrow('Duplicate virtual item key')
    } finally {
      scope.stop()
    }
  })
})
