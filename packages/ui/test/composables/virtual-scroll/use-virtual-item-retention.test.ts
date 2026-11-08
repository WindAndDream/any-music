import { describe, expect, it, vi } from 'vitest'
import { computed, effectScope, nextTick, shallowRef } from 'vue'

import { useVirtualItemRetention } from '../../../src/composables/virtual-scroll/use-virtual-item-retention'
import type { VirtualItemRetentionGeometry } from '../../../src/composables/virtual-scroll/use-virtual-item-retention'
import { useVirtualScrollContext } from '../../../src/composables/virtual-scroll/use-virtual-scroll-context'
import { createVirtualItemIndex } from '../../../src/composables/virtual-scroll/virtual-row-geometry'
import type { VirtualItemKey } from '../../../src/composables/virtual-scroll/virtual-row-geometry'
import {
  createResizeEnvironment,
  VirtualElement,
} from '../../fixtures/virtual-scroll/resize-observer'

/** Injected event/focus surface; these tests do not establish native browser focus or IME behavior. */
class ItemElement extends EventTarget {
  readonly nodeType = 1
  isConnected = true
  readonly children: ItemElement[] = []
  parent: ItemElement | undefined
  readonly ownerDocument: Document
  focus = vi.fn((_options?: FocusOptions) => {
    Object.assign(this.ownerDocument, { activeElement: this })
  })
  constructor(document: Document, parent?: ItemElement) {
    super()
    this.ownerDocument = document
    this.parent = parent
    parent?.children.push(this)
  }
  contains(node: Node): boolean {
    return node === this.asElement() || this.children.some((child) => child.contains(node))
  }
  getRootNode() {
    return this.ownerDocument
  }
  asElement() {
    return this as unknown as HTMLElement
  }
}

function focusOut(element: ItemElement, relatedTarget: ItemElement | null = null) {
  const event = new Event('focusout')
  Object.defineProperty(event, 'relatedTarget', { value: relatedTarget })
  element.dispatchEvent(event)
}

function setup(count = 1_000, limit = 8) {
  const env = createResizeEnvironment()
  Object.assign(env.document, { activeElement: null })
  const root = new VirtualElement(env.document),
    list = new VirtualElement(env.document)
  root.clientHeight = 100
  root.scrollTop = 0
  const listOffset = shallowRef(40)
  list.getBoundingClientRect.mockImplementation(
    () =>
      ({
        ...list.rect,
        top: root.rect.top + root.clientTop + listOffset.value - root.scrollTop,
      }) as DOMRect,
  )
  const scrollElement = shallowRef(root.asElement()),
    listElement = shallowRef<HTMLElement | null>(list.asElement())
  const items = shallowRef<readonly { key: VirtualItemKey; entity: string }[]>(
    Array.from({ length: count }, (_, key) => ({ key, entity: `entity:${key % 3}` })),
  )
  const columns = shallowRef(1),
    size = shallowRef(20),
    enabled = shallowRef(true)
  const getKey = vi.fn((item: (typeof items.value)[number]) => item.key)
  const geometry = computed<VirtualItemRetentionGeometry>(() => {
    const index = createVirtualItemIndex(items.value, getKey)
    const width = columns.value,
      height = size.value
    return {
      count: index.keys.length,
      totalSize: Math.ceil(index.keys.length / width) * height,
      indexOf: index.indexOf,
      getItem(position) {
        const key = index.keys[position]
        if (key === undefined) return undefined
        const start = Math.floor(position / width) * height
        return { key, start, end: start + height }
      },
    }
  })
  const beforeScroll = vi.fn(),
    rejected = vi.fn()
  const resumeReorder = vi.fn(),
    suspendReorder = vi.fn(() => resumeReorder)
  const scope = effectScope()
  const result = scope.run(() => {
    const context = useVirtualScrollContext({ scrollElement, listElement, enabled })
    return {
      context,
      retention: useVirtualItemRetention({
        context,
        geometry,
        limit,
        beforeScroll,
        suspendReorder,
        onRetentionRejected: rejected,
      }),
    }
  })!
  const unit = (key: VirtualItemKey) => {
    const element = new ItemElement(env.document)
    const release = result.retention.registerItem(key, element.asElement())
    return { element, release }
  }
  return {
    ...env,
    ...result,
    root,
    list,
    listOffset,
    scrollElement,
    listElement,
    enabled,
    items,
    columns,
    size,
    getKey,
    geometry,
    beforeScroll,
    rejected,
    suspendReorder,
    resumeReorder,
    unit,
    stop: () => scope.stop(),
  }
}

describe('bounded virtual item interaction retention', () => {
  it('suspends semantic compensation through overlapping source/destination holds and releases once', () => {
    const test = setup(10, 2)
    const focus = test.retention.retain(0, 'focus')!
    const source = test.retention.retain(0, 'reorder')!
    const destination = test.retention.retain(1, 'reorder')!
    const again = test.retention.retain(0, 'reorder')!
    expect(test.suspendReorder).toHaveBeenCalledOnce()
    expect(test.retention.retain(2, 'reorder')).toBeUndefined()
    destination()
    source()
    expect(test.resumeReorder).not.toHaveBeenCalled()
    again()
    expect(test.resumeReorder).toHaveBeenCalledOnce()
    expect(test.retention.retainedKeys.value).toEqual([0])
    const next = test.retention.retain(1, 'reorder')!
    test.stop()
    expect(test.resumeReorder).toHaveBeenCalledTimes(2)
    source()
    destination()
    again()
    next()
    focus()
    expect(test.resumeReorder).toHaveBeenCalledTimes(2)
  })

  it.each([0, -1, 1.5, 33, Infinity, NaN])('rejects invalid hard cap %s', (limit) => {
    expect(() => setup(10, limit)).toThrow(RangeError)
  })

  it('reference-counts focus/editor/popover holds on the same occurrence and releases idempotently', () => {
    const test = setup()
    try {
      const editor = test.retention.retain(80, 'editor')!,
        secondEditor = test.retention.retain(80, 'editor')!,
        menu = test.retention.retain(80, 'popover')!
      expect(test.retention.retainedKeys.value).toEqual([80])
      expect(test.retention.retainedIndexes.value).toEqual([80])
      editor()
      editor()
      menu()
      expect(test.retention.retainedKeys.value).toEqual([80])
      secondEditor()
      expect(test.retention.retainedKeys.value).toEqual([])
      expect(test.retention.retain('missing', 'editor')).toBeUndefined()
    } finally {
      test.stop()
    }
  })

  it('rejects a new occurrence at capacity without evicting an active editor or a shared-key holder', () => {
    const test = setup(80, 1)
    try {
      const editor = test.retention.retain(1, 'editor')!
      const menu = test.retention.retain(1, 'popover')!
      expect(test.retention.retain(2, 'editor')).toBeUndefined()
      expect(test.rejected).toHaveBeenCalledWith(2, 'editor')
      expect(test.retention.retainedKeys.value).toEqual([1])
      editor()
      expect(test.retention.retainedIndexes.value).toEqual([1])
      menu()
      expect(test.retention.retain(2, 'editor')).toBeTypeOf('function')
    } finally {
      test.stop()
    }
  })

  it('tracks occurrence identity through sorting, including duplicate entities, without rescanning on scroll', async () => {
    const test = setup(10_000)
    try {
      test.retention.retain(0, 'editor')
      test.retention.retain(3, 'popover')
      expect(test.items.value[0]!.entity).toBe(test.items.value[3]!.entity)
      test.items.value = test.items.value.toReversed()
      expect(test.retention.retainedKeys.value).toEqual([0, 3])
      expect(test.retention.retainedIndexes.value).toEqual([9_996, 9_999])
      test.getKey.mockClear()
      test.root.getBoundingClientRect.mockClear()
      test.list.getBoundingClientRect.mockClear()
      for (const offset of [2_000, 99_000, 10]) {
        test.root.scrollTop = offset
        test.root.dispatchEvent(new Event('scroll'))
        expect(test.retention.retainedIndexes.value).toEqual([9_996, 9_999])
      }
      await nextTick()
      expect(test.getKey).not.toHaveBeenCalled()
      expect(test.root.getBoundingClientRect).not.toHaveBeenCalled()
      expect(test.list.getBoundingClientRect).not.toHaveBeenCalled()
    } finally {
      test.stop()
    }
  })

  it('forgets removed occurrences and prevents a late release from touching a reinserted key', () => {
    const test = setup(80)
    try {
      const staleRelease = test.retention.retain(7, 'editor')!
      const original = test.items.value[7]!
      test.items.value = test.items.value.filter((item) => item.key !== 7)
      expect(test.retention.retainedKeys.value).toEqual([])
      test.items.value = [...test.items.value, original]
      const currentRelease = test.retention.retain(7, 'editor')!
      staleRelease()
      expect(test.retention.retainedIndexes.value).toEqual([79])
      currentRelease()
      expect(test.retention.retainedKeys.value).toEqual([])
    } finally {
      test.stop()
    }
  })

  it('retains focus across controls within an item and releases when focus leaves the item', () => {
    const test = setup()
    try {
      const unit = test.unit(4)
      const child = new ItemElement(test.document, unit.element)
      unit.element.dispatchEvent(new Event('focusin'))
      expect(test.retention.retainedIndexes.value).toEqual([4])
      focusOut(unit.element, child)
      expect(test.retention.retainedIndexes.value).toEqual([4])
      focusOut(unit.element)
      expect(test.retention.retainedKeys.value).toEqual([])
    } finally {
      test.stop()
    }
  })

  it('keeps an IME composition mounted through temporary blur, without resetting an editor hold', () => {
    const test = setup()
    try {
      const unit = test.unit(4),
        releaseEditor = test.retention.retain(4, 'editor')!
      unit.element.dispatchEvent(new Event('focusin'))
      unit.element.dispatchEvent(new Event('compositionstart'))
      focusOut(unit.element)
      releaseEditor()
      expect(test.retention.retainedKeys.value).toEqual([4])
      unit.element.dispatchEvent(new Event('compositionend'))
      expect(test.retention.retainedKeys.value).toEqual([])
    } finally {
      test.stop()
    }
  })

  it('removes focus/composition listeners on unmount while explicit editing remains caller-owned', () => {
    const test = setup()
    try {
      const unit = test.unit(4),
        releaseEditor = test.retention.retain(4, 'editor')!
      const remove = vi.spyOn(unit.element, 'removeEventListener')
      unit.element.dispatchEvent(new Event('focusin'))
      unit.element.dispatchEvent(new Event('compositionstart'))
      unit.release()
      unit.release()
      expect(remove).toHaveBeenCalledTimes(4)
      expect(test.retention.retainedKeys.value).toEqual([4])
      releaseEditor()
      unit.element.dispatchEvent(new Event('focusin'))
      expect(test.retention.retainedKeys.value).toEqual([])
    } finally {
      test.stop()
    }
  })

  it('invalidates the old registration when a mounted element is recycled to another occurrence', async () => {
    const test = setup()
    try {
      const unit = test.unit(4)
      unit.element.dispatchEvent(new Event('focusin'))
      test.retention.registerItem(5, unit.element.asElement())
      unit.release()
      expect(test.retention.retainedKeys.value).toEqual([])
      expect(await test.retention.focusItem(4)).toBe(false)
      expect(unit.element.focus).not.toHaveBeenCalled()
      expect(await test.retention.focusItem(5)).toBe(true)
      expect(test.retention.retainedKeys.value).toEqual([5])
    } finally {
      test.stop()
    }
  })

  it('scrolls an offscreen original occurrence into range before focusing its registered control', async () => {
    const test = setup()
    try {
      const pending = test.retention.focusItem(80, {
        target: (element) => element.children[0] as HTMLElement,
      })
      expect(test.retention.retainedIndexes.value).toEqual([80])
      expect(test.root.scrollTop).toBe(1_560)
      expect(test.context.metrics.value.scrollOffset).toBe(1_560)
      const unit = test.unit(80)
      const input = new ItemElement(test.document, unit.element)
      expect(await pending).toBe(true)
      expect(input.focus).toHaveBeenCalledWith({ preventScroll: true })
      expect(unit.element.focus).not.toHaveBeenCalled()
      expect(test.retention.retainedKeys.value).toEqual([80])
      expect(test.beforeScroll).toHaveBeenCalledOnce()
      focusOut(unit.element)
      expect(test.retention.retainedKeys.value).toEqual([])
    } finally {
      test.stop()
    }
  })

  it.each(['start', 'center', 'end', 'auto'] as const)(
    'uses %s alignment in list coordinates with a header',
    (align) => {
      const test = setup()
      try {
        expect(test.retention.scrollToKey(80, { align })).toBe(true)
        const expected = { start: 1_640, center: 1_600, end: 1_560, auto: 1_560 }
        expect(test.root.scrollTop).toBe(expected[align])
        expect(test.retention.retainedKeys.value).toEqual([])
      } finally {
        test.stop()
      }
    },
  )

  it('maps keyed navigation to the current grid row and clamps at the final extent', () => {
    const test = setup(81)
    try {
      test.columns.value = 3
      expect(test.retention.scrollToKey(80, { align: 'start' })).toBe(true)
      expect(test.root.scrollTop).toBe(480)
      expect(test.context.metrics.value.scrollOffset).toBe(480)
      expect(test.retention.scrollToKey('missing')).toBe(false)
      expect(test.root.scrollTop).toBe(480)
    } finally {
      test.stop()
    }
  })

  it('does not scroll an already fully visible item during automatic navigation', () => {
    const test = setup()
    try {
      expect(test.retention.scrollToKey(1)).toBe(true)
      expect(test.root.scrollTop).toBe(0)
    } finally {
      test.stop()
    }
  })

  it.each(['wheel', 'touchstart', 'pointerdown', 'keydown'])(
    'cancels queued focus on new %s input',
    async (type) => {
      const test = setup()
      try {
        const unit = test.unit(80)
        const focus = test.retention.focusItem(80)
        test.root.dispatchEvent(new Event(type))
        expect(await focus).toBe(false)
        expect(unit.element.focus).not.toHaveBeenCalled()
        expect(test.retention.retainedKeys.value).toEqual([])
      } finally {
        test.stop()
      }
    },
  )

  it('ignores the matching programmatic scroll task but cancels a newer manual scroll', async () => {
    const test = setup()
    try {
      const unit = test.unit(80)
      const first = test.retention.focusItem(80)
      test.root.dispatchEvent(new Event('scroll'))
      expect(await first).toBe(true)
      focusOut(unit.element)
      const second = test.retention.focusItem(80)
      test.root.scrollTop += 5
      test.root.dispatchEvent(new Event('scroll'))
      expect(await second).toBe(false)
      expect(unit.element.focus).toHaveBeenCalledOnce()
      expect(test.retention.retainedKeys.value).toEqual([])
    } finally {
      test.stop()
    }
  })

  it('cancels old focus requests on deliberate navigation or a newer focus request', async () => {
    const test = setup()
    try {
      const old = test.unit(80),
        current = test.unit(90)
      const first = test.retention.focusItem(80)
      const second = test.retention.focusItem(90)
      expect(await first).toBe(false)
      expect(await second).toBe(true)
      expect(old.element.focus).not.toHaveBeenCalled()
      expect(current.element.focus).toHaveBeenCalledOnce()
      focusOut(current.element)
      const third = test.retention.focusItem(80)
      test.retention.scrollToKey(5)
      expect(await third).toBe(false)
      expect(test.retention.retainedKeys.value).toEqual([])
    } finally {
      test.stop()
    }
  })

  it('fails boundedly for a missing, disconnected, foreign or explicitly absent focus target', async () => {
    const test = setup()
    try {
      expect(await test.retention.focusItem(80)).toBe(false)
      const unit = test.unit(80)
      unit.element.isConnected = false
      expect(await test.retention.focusItem(80)).toBe(false)
      unit.element.isConnected = true
      const foreign = new ItemElement(test.document)
      expect(await test.retention.focusItem(80, { target: () => foreign.asElement() })).toBe(false)
      expect(await test.retention.focusItem(80, { target: () => null })).toBe(false)
      expect(unit.element.focus).not.toHaveBeenCalled()
      expect(foreign.focus).not.toHaveBeenCalled()
      expect(test.retention.retainedKeys.value).toEqual([])
    } finally {
      test.stop()
    }
  })

  it('confirms the requested control actually acquired focus rather than another control in the same item', async () => {
    const test = setup()
    try {
      const unit = test.unit(80),
        current = new ItemElement(test.document, unit.element),
        requested = new ItemElement(test.document, unit.element)
      Object.assign(test.document, { activeElement: current })
      requested.focus.mockImplementation(() => {})
      expect(await test.retention.focusItem(80, { target: () => requested.asElement() })).toBe(
        false,
      )
      expect(requested.focus).toHaveBeenCalledOnce()
      expect(test.retention.retainedKeys.value).toEqual([])
    } finally {
      test.stop()
    }
  })

  it('releases pending navigation if the native focus attempt throws', async () => {
    const test = setup()
    try {
      const unit = test.unit(80)
      unit.element.focus.mockImplementation(() => {
        throw new Error('Rejected focus')
      })
      await expect(test.retention.focusItem(80)).rejects.toThrow('Rejected focus')
      expect(test.retention.retainedKeys.value).toEqual([])
    } finally {
      test.stop()
    }
  })

  it('rejects an already aborted focus without scrolling or borrowing a hold', async () => {
    const test = setup()
    try {
      const unit = test.unit(80)
      const controller = new AbortController()
      controller.abort()
      expect(await test.retention.focusItem(80, { signal: controller.signal })).toBe(false)
      expect(test.root.scrollTop).toBe(0)
      expect(test.retention.retainedKeys.value).toEqual([])
      expect(unit.element.focus).not.toHaveBeenCalled()
    } finally {
      test.stop()
    }
  })

  it('an old focus signal cannot cancel a newer navigation or leak its abort listener', async () => {
    const test = setup()
    try {
      const old = test.unit(80),
        next = test.unit(90)
      const controller = new AbortController()
      const removeListener = vi.spyOn(controller.signal, 'removeEventListener')
      const first = test.retention.focusItem(80, { signal: controller.signal })
      const second = test.retention.focusItem(90)
      controller.abort()
      expect(await first).toBe(false)
      expect(await second).toBe(true)
      expect(old.element.focus).not.toHaveBeenCalled()
      expect(next.element.focus).toHaveBeenCalledOnce()
      expect(test.retention.retainedKeys.value).toEqual([90])
      expect(removeListener).toHaveBeenCalledWith('abort', expect.any(Function))
    } finally {
      test.stop()
    }
  })

  it('does not scroll after its deliberate-navigation hook aborts the pending focus', async () => {
    const test = setup()
    try {
      const unit = test.unit(80)
      const controller = new AbortController()
      test.beforeScroll.mockImplementation(() => controller.abort())
      expect(await test.retention.focusItem(80, { signal: controller.signal })).toBe(false)
      expect(test.root.scrollTop).toBe(0)
      expect(test.retention.retainedKeys.value).toEqual([])
      expect(unit.element.focus).not.toHaveBeenCalled()
    } finally {
      test.stop()
    }
  })

  it.each([40, 10])(
    'realigns measured geometry before focus when row size becomes %i',
    async (size) => {
      const test = setup()
      try {
        const unit = test.unit(80)
        const pending = test.retention.focusItem(80)
        test.size.value = size
        expect(await pending).toBe(true)
        const item = test.geometry.value.getItem(80)!
        expect(test.root.scrollTop).toBeLessThanOrEqual(test.listOffset.value + item.start)
        expect(test.root.scrollTop + test.root.clientHeight).toBeGreaterThanOrEqual(
          test.listOffset.value + item.end,
        )
        expect(unit.element.focus).toHaveBeenCalledOnce()
        expect(test.beforeScroll).toHaveBeenCalledOnce()
        expect(test.retention.retainedKeys.value).toEqual([80])
      } finally {
        test.stop()
      }
    },
  )

  it.each(['[inert]', '[hidden]', '[aria-hidden="true"]'])(
    'does not restore pending focus into an unavailable composed ancestor: %s',
    async (selector) => {
      const test = setup()
      try {
        const unit = test.unit(80)
        let hidden = false
        const host = {
          closest: vi.fn(() => (hidden ? host : null)),
          getRootNode: () => test.document,
        }
        vi.spyOn(unit.element, 'getRootNode').mockImplementation(
          () =>
            ({
              host,
              activeElement: null,
            }) as unknown as Document,
        )
        const pending = test.retention.focusItem(80)
        hidden = true
        expect(await pending).toBe(false)
        expect(host.closest).toHaveBeenCalledWith(expect.stringContaining(selector))
        expect(unit.element.focus).not.toHaveBeenCalled()
        expect(test.retention.retainedKeys.value).toEqual([])
      } finally {
        test.stop()
      }
    },
  )

  it('does not write a scroll after the deliberate-navigation hook disposes its owner', () => {
    const test = setup()
    test.beforeScroll.mockImplementation(() => test.stop())
    expect(test.retention.scrollToKey(80)).toBe(false)
    expect(test.root.scrollTop).toBe(0)
  })

  it('rechecks the occurrence after the deliberate-navigation hook changes the collection', () => {
    const test = setup()
    try {
      test.beforeScroll.mockImplementation(() => {
        test.items.value = test.items.value.filter((item) => item.key !== 80)
      })
      expect(test.retention.scrollToKey(80)).toBe(false)
      expect(test.root.scrollTop).toBe(0)
    } finally {
      test.stop()
    }
  })

  it('does not focus a recycled registration or an occurrence removed during the queued mount', async () => {
    const test = setup()
    try {
      const unit = test.unit(80)
      const focus = test.retention.focusItem(80)
      test.items.value = test.items.value.filter((item) => item.key !== 80)
      test.retention.registerItem(81, unit.element.asElement())
      expect(await focus).toBe(false)
      expect(unit.element.focus).not.toHaveBeenCalled()
      expect(test.retention.retainedKeys.value).toEqual([])
    } finally {
      test.stop()
    }
  })

  it('cancels during hidden/replaced roots while preserving caller-owned editing until close', async () => {
    const test = setup()
    try {
      const unit = test.unit(80),
        releaseEditor = test.retention.retain(80, 'editor')!
      const focus = test.retention.focusItem(80)
      test.enabled.value = false
      await nextTick()
      expect(await focus).toBe(false)
      expect(unit.element.focus).not.toHaveBeenCalled()
      expect(test.retention.retainedKeys.value).toEqual([80])
      test.enabled.value = true
      await nextTick()
      expect(await test.retention.focusItem(80)).toBe(false)
      test.unit(80)
      const second = test.retention.focusItem(80)
      test.scrollElement.value = new VirtualElement(test.document).asElement()
      await nextTick()
      expect(await second).toBe(false)
      expect(test.retention.retainedKeys.value).toEqual([80])
      releaseEditor()
      expect(test.retention.retainedKeys.value).toEqual([])
    } finally {
      test.stop()
    }
  })

  it('cleans every hold/listener and cancels queued focus on scope disposal', async () => {
    const test = setup()
    const removeRoot = vi.spyOn(test.root, 'removeEventListener')
    const unit = test.unit(80)
    const removeItem = vi.spyOn(unit.element, 'removeEventListener')
    const release = test.retention.retain(3, 'popover')!
    const focus = test.retention.focusItem(80)
    test.stop()
    expect(await focus).toBe(false)
    expect(test.retention.retainedKeys.value).toEqual([])
    expect(test.retention.retainedIndexes.value).toEqual([])
    expect(unit.element.focus).not.toHaveBeenCalled()
    expect(removeItem).toHaveBeenCalledTimes(4)
    expect(removeRoot.mock.calls.map(([type]) => type)).toEqual(
      expect.arrayContaining(['wheel', 'touchstart', 'pointerdown', 'keydown', 'scroll']),
    )
    release()
    expect(test.retention.retain(1, 'editor')).toBeUndefined()
    expect(test.retention.scrollToKey(1)).toBe(false)
  })
})
