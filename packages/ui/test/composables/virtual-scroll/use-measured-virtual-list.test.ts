import { describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick, ref, shallowRef } from 'vue'

import {
  useMeasuredVirtualList,
  useVirtualItemMeasurements,
  useVirtualScrollContext,
} from '../../../src/virtual-scroll'
import {
  createResizeEnvironment,
  VirtualElement,
} from '../../fixtures/virtual-scroll/resize-observer'

async function settle() {
  await nextTick()
  await nextTick()
}

function setup(count = 80, cacheLimit = 16) {
  const env = createResizeEnvironment()
  const root = new VirtualElement(env.document),
    list = new VirtualElement(env.document)
  root.clientHeight = 100
  root.scrollTop = 0
  list.rect.top = 12
  const items = ref(
    Array.from({ length: count }, (_, key) => ({ key, title: 'Title', tags: '', expanded: false })),
  )
  const scrollElement = shallowRef(root.asElement()),
    listElement = shallowRef<HTMLElement | null>(list.asElement())
  const layoutGeneration = ref('standard'),
    enabled = ref(true),
    estimatedItemSize = ref(20)
  const getItemKey = vi.fn((item: (typeof items.value)[number]) => item.key)
  const scope = effectScope()
  const result = scope.run(() =>
    useMeasuredVirtualList({
      items,
      getItemKey,
      estimatedItemSize,
      scrollElement,
      listElement,
      layoutGeneration,
      enabled,
      cacheLimit,
      getContentGeneration: (item) => `${item.title}|${item.tags}|${item.expanded}`,
    }),
  )!
  const elements: VirtualElement[] = []
  function mount(key: number, height: number) {
    const element = new VirtualElement(env.document)
    element.rect.height = height
    elements.push(element)
    const release = result.measurements.observeItem(key, element.asElement())
    return { element, release }
  }
  return {
    ...env,
    root,
    list,
    items,
    scrollElement,
    listElement,
    enabled,
    layoutGeneration,
    estimatedItemSize,
    getItemKey,
    result,
    mount,
    elements,
    stop: () => scope.stop(),
  }
}

describe('measured virtual list (injected geometry; no browser layout)', () => {
  it('measures natural growth and shrinking, updates offsets/extent and deduplicates unchanged reports', async () => {
    const test = setup()
    try {
      const first = test.mount(0, 42.5),
        second = test.mount(1, 28)
      await settle()
      expect(test.result.totalSize.value).toBe(1_630.5)
      expect(test.result.virtualItems.value[1]).toMatchObject({ start: 42.5, size: 28, end: 70.5 })
      first.element.rect.height = 90
      second.element.rect.height = 12
      test.observers[0]!.notify([first.element.asElement(), second.element.asElement()])
      await settle()
      expect(test.result.totalSize.value).toBe(1_662)
      expect(test.result.virtualItems.value[1]).toMatchObject({ start: 90, size: 12, end: 102 })
      first.element.rect.height = 10
      test.observers[0]!.notify([first.element.asElement()])
      await settle()
      expect(test.result.virtualItems.value[1]!.start).toBe(10)
      const revision = test.result.measurements.revision.value
      test.observers[0]!.notify([first.element.asElement(), second.element.asElement()])
      await settle()
      expect(test.result.measurements.revision.value).toBe(revision)
      expect(test.root.scrollTop).toBe(0)
    } finally {
      test.stop()
    }
  })

  it('uses one document pool for context and mounted units, with reads before one batch publication', async () => {
    const test = setup(10_000)
    try {
      const first = test.mount(0, 30),
        second = test.mount(1, 40)
      const observedRevisions: number[] = []
      for (const target of [first.element, second.element])
        target.getBoundingClientRect.mockImplementation(() => {
          observedRevisions.push(test.result.measurements.revision.value)
          return target.rect as DOMRect
        })
      await settle()
      expect(observedRevisions).toEqual([0, 0])
      expect(test.result.measurements.revision.value).toBe(1)
      expect(test.observers).toHaveLength(1)
      expect(test.observers[0]!.observe).toHaveBeenCalledTimes(4)
      expect(test.result.measurements.cacheSize.value).toBe(2)
      test.getItemKey.mockClear()
      first.element.getBoundingClientRect.mockClear()
      second.element.getBoundingClientRect.mockClear()
      test.root.scrollTop = 10_000
      test.root.dispatchEvent(new Event('scroll'))
      await settle()
      expect(test.result.virtualItems.value.length).toBeLessThanOrEqual(10)
      expect(test.getItemKey).not.toHaveBeenCalled()
      expect(first.element.getBoundingClientRect).not.toHaveBeenCalled()
      expect(second.element.getBoundingClientRect).not.toHaveBeenCalled()
      first.release()
      second.release()
      expect(test.observers[0]!.unobserve).toHaveBeenCalledTimes(2)
    } finally {
      test.stop()
    }
    expect(test.observers.every((observer) => observer.disconnect.mock.calls.length === 1)).toBe(
      true,
    )
  })

  it('remeasures a width batch before the estimate patch, discarding offscreen heights without duplicate reads', async () => {
    const test = setup()
    const first = test.mount(0, 40),
      second = test.mount(1, 60),
      last = test.mount(2, 80)
    await settle()
    second.release()
    first.element.rect.height = 90
    last.element.rect.height = 10
    first.element.getBoundingClientRect.mockClear()
    last.element.getBoundingClientRect.mockClear()
    const revisions: number[] = []
    for (const target of [first.element, last.element])
      target.getBoundingClientRect.mockImplementation(() => {
        revisions.push(test.result.measurements.revision.value)
        return target.rect as DOMRect
      })
    try {
      test.result.measurements.refresh() // A queued old-width job must be replaced too.
      test.list.rect.width = 600
      test.observers[0]!.notify([test.list.asElement()])
      expect(test.result.measurements.getHeight(0)).toBe(90)
      expect(test.result.measurements.getHeight(2)).toBe(10)
      expect(test.result.measurements.getHeight(1)).toBeUndefined()
      expect(revisions).toHaveLength(2)
      expect(revisions[0]).toBe(revisions[1])
      await settle()
      expect(first.element.getBoundingClientRect).toHaveBeenCalledOnce()
      expect(last.element.getBoundingClientRect).toHaveBeenCalledOnce()
    } finally {
      test.stop()
    }
  })

  it('keeps mounted subscriptions stable through continuous width, layout and content changes', async () => {
    const test = setup()
    try {
      const element = new VirtualElement(test.document)
      element.rect.height = 40
      const add = vi.spyOn(element, 'addEventListener')
      const remove = vi.spyOn(element, 'removeEventListener')
      const target = {
        element,
        release: test.result.measurements.observeItem(0, element.asElement()),
      }
      await settle()
      const observer = test.observers[0]!
      const registrations = observer.observe.mock.calls.length
      const releases = observer.unobserve.mock.calls.length
      expect(add).toHaveBeenCalledExactlyOnceWith('load', expect.any(Function), true)
      for (let frame = 1; frame <= 12; frame++) {
        // Reports queued before a new generation must coalesce with its fresh measurement.
        target.element.getBoundingClientRect.mockClear()
        observer.notify([target.element.asElement()])
        target.element.dispatchEvent(new Event('load'))
        target.element.rect.height = 40 + frame
        test.list.rect.width = 500 + frame
        test.layoutGeneration.value = `font-${frame}`
        test.items.value[0]!.title = `Title ${frame}`
        observer.notify([test.list.asElement()])
        // eslint-disable-next-line no-await-in-loop -- Each settled frame verifies correct visible geometry.
        await settle()
        expect(test.result.measurements.getHeight(0)).toBe(40 + frame)
        expect(target.element.getBoundingClientRect).toHaveBeenCalledTimes(1)
        expect(observer.observe).toHaveBeenCalledTimes(registrations)
        expect(observer.unobserve).toHaveBeenCalledTimes(releases)
        expect(add).toHaveBeenCalledTimes(1)
        expect(remove).not.toHaveBeenCalled()
      }
      target.release()
      expect(observer.unobserve).toHaveBeenCalledTimes(releases + 1)
      expect(remove).toHaveBeenCalledExactlyOnceWith('load', add.mock.calls[0]![1], true)
    } finally {
      test.stop()
    }
  })

  it('releases hidden subscriptions and rejects late reports from a replaced measurement unit', async () => {
    const test = setup()
    try {
      const element = new VirtualElement(test.document)
      element.rect.height = 40
      const add = vi.spyOn(element, 'addEventListener')
      const remove = vi.spyOn(element, 'removeEventListener')
      const previous = {
        element,
        release: test.result.measurements.observeItem(0, element.asElement()),
      }
      await settle()
      const oldLoad = add.mock.calls[0]![1] as EventListener
      const observer = test.observers[0]!
      previous.element.getBoundingClientRect.mockClear()
      previous.element.dispatchEvent(new Event('load'))
      test.root.clientHeight = 0
      observer.notify([test.root.asElement()])
      await settle()
      oldLoad(new Event('load'))
      observer.notify([previous.element.asElement()])
      await settle()
      expect(previous.element.getBoundingClientRect).not.toHaveBeenCalled()
      expect(remove).toHaveBeenCalledTimes(1)
      expect(test.result.measurements.getHeight(0)).toBe(40)

      test.root.clientHeight = 100
      previous.element.rect.height = 30
      observer.notify([test.root.asElement()])
      await settle()
      expect(add).toHaveBeenCalledTimes(2)
      expect(test.result.measurements.getHeight(0)).toBe(30)
      previous.element.getBoundingClientRect.mockClear()
      previous.element.dispatchEvent(new Event('load'))
      test.items.value[0]!.title = 'Replacement'
      const current = test.mount(0, 15)
      previous.release()
      oldLoad(new Event('load'))
      observer.notify([previous.element.asElement()])
      await settle()
      expect(previous.element.getBoundingClientRect).not.toHaveBeenCalled()
      expect(test.result.measurements.getHeight(0)).toBe(15)
      current.element.getBoundingClientRect.mockClear()
      observer.notify([current.element.asElement()])
      test.stop()
      await settle()
      expect(current.element.getBoundingClientRect).not.toHaveBeenCalled()
      expect(test.result.measurements.cacheSize.value).toBe(0)
    } finally {
      test.stop()
    }
  })

  it.each(['title', 'tags', 'expanded'] as const)(
    'invalidates %s edits on and off screen, then accepts smaller natural height',
    async (field) => {
      const test = setup()
      try {
        const first = test.mount(0, 70)
        await settle()
        first.release()
        test.items.value[0]![field] = (field === 'expanded' ? true : 'Edited') as never
        expect(test.result.measurements.getHeight(0)).toBeUndefined()
        expect(test.result.totalSize.value).toBe(1_600)
        const rebuilt = test.mount(0, 25)
        await settle()
        expect(test.result.measurements.getHeight(0)).toBe(25)
        rebuilt.element.rect.height = 10
        test.items.value[0]![field] = (field === 'expanded' ? false : 'Short') as never
        await settle()
        expect(test.result.measurements.getHeight(0)).toBe(10)
        expect(test.result.virtualItems.value[1]!.start).toBe(10)
      } finally {
        test.stop()
      }
    },
  )

  it('updates delayed artwork through pooled resize and local load without forcing any target height', async () => {
    const test = setup()
    try {
      const target = test.mount(0, 20)
      await settle()
      target.element.rect.height = 80
      target.element.dispatchEvent(new Event('load'))
      await settle()
      expect(test.result.measurements.getHeight(0)).toBe(80)
      target.element.rect.height = 15
      test.observers[0]!.notify([target.element.asElement()])
      await settle()
      expect(test.result.measurements.getHeight(0)).toBe(15)
      expect('style' in target.element).toBe(false)
    } finally {
      test.stop()
    }
  })

  it.each(['width', 'density'] as const)(
    'forgets previous %s heights including offscreen items and remeasures mounted units',
    async (change) => {
      const test = setup()
      try {
        const first = test.mount(0, 80),
          second = test.mount(1, 60)
        await settle()
        second.release()
        first.element.rect.height = 25
        if (change === 'width') {
          test.list.rect.width = 300
          test.observers[0]!.notify([test.list.asElement()])
        } else test.layoutGeneration.value = 'compact'
        await settle()
        expect(test.result.measurements.getHeight(0)).toBe(25)
        expect(test.result.measurements.getHeight(1)).toBeUndefined()
        expect(test.result.totalSize.value).toBe(1_605)
        first.element.rect.height = 90
        if (change === 'width') {
          test.list.rect.width = 500
          test.observers[0]!.notify([test.list.asElement()])
        } else test.layoutGeneration.value = 'standard'
        await settle()
        expect(test.result.measurements.getHeight(0)).toBe(90)
        expect(test.result.measurements.getHeight(1)).toBeUndefined()
      } finally {
        test.stop()
      }
    },
  )

  it('bounds remembered heights across repeated distant visits and reuses stable occurrence identity on reorder', async () => {
    const test = setup(10_000, 3)
    try {
      for (const key of [0, 900, 9_999, 100, 2_000, 0]) {
        const mounted = test.mount(key, 30 + (key % 3))
        // eslint-disable-next-line no-await-in-loop -- Each visit must commit and release before the next.
        await settle()
        mounted.release()
        expect(test.result.measurements.cacheSize.value).toBeLessThanOrEqual(3)
      }
      expect(test.result.measurements.getHeight(9_999)).toBeUndefined()
      expect(test.result.measurements.getHeight(0)).toBe(30)
      test.items.value = test.items.value.toReversed()
      await settle()
      expect(test.result.measurements.getHeight(0)).toBe(30)
      expect(test.result.totalSize.value).toBe(200_033)
      test.items.value = []
      await settle()
      expect(test.result.measurements.cacheSize.value).toBe(0)
      expect(test.result.totalSize.value).toBe(0)
    } finally {
      test.stop()
    }
  })

  it('ignores queued reads after content changes, detached replacements and old release callbacks', async () => {
    const test = setup()
    try {
      const previous = test.mount(0, 90)
      test.items.value[0]!.title = 'Replacement'
      const current = test.mount(0, 15)
      previous.release()
      test.observers[0]!.notify([previous.element.asElement()])
      await settle()
      expect(previous.element.getBoundingClientRect).not.toHaveBeenCalled()
      expect(test.result.measurements.getHeight(0)).toBe(15)
      current.element.rect.height = 30
      test.observers[0]!.notify([current.element.asElement()])
      current.release()
      await settle()
      expect(test.result.measurements.getHeight(0)).toBe(15)
    } finally {
      test.stop()
    }
  })

  it('remeasures after hiding, disabling, root replacement and list reconstruction; old jobs cannot commit', async () => {
    const test = setup()
    const target = test.mount(0, 80)
    try {
      await settle()
      test.root.clientHeight = 0
      test.observers[0]!.notify([test.root.asElement()])
      target.element.rect.height = 0
      test.observers[0]!.notify([target.element.asElement()])
      await settle()
      expect(test.result.virtualItems.value).toEqual([])
      expect(test.result.measurements.getHeight(0)).toBe(80)
      test.root.clientHeight = 100
      target.element.rect.height = 25
      test.observers[0]!.notify([test.root.asElement()])
      await settle()
      expect(test.result.measurements.getHeight(0)).toBe(25)
      test.enabled.value = false
      await settle()
      test.enabled.value = true
      await settle()
      target.element.rect.height = 12
      const nextRoot = new VirtualElement(test.document)
      nextRoot.clientHeight = 100
      nextRoot.scrollTop = 0
      test.scrollElement.value = nextRoot.asElement()
      await settle()
      expect(test.result.measurements.getHeight(0)).toBe(12)
      test.listElement.value = null
      await settle()
      target.element.rect.height = 35
      test.listElement.value = test.list.asElement()
      await settle()
      expect(test.result.measurements.getHeight(0)).toBe(35)
    } finally {
      test.stop()
    }
    test.observers[0]!.notify([target.element.asElement(), test.root.asElement()])
    target.element.dispatchEvent(new Event('load'))
    test.result.measurements.observeItem(0, target.element.asElement())
    await settle()
    expect(test.result.measurements.cacheSize.value).toBe(0)
    expect(test.result.virtualItems.value).toEqual([])
  })

  it.each([0, -1, NaN, Infinity])(
    'ignores invalid/hidden measured height %s and disconnected units',
    async (height) => {
      const test = setup()
      try {
        const target = test.mount(0, 40)
        await settle()
        target.element.rect.height = height
        test.observers[0]!.notify([target.element.asElement()])
        await settle()
        expect(test.result.measurements.getHeight(0)).toBe(40)
        target.element.rect.height = 15
        target.element.isConnected = false
        test.result.measurements.refresh()
        await settle()
        expect(test.result.measurements.getHeight(0)).toBe(40)
      } finally {
        test.stop()
      }
    },
  )

  it('updates fallback estimates without overwriting measured heights', async () => {
    const test = setup()
    try {
      test.mount(0, 50)
      await settle()
      test.estimatedItemSize.value = 10
      await settle()
      expect(test.result.totalSize.value).toBe(840)
      expect(test.result.virtualItems.value[1]).toMatchObject({ start: 50, size: 10 })
    } finally {
      test.stop()
    }
  })

  it('rebinds a reused DOM unit to a new occurrence without retaining old observers or accepting old release', async () => {
    const test = setup()
    try {
      const first = test.mount(0, 30)
      await settle()
      first.element.rect.height = 60
      const release = test.result.measurements.observeItem(1, first.element.asElement())
      first.release()
      await settle()
      expect(test.result.measurements.getHeight(0)).toBe(30)
      expect(test.result.measurements.getHeight(1)).toBe(60)
      release()
      first.element.rect.height = 90
      test.observers[0]!.notify([first.element.asElement()])
      await settle()
      expect(test.result.measurements.getHeight(1)).toBe(60)
    } finally {
      test.stop()
    }
  })

  it('supports explicit mounted refresh and delayed loads when ResizeObserver is unavailable', async () => {
    const env = createResizeEnvironment()
    Reflect.deleteProperty(env.view, 'ResizeObserver')
    const root = new VirtualElement(env.document),
      list = new VirtualElement(env.document),
      item = new VirtualElement(env.document)
    const scope = effectScope()
    const addListener = vi.spyOn(env.view, 'addEventListener')
    try {
      const measurements = scope.run(() => {
        const context = useVirtualScrollContext({
          scrollElement: root.asElement(),
          listElement: list.asElement(),
        })
        return useVirtualItemMeasurements({ context, getContentGeneration: () => 0 })
      })!
      item.rect.height = 50
      measurements.observeItem('only', item.asElement())
      await settle()
      expect(measurements.getHeight('only')).toBe(50)
      item.rect.height = 15
      measurements.refresh()
      await settle()
      expect(measurements.getHeight('only')).toBe(15)
      item.rect.height = 35
      item.dispatchEvent(new Event('load'))
      await settle()
      expect(measurements.getHeight('only')).toBe(35)
      expect(env.observers).toHaveLength(0)
      expect(addListener.mock.calls.filter(([type]) => type === 'resize')).toHaveLength(1)
    } finally {
      scope.stop()
    }
  })

  it('keeps header origin, gaps and padding separate from natural unit heights', async () => {
    const env = createResizeEnvironment(),
      scope = effectScope()
    const root = new VirtualElement(env.document),
      list = new VirtualElement(env.document),
      target = new VirtualElement(env.document)
    list.rect.top = 12 + 60 - root.scrollTop
    target.rect.height = 15
    try {
      const result = scope.run(() =>
        useMeasuredVirtualList({
          items: ['first', 'second'],
          getItemKey: (item) => item,
          getContentGeneration: () => 0,
          scrollElement: root.asElement(),
          listElement: list.asElement(),
          estimatedItemSize: 20,
          gap: 8,
          paddingStart: 12,
          paddingEnd: 16,
        }),
      )!
      result.measurements.observeItem('first', target.asElement())
      await settle()
      expect(result.totalSize.value).toBe(71)
      expect(result.context.metrics.value.listOffset).toBe(60)
      expect(result.virtualItems.value).toMatchObject([
        { start: 12, size: 15 },
        { start: 35, size: 20 },
      ])
      expect(root.scrollTop).toBe(80)
    } finally {
      scope.stop()
    }
  })

  it.each([0, -1, 1.5, Infinity, NaN])('rejects invalid cache limit %s', (cacheLimit) => {
    const scope = effectScope()
    try {
      expect(() =>
        scope.run(() =>
          useMeasuredVirtualList({
            items: [0, 1],
            getItemKey: (item) => item,
            getContentGeneration: () => 0,
            estimatedItemSize: 20,
            scrollElement: null,
            listElement: null,
            cacheLimit,
          }),
        ),
      ).toThrow('Invalid height cache limit')
    } finally {
      scope.stop()
    }
  })

  it.each([
    { estimatedItemSize: 0 },
    { estimatedItemSize: NaN },
    { estimatedItemSize: Infinity },
    { estimatedItemSize: Number.MAX_VALUE },
    { gap: -1 },
    { paddingStart: -1 },
    { paddingEnd: Infinity },
    { overscan: -1 },
    { overscan: 1.5 },
  ])('rejects invalid geometry %j', (invalid) => {
    const scope = effectScope()
    try {
      expect(() =>
        scope.run(
          () =>
            useMeasuredVirtualList({
              items: [0, 1],
              getItemKey: (item) => item,
              getContentGeneration: () => 0,
              estimatedItemSize: 20,
              scrollElement: null,
              listElement: null,
              ...invalid,
            }).virtualItems.value,
        ),
      ).toThrow(RangeError)
    } finally {
      scope.stop()
    }
  })
})
