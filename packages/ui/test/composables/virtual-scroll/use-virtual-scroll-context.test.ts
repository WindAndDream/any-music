import { afterEach, describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick, shallowRef } from 'vue'

import { useVirtualScrollContext } from '../../../src/virtual-scroll'
import {
  createResizeEnvironment,
  VirtualElement,
} from '../../fixtures/virtual-scroll/resize-observer'

afterEach(() => vi.unstubAllGlobals())
function setupContext() {
  const env = createResizeEnvironment()
  const root = new VirtualElement(env.document),
    list = new VirtualElement(env.document)
  list.rect.top = 132
  list.rect.left = 173
  list.rect.width = 450
  const listElement = shallowRef<HTMLElement | null>(list.asElement())
  const scrollElement = shallowRef<HTMLElement | null>(root.asElement())
  const enabled = shallowRef(true),
    axis = shallowRef<'vertical' | 'horizontal'>('vertical')
  const scope = effectScope()
  const context = scope.run(() =>
    useVirtualScrollContext({ listElement, scrollElement, enabled, axis }),
  )!
  return {
    ...env,
    root,
    list,
    listElement,
    scrollElement,
    enabled,
    axis,
    context,
    stop: () => scope.stop(),
  }
}

describe('virtual scroll context', () => {
  it('uses zero content origin when the list is its own scroll root', () => {
    const env = createResizeEnvironment()
    const root = new VirtualElement(env.document)
    const scope = effectScope()
    const context = scope.run(() =>
      useVirtualScrollContext({ listElement: root.asElement(), scrollElement: root.asElement() }),
    )!
    try {
      expect(context.metrics.value.listOffset).toBe(0)
      expect(env.observers[0]!.observe).toHaveBeenCalledTimes(1)
      root.scrollTop = 300
      context.refresh()
      expect(context.metrics.value.listOffset).toBe(0)
    } finally {
      scope.stop()
    }
  })

  it('updates a preceding header offset once per batch without publishing unchanged metrics', () => {
    const env = createResizeEnvironment()
    const root = new VirtualElement(env.document),
      list = new VirtualElement(env.document),
      header = new VirtualElement(env.document)
    const scope = effectScope()
    const context = scope.run(() =>
      useVirtualScrollContext({
        listElement: list.asElement(),
        scrollElement: root.asElement(),
        offsetElements: [header.asElement()],
      }),
    )!
    try {
      const initial = context.metrics.value
      env.observers[0]!.notify([root.asElement(), list.asElement(), header.asElement()])
      expect(context.metrics.value).toBe(initial)
      list.rect.top += 40
      env.observers[0]!.notify([header.asElement()])
      expect(context.metrics.value.listOffset).toBe(initial.listOffset + 40)
    } finally {
      scope.stop()
    }
    expect(env.observers[0]!.unobserve).toHaveBeenCalledTimes(3)
  })

  it('uses an injected nested/Shadow viewport, border and header offset, without per-scroll rect reads', () => {
    const test = setupContext()
    try {
      expect(test.context.metrics.value).toEqual({
        ready: true,
        viewportWidth: 500,
        viewportHeight: 300,
        listWidth: 450,
        scrollOffset: 80,
        listOffset: 200,
      })
      expect(test.observers[0]!.observe).toHaveBeenCalledTimes(2)
      test.root.getBoundingClientRect.mockClear()
      test.list.getBoundingClientRect.mockClear()
      test.root.scrollTop = 240
      test.root.dispatchEvent(new Event('scroll'))
      expect(test.context.metrics.value.scrollOffset).toBe(240)
      expect(test.context.metrics.value.listOffset).toBe(200)
      expect(test.root.getBoundingClientRect).not.toHaveBeenCalled()
      expect(test.list.getBoundingClientRect).not.toHaveBeenCalled()
      test.list.rect.top = -18
      test.observers[0]!.notify([test.root.asElement(), test.list.asElement()])
      expect(test.list.getBoundingClientRect).toHaveBeenCalledOnce()
      expect(test.context.metrics.value.listOffset).toBe(210)
    } finally {
      test.stop()
    }
  })

  it('suspends zero-size/hidden lists and resumes without retaining stale viewport geometry', () => {
    const test = setupContext()
    try {
      test.root.clientHeight = 0
      test.observers[0]!.notify([test.root.asElement()])
      expect(test.context.metrics.value.ready).toBe(false)
      expect(test.context.metrics.value.viewportHeight).toBe(0)
      test.root.clientHeight = 300
      test.list.rect.width = 0
      test.observers[0]!.notify([test.list.asElement()])
      expect(test.context.metrics.value.ready).toBe(false)
      test.list.rect.width = 420
      test.observers[0]!.notify([test.list.asElement()])
      expect(test.context.metrics.value.ready).toBe(true)
      expect(test.context.metrics.value.listWidth).toBe(420)
    } finally {
      test.stop()
    }
  })

  it('rebinds responsive roots, disables and disposes all listeners, and ignores old observer callbacks', async () => {
    const test = setupContext()
    const previous = test.observers[0]!
    const nextRoot = new VirtualElement(test.document)
    nextRoot.scrollTop = 30
    test.scrollElement.value = nextRoot.asElement()
    await nextTick()
    expect(previous.disconnect).toHaveBeenCalledOnce()
    expect(test.context.scrollElement.value).toBe(nextRoot.asElement())
    test.root.scrollTop = 900
    test.root.dispatchEvent(new Event('scroll'))
    previous.notify([test.root.asElement(), test.list.asElement()])
    expect(test.context.metrics.value.scrollOffset).toBe(30)
    test.enabled.value = false
    await nextTick()
    expect(test.context.metrics.value.ready).toBe(false)
    expect(test.context.scrollElement.value).toBeNull()
    test.enabled.value = true
    await nextTick()
    expect(test.context.metrics.value.ready).toBe(true)
    test.stop()
    expect(test.context.metrics.value.ready).toBe(false)
    nextRoot.scrollTop = 200
    nextRoot.dispatchEvent(new Event('scroll'))
    expect(test.context.metrics.value.scrollOffset).toBe(0)
    expect(test.observers.every((observer) => observer.disconnect.mock.calls.length === 1)).toBe(
      true,
    )
  })

  it('supports horizontal physical coordinates and explicit layout refresh without global window scrolling', async () => {
    const test = setupContext()
    try {
      test.root.scrollLeft = -50
      test.axis.value = 'horizontal'
      await nextTick()
      expect(test.context.metrics.value.listOffset).toBe(100)
      expect(test.context.metrics.value.scrollOffset).toBe(-50)
      test.list.rect.left = 183
      test.context.refresh()
      expect(test.context.metrics.value.listOffset).toBe(110)
    } finally {
      test.stop()
    }
  })

  it('shares one observer between contexts and keeps the surviving context active', () => {
    const test = setupContext()
    const scope = effectScope()
    const secondList = new VirtualElement(test.document)
    const second = scope.run(() =>
      useVirtualScrollContext({
        listElement: secondList.asElement(),
        scrollElement: test.root.asElement(),
      }),
    )!
    expect(test.observers).toHaveLength(1)
    expect(test.observers[0]!.observe).toHaveBeenCalledTimes(3)
    test.stop()
    expect(test.observers[0]!.disconnect).not.toHaveBeenCalled()
    test.root.scrollTop = 500
    test.root.dispatchEvent(new Event('scroll'))
    expect(second.metrics.value.scrollOffset).toBe(500)
    scope.stop()
    expect(test.observers[0]!.disconnect).toHaveBeenCalledOnce()
  })

  it('uses only the owning view for resize fallback and supports initially absent elements', async () => {
    vi.stubGlobal('ResizeObserver', undefined)
    const addGlobal = vi.fn()
    vi.stubGlobal('window', { addEventListener: addGlobal })
    const view = new EventTarget()
    const document = { defaultView: view } as unknown as Document
    const root = new VirtualElement(document),
      list = new VirtualElement(document)
    const element = shallowRef<HTMLElement | null>(null)
    const scope = effectScope()
    const context = scope.run(() =>
      useVirtualScrollContext({ listElement: element, scrollElement: root.asElement() }),
    )!
    expect(context.metrics.value.ready).toBe(false)
    element.value = list.asElement()
    await nextTick()
    expect(context.metrics.value.ready).toBe(true)
    root.clientHeight = 200
    view.dispatchEvent(new Event('resize'))
    expect(context.metrics.value.viewportHeight).toBe(200)
    expect(addGlobal).not.toHaveBeenCalled()
    scope.stop()
    view.dispatchEvent(new Event('resize'))
    expect(context.metrics.value.ready).toBe(false)
  })
})
