import { describe, expect, it, vi } from 'vitest'
import { computed, effectScope, nextTick, readonly, shallowRef } from 'vue'

import { useVirtualScrollAnchor } from '../../../src/composables/virtual-scroll/use-virtual-scroll-anchor'
import type { VirtualScrollAnchorItem } from '../../../src/composables/virtual-scroll/use-virtual-scroll-anchor'
import type { VirtualScrollMetrics } from '../../../src/composables/virtual-scroll/use-virtual-scroll-context'
import { createVirtualItemIndex, createVirtualRowGeometry } from '../../../src/virtual-scroll'
import type { VirtualItemKey } from '../../../src/virtual-scroll'

function createGeometry(
  keys: readonly VirtualItemKey[],
  sizes: readonly number[] = keys.map(() => 20),
  columns = 1,
) {
  const identity = createVirtualItemIndex(keys, (key) => key)
  const rows = createVirtualRowGeometry({
    count: keys.length,
    columns,
    getRowSize: (row) => Math.max(...sizes.slice(row * columns, (row + 1) * columns)),
  })
  const getItem = vi.fn((index: number): VirtualScrollAnchorItem | undefined => {
    const position = rows.getItemPosition(index)
    const row = position && rows.getRow(position.rowIndex)
    return row && { key: keys[index]!, index, start: row.start, end: row.end, size: row.size }
  })
  const indexOf = vi.fn(identity.indexOf)
  const findItemAtOffset = vi.fn((offset: number) => {
    const row = rows.findRowAtOffset(offset)
    return row && getItem(row.startIndex)
  })
  return { count: keys.length, totalSize: rows.totalSize, getItem, indexOf, findItemAtOffset }
}

function createStyle(initial = '', priority = '') {
  let value = initial
  let currentPriority = priority
  return {
    getPropertyValue: vi.fn((_property: string) => value),
    getPropertyPriority: vi.fn((_property: string) => currentPriority),
    setProperty: vi.fn((_property: string, next: string, nextPriority = '') => {
      value = next
      currentPriority = nextPriority
    }),
    removeProperty: vi.fn(() => {
      value = ''
      currentPriority = ''
    }),
  }
}

function setup(initial = createGeometry(['a', 'b', 'c', 'd'])) {
  let scrollTop = 25
  const writes = vi.fn((offset: number) => {
    scrollTop = offset
  })
  const element = Object.assign(new EventTarget(), { style: createStyle('auto', 'important') })
  Object.defineProperty(element, 'scrollTop', { get: () => scrollTop, set: writes })
  const root = shallowRef<HTMLElement | null>(element as unknown as HTMLElement)
  const geometry = shallowRef(initial)
  const enabled = shallowRef(true)
  const resetKey = shallowRef(0)
  const metrics = shallowRef<VirtualScrollMetrics>({
    ready: true,
    viewportWidth: 500,
    viewportHeight: 20,
    listWidth: 500,
    scrollOffset: scrollTop,
    listOffset: 0,
  })
  const context = {
    metrics: readonly(metrics),
    scrollElement: computed(() => root.value),
    refresh: vi.fn(),
  }
  const scope = effectScope()
  const result = scope.run(() => useVirtualScrollAnchor({ context, geometry, enabled, resetKey }))!
  return {
    element,
    root,
    geometry,
    metrics,
    context,
    enabled,
    resetKey,
    result,
    writes,
    scroll: (offset: number) => {
      scrollTop = offset
      metrics.value = { ...metrics.value, scrollOffset: offset }
      element.dispatchEvent(new Event('scroll'))
    },
    nativeScrollWithoutEvent: (offset: number) => {
      scrollTop = offset
    },
    stop: () => scope.stop(),
  }
}

async function settle() {
  await nextTick()
  await nextTick()
}

describe('semantic virtual scroll anchoring (injected geometry, no browser layout)', () => {
  it('leases exclusive scroll ownership across multiple measurement batches and recaptures on final release', async () => {
    const test = setup()
    const first = test.result.suspend(),
      second = test.result.suspend()
    test.geometry.value = createGeometry(['x', 'a', 'b', 'c', 'd'])
    await settle()
    expect(test.writes).not.toHaveBeenCalled()
    first()
    first()
    test.geometry.value = createGeometry(['y', 'x', 'a', 'b', 'c', 'd'])
    await settle()
    expect(test.writes).not.toHaveBeenCalled()
    second()
    test.geometry.value = createGeometry(['z', 'y', 'x', 'a', 'b', 'c', 'd'])
    await settle()
    expect(test.writes).toHaveBeenCalledExactlyOnceWith(45)
    test.stop()
    second()
  })

  it('cancels a queued compensation when a deliberate navigation lease begins', async () => {
    const test = setup()
    test.geometry.value = createGeometry(['x', 'a', 'b', 'c', 'd'])
    const release = test.result.suspend()
    await settle()
    expect(test.writes).not.toHaveBeenCalled()
    test.stop()
    release()
    release()
    await settle()
    expect(test.writes).not.toHaveBeenCalled()
  })
  it('captures a stable occurrence and intra-item offset without enumerating the source', () => {
    const test = setup(createGeometry(Array.from({ length: 10_000 }, (_, index) => index)))
    try {
      expect(test.result.anchor.value).toEqual({ key: 1, index: 1, offset: 5 })
      expect(test.geometry.value.getItem).toHaveBeenCalledTimes(3)
      test.geometry.value.getItem.mockClear()
      test.scroll(70_005)
      expect(test.result.anchor.value).toEqual({ key: 3_500, index: 3_500, offset: 5 })
      expect(test.geometry.value.getItem).toHaveBeenCalledTimes(3)
      expect(test.geometry.value.indexOf).not.toHaveBeenCalled()
      expect(test.writes).not.toHaveBeenCalled()
      expect(test.context.refresh).not.toHaveBeenCalled()
    } finally {
      test.stop()
    }
  })

  it.each([50, 10])(
    'preserves the occurrence when a preceding natural height becomes %i',
    async (size) => {
      const test = setup()
      try {
        test.geometry.value = createGeometry(['a', 'b', 'c', 'd'], [size, 20, 20, 20])
        expect(test.result.pending.value).toBe(true)
        await settle()
        expect(test.root.value!.scrollTop).toBe(size + 5)
        expect(test.result.anchor.value).toEqual({ key: 'b', index: 1, offset: 5 })
        expect(test.writes).toHaveBeenCalledTimes(1)
        expect(test.result.pending.value).toBe(false)
      } finally {
        test.stop()
      }
    },
  )

  it('coalesces several layout revisions into one write from the original semantic anchor', async () => {
    const test = setup()
    try {
      test.geometry.value = createGeometry(['a', 'b', 'c', 'd'], [40, 20, 20, 20])
      test.geometry.value = createGeometry(['a', 'b', 'c', 'd'], [70, 20, 20, 20])
      test.geometry.value = createGeometry(['a', 'b', 'c', 'd'], [60, 20, 20, 20])
      await settle()
      expect(test.writes).toHaveBeenCalledExactlyOnceWith(65)
      expect(test.result.anchor.value?.key).toBe('b')
    } finally {
      test.stop()
    }
  })

  it.each([
    { keys: ['x', 'a', 'b', 'c', 'd'], expected: 45 },
    { keys: ['b', 'c', 'd'], expected: 5 },
    { keys: ['d', 'c', 'a', 'b'], expected: 65 },
  ])('keeps semantic position through insert/delete/reorder $keys', async ({ keys, expected }) => {
    const test = setup()
    try {
      test.geometry.value = createGeometry(keys)
      await settle()
      expect(test.root.value!.scrollTop).toBe(expected)
      expect(test.result.anchor.value).toMatchObject({ key: 'b', offset: 5 })
    } finally {
      test.stop()
    }
  })

  it('uses occurrence identity when the same entity appears repeatedly', async () => {
    const test = setup(createGeometry(['song:1', 'song:2', 'song:3']))
    try {
      test.geometry.value = createGeometry(['song:3', 'song:1', 'song:2'])
      await settle()
      expect(test.root.value!.scrollTop).toBe(45)
      expect(test.result.anchor.value?.key).toBe('song:2')
    } finally {
      test.stop()
    }
  })

  it('uses the immediate successor with its previous visual offset when the anchor is removed', async () => {
    const test = setup()
    try {
      test.geometry.value = createGeometry(['a', 'c', 'd'])
      await settle()
      // c previously began 15px below the viewport; keep that position after b is removed.
      expect(test.root.value!.scrollTop).toBe(5)
      expect(test.writes).toHaveBeenCalledExactlyOnceWith(5)
    } finally {
      test.stop()
    }
  })

  it('uses the immediate predecessor if the anchor and successor disappear', async () => {
    const test = setup()
    try {
      test.geometry.value = createGeometry(['x', 'a', 'd'])
      await settle()
      expect(test.root.value!.scrollTop).toBe(45)
    } finally {
      test.stop()
    }
  })

  it('bounds fallback to the nearest logical position if all captured occurrences disappear', async () => {
    const test = setup()
    try {
      test.geometry.value = createGeometry(['x', 'y', 'z'])
      await settle()
      expect(test.root.value!.scrollTop).toBe(25)
      expect(test.geometry.value.indexOf).toHaveBeenCalledTimes(3)
      expect(test.result.anchor.value?.key).toBe('y')
    } finally {
      test.stop()
    }
  })

  it('anchors row-major grids across column regrouping without confusing row and occurrence identity', async () => {
    const keys = Array.from({ length: 80 }, (_, index) => index)
    const test = setup(createGeometry(keys, undefined, 2))
    try {
      expect(test.result.anchor.value).toEqual({ key: 2, index: 2, offset: 5 })
      test.geometry.value = createGeometry(keys, undefined, 1)
      await settle()
      expect(test.root.value!.scrollTop).toBe(45)
      expect(test.result.anchor.value).toEqual({ key: 2, index: 2, offset: 5 })
      test.geometry.value = createGeometry(keys, undefined, 4)
      await settle()
      expect(test.root.value!.scrollTop).toBe(5)
    } finally {
      test.stop()
    }
  })

  it('compensates preceding header origin changes and layout changes in one write', async () => {
    const test = setup()
    try {
      test.metrics.value = { ...test.metrics.value, listOffset: 30 }
      test.geometry.value = createGeometry(['a', 'b', 'c', 'd'], [35, 20, 20, 20])
      await settle()
      expect(test.root.value!.scrollTop).toBe(70)
      expect(test.result.anchor.value).toMatchObject({ key: 'b', offset: 5 })
    } finally {
      test.stop()
    }
  })

  it('does not write for changes below the current occurrence', async () => {
    const test = setup()
    try {
      test.geometry.value = createGeometry(['a', 'b', 'c', 'd'], [20, 20, 90, 80])
      await settle()
      expect(test.writes).not.toHaveBeenCalled()
    } finally {
      test.stop()
    }
  })

  it.each(['wheel', 'touchstart', 'touchmove', 'pointerdown', 'keydown'])(
    'lets %s input cancel queued compensation',
    async (type) => {
      const test = setup()
      try {
        test.geometry.value = createGeometry(['x', 'a', 'b', 'c', 'd'])
        test.element.dispatchEvent(Object.assign(new Event(type), { key: 'PageDown' }))
        await settle()
        expect(test.writes).not.toHaveBeenCalled()
        expect(test.result.pending.value).toBe(false)
      } finally {
        test.stop()
      }
    },
  )

  it('does not treat ordinary typing as a scroll request', async () => {
    const test = setup()
    try {
      test.geometry.value = createGeometry(['x', 'a', 'b', 'c', 'd'])
      test.element.dispatchEvent(Object.assign(new Event('keydown'), { key: 'a' }))
      await settle()
      expect(test.writes).toHaveBeenCalledExactlyOnceWith(45)
    } finally {
      test.stop()
    }
  })

  it.each(['wheel', 'touchstart', 'keydown'])(
    'lets %s input preceding a same-render layout report win',
    async (type) => {
      const test = setup()
      try {
        test.element.dispatchEvent(Object.assign(new Event(type), { key: 'ArrowDown' }))
        test.geometry.value = createGeometry(['x', 'a', 'b', 'c', 'd'])
        await settle()
        expect(test.writes).not.toHaveBeenCalled()
        expect(test.result.anchor.value?.key).toBe('a')
        test.geometry.value = createGeometry(['x', 'a', 'b', 'c', 'd'], [30, 20, 20, 20, 20])
        await settle()
        expect(test.writes).toHaveBeenCalledExactlyOnceWith(35)
      } finally {
        test.stop()
      }
    },
  )

  it('lets user scrolling win and captures their new semantic location', async () => {
    const test = setup()
    try {
      test.geometry.value = createGeometry(['x', 'a', 'b', 'c', 'd'])
      test.scroll(67)
      await settle()
      expect(test.writes).not.toHaveBeenCalled()
      expect(test.result.anchor.value).toEqual({ key: 'c', index: 3, offset: 7 })
      test.geometry.value = createGeometry(['x', 'a', 'b', 'c', 'd'], [30, 20, 20, 20, 20])
      await settle()
      expect(test.writes).toHaveBeenCalledExactlyOnceWith(77)
    } finally {
      test.stop()
    }
  })

  it('lets an actual scroll preceding a same-render layout report win', async () => {
    const test = setup()
    try {
      test.scroll(45)
      test.geometry.value = createGeometry(['x', 'a', 'b', 'c', 'd'])
      await settle()
      expect(test.writes).not.toHaveBeenCalled()
      expect(test.result.anchor.value).toEqual({ key: 'b', index: 2, offset: 5 })
    } finally {
      test.stop()
    }
  })

  it.each([true, false])(
    'does not double-compensate native/programmatic scroll (event=%s)',
    async (withEvent) => {
      const test = setup()
      try {
        test.geometry.value = createGeometry(['x', 'a', 'b', 'c', 'd'])
        if (withEvent) test.scroll(45)
        else test.nativeScrollWithoutEvent(45)
        await settle()
        expect(test.writes).not.toHaveBeenCalled()
        expect(test.result.anchor.value).toMatchObject({ key: 'b', offset: 5 })
      } finally {
        test.stop()
      }
    },
  )

  it.each([true, false])(
    'honors intentional reset tokens in either mutation order (resetFirst=%s)',
    async (resetFirst) => {
      const test = setup()
      try {
        if (resetFirst) test.resetKey.value++
        test.geometry.value = createGeometry(['d', 'c', 'b', 'a'])
        if (!resetFirst) test.resetKey.value++
        test.nativeScrollWithoutEvent(0)
        await settle()
        expect(test.writes).not.toHaveBeenCalled()
        expect(test.result.anchor.value).toMatchObject({ key: 'd', offset: 0 })
        test.geometry.value = createGeometry(['x', 'd', 'c', 'b', 'a'])
        await settle()
        expect(test.writes).toHaveBeenCalledExactlyOnceWith(20)
      } finally {
        test.stop()
      }
    },
  )

  it('supports explicit cancellation without leaving stale queued writes', async () => {
    const test = setup()
    try {
      test.geometry.value = createGeometry(['x', 'a', 'b', 'c', 'd'])
      test.result.cancel()
      await settle()
      expect(test.writes).not.toHaveBeenCalled()
      expect(test.result.anchor.value?.key).toBe('a')
    } finally {
      test.stop()
    }
  })

  it('supersedes pending compensation when the caller explicitly captures a new baseline', async () => {
    const test = setup()
    try {
      test.geometry.value = createGeometry(['x', 'a', 'b', 'c', 'd'])
      test.result.capture()
      await settle()
      expect(test.writes).not.toHaveBeenCalled()
      expect(test.result.pending.value).toBe(false)
      expect(test.result.anchor.value?.key).toBe('a')
    } finally {
      test.stop()
    }
  })

  it.each(['root', 'hidden', 'disabled', 'dispose'] as const)(
    'cancels pending work on %s lifecycle replacement',
    async (change) => {
      const test = setup()
      try {
        test.geometry.value = createGeometry(['x', 'a', 'b', 'c', 'd'])
        if (change === 'root') test.root.value = null
        if (change === 'hidden') test.metrics.value = { ...test.metrics.value, ready: false }
        if (change === 'disabled') test.enabled.value = false
        if (change === 'dispose') test.stop()
        await settle()
        expect(test.writes).not.toHaveBeenCalled()
        expect(test.result.pending.value).toBe(false)
        expect(test.element.style.getPropertyValue('overflow-anchor')).toBe('auto')
        expect(test.element.style.getPropertyPriority('overflow-anchor')).toBe('important')
      } finally {
        test.stop()
      }
    },
  )

  it('re-establishes a fresh anchor after hidden recovery rather than replaying old compensation', async () => {
    const test = setup()
    try {
      test.metrics.value = { ...test.metrics.value, ready: false }
      test.geometry.value = createGeometry(['x', 'a', 'b', 'c', 'd'])
      test.metrics.value = { ...test.metrics.value, ready: true }
      await settle()
      expect(test.writes).not.toHaveBeenCalled()
      expect(test.result.anchor.value?.key).toBe('a')
      test.geometry.value = createGeometry(['y', 'x', 'a', 'b', 'c', 'd'])
      await settle()
      expect(test.writes).toHaveBeenCalledExactlyOnceWith(45)
    } finally {
      test.stop()
    }
  })

  it('does not compensate layout reports in the same render as hidden recovery', async () => {
    const test = setup()
    try {
      test.metrics.value = { ...test.metrics.value, ready: false }
      await settle()
      test.metrics.value = { ...test.metrics.value, ready: true }
      test.geometry.value = createGeometry(['x', 'a', 'b', 'c', 'd'])
      await settle()
      expect(test.writes).not.toHaveBeenCalled()
      expect(test.result.anchor.value?.key).toBe('a')
    } finally {
      test.stop()
    }
  })

  it('does not invent an anchor before/after the surface or for an empty collection', async () => {
    const test = setup(createGeometry([]))
    try {
      expect(test.result.anchor.value).toBeUndefined()
      test.geometry.value = createGeometry(['a', 'b', 'c'])
      await settle()
      expect(test.writes).not.toHaveBeenCalled()
      test.scroll(100)
      expect(test.result.anchor.value).toBeUndefined()
      test.geometry.value = createGeometry(['x', 'a', 'b', 'c'])
      await settle()
      expect(test.writes).not.toHaveBeenCalled()
      test.metrics.value = { ...test.metrics.value, listOffset: 200 }
      expect(test.result.anchor.value).toBeUndefined()
      test.geometry.value = createGeometry(['x', 'a', 'b', 'c', 'd'])
      await settle()
      expect(test.writes).not.toHaveBeenCalled()
    } finally {
      test.stop()
    }
  })

  it('shares native anchor suppression leases and restores only after final disposal', () => {
    const test = setup()
    const secondScope = effectScope()
    secondScope.run(() =>
      useVirtualScrollAnchor({ context: test.context, geometry: test.geometry }),
    )
    expect(test.element.style.setProperty).toHaveBeenCalledExactlyOnceWith(
      'overflow-anchor',
      'none',
    )
    test.stop()
    expect(test.element.style.getPropertyValue('overflow-anchor')).toBe('none')
    secondScope.stop()
    expect(test.element.style.getPropertyValue('overflow-anchor')).toBe('auto')
    expect(test.element.style.getPropertyPriority('overflow-anchor')).toBe('important')
  })

  it('preserves an external declaration changed while suppression was active', () => {
    const test = setup()
    test.element.style.setProperty('overflow-anchor', 'auto')
    test.stop()
    expect(test.element.style.getPropertyValue('overflow-anchor')).toBe('auto')
    expect(test.element.style.getPropertyPriority('overflow-anchor')).toBe('')
  })

  it('removes every bounded input listener on disposal and does not refresh layout on input', () => {
    const test = setup()
    const remove = vi.spyOn(test.element, 'removeEventListener')
    test.stop()
    expect(remove.mock.calls.map(([event]) => event).toSorted()).toEqual([
      'keydown',
      'pointerdown',
      'touchmove',
      'touchstart',
      'wheel',
    ])
    expect(test.context.refresh).not.toHaveBeenCalled()
  })
})
