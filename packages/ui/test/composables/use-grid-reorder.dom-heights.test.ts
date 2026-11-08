import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick, shallowRef } from 'vue'
import type { EffectScope } from 'vue'

import { useGridReorder } from '../../src/composables/use-grid-reorder'

function rect(top: number, height: number): DOMRect {
  return { left: 0, top, width: 300, height, bottom: top + height, right: 300 } as DOMRect
}
function pointer(y: number): PointerEvent {
  return { pointerId: 1, button: 0, clientX: 30, clientY: y, preventDefault() {} } as PointerEvent
}
let frames: Map<number, FrameRequestCallback>
let observers: { callback: ResizeObserverCallback; active: boolean }[]
const scopes: EffectScope[] = []
beforeEach(() => {
  vi.useFakeTimers()
  frames = new Map()
  observers = []
  let frameId = 0
  vi.stubGlobal('window', Object.assign(new EventTarget(), { innerHeight: 600 }))
  vi.stubGlobal('getComputedStyle', () => ({ getPropertyValue: () => '' }))
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++frameId, callback)
    return frameId
  })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id))
  vi.stubGlobal(
    'ResizeObserver',
    class {
      record: (typeof observers)[number]
      constructor(callback: ResizeObserverCallback) {
        this.record = { callback, active: true }
        observers.push(this.record)
      }
      observe() {}
      disconnect() {
        this.record.active = false
      }
    },
  )
})
afterEach(() => {
  for (const scope of scopes.splice(0)) scope.stop()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})
function runFrame() {
  const pending = [...frames.values()]
  frames.clear()
  for (const callback of pending) callback(16)
}
function setup() {
  const ids = shallowRef<readonly string[]>(['a', 'b', 'c', 'd'])
  let growth = 0
  let nativeAnchor = ''
  const anchorWrites: string[] = []
  const scroller = Object.assign(new EventTarget(), {
    isConnected: true,
    scrollTop: 0,
    scrollHeight: 1000,
    clientHeight: 600,
    getBoundingClientRect: () => rect(0, 600),
    style: {
      getPropertyValue: () => nativeAnchor,
      getPropertyPriority: () => '',
      setProperty: (_name: string, value: string) => {
        nativeAnchor = value
        anchorWrites.push(value)
      },
      removeProperty: () => {
        nativeAnchor = ''
        anchorWrites.push('')
      },
    },
  })
  const rows = new Map(
    ids.value.map((id) => {
      const attrs = new Set<string>()
      return [
        id,
        {
          isConnected: true,
          dataset: { testDropId: id },
          getAttribute: (name: string) => (attrs.has(name) ? '' : null),
          setAttribute: (name: string) => attrs.add(name),
          removeAttribute: (name: string) => attrs.delete(name),
          getBoundingClientRect: vi.fn(() => {
            const index = ids.value.indexOf(id)
            return rect(
              100 + index * 100 + (index ? growth : 0) - scroller.scrollTop,
              index ? 80 : 80 + growth,
            )
          }),
        },
      ] as const
    }),
  )
  const root = Object.assign(new EventTarget(), {
    isConnected: true,
    scrollTop: 0,
    scrollHeight: 600,
    clientHeight: 600,
    getBoundingClientRect: () => rect(-scroller.scrollTop, 600 + growth),
    querySelectorAll: vi.fn(() => [...rows.values()]),
    setAttribute() {},
    removeAttribute() {},
    setPointerCapture() {},
    hasPointerCapture: () => true,
    releasePointerCapture() {},
  })
  const move = vi.fn((_kind, source: string, target: string) => {
    const order = [...ids.value]
    order.splice(order.indexOf(target), 0, ...order.splice(order.indexOf(source), 1))
    ids.value = order
  })
  const scope = effectScope()
  scopes.push(scope)
  const reorder = scope.run(() =>
    useGridReorder({
      idsByKind: () => ({ track: ids.value }),
      attributePrefix: 'test',
      scrollElement: root as unknown as HTMLElement,
      autoScrollElement: scroller as unknown as HTMLElement,
      move,
    }),
  )!
  return {
    reorder,
    scope,
    rows,
    root,
    scroller,
    move,
    anchorWrites,
    anchor: () => nativeAnchor,
    grow: (amount: number) => {
      growth = amount
      root.scrollHeight = 600 + amount
    },
    observe: () => {
      for (const observer of observers)
        if (observer.active) observer.callback([], {} as ResizeObserver)
    },
  }
}

describe('DOM reorder height refresh and scroll handoff', () => {
  it.each(['observer-first', 'release-first'] as const)(
    'keeps the grabbed point and refreshes final hit testing (%s)',
    async (delivery) => {
      const test = setup()
      test.reorder.startDrag(pointer(220), 'track', 'b')
      expect(test.anchor()).toBe('none')
      test.reorder.continueDrag(pointer(320))
      runFrame()
      expect(test.reorder.dropTargetId.value).toBe('c')
      test.scroller.scrollTop = 100
      test.grow(40)
      if (delivery === 'observer-first') {
        test.observe()
        test.observe()
        expect(frames.size).toBe(1)
        runFrame()
        expect(test.reorder.getItemStyle('track', 'b')).toEqual({
          transform: 'translate3d(0px, 160px, 0)',
        })
        expect(test.reorder.dropTargetId.value).toBe('d')
        // Repeated pointer/scroll frames reuse measured slots when the height is stable.
        test.reorder.continueDrag(pointer(325))
        runFrame()
        expect(test.rows.get('a')!.getBoundingClientRect).toHaveBeenCalledTimes(2)
      }
      test.reorder.finishDrag(pointer(320))
      expect(test.move).toHaveBeenCalledWith('track', 'b', 'd', ['a', 'b', 'c', 'd'])
      expect(test.scroller.scrollTop).toBe(100)
      expect(test.anchor()).toBe('none')
      await nextTick()
      await nextTick()
      runFrame()
      vi.runAllTimers()
      expect(test.anchor()).toBe('')
    },
  )

  it('keeps anchor suppression continuous when a new drag interrupts landing', async () => {
    const test = setup()
    test.reorder.startDrag(pointer(220), 'track', 'b')
    test.reorder.finishDrag(pointer(320))
    test.reorder.startDrag(pointer(320), 'track', 'b')
    expect(test.anchorWrites).toEqual(['none'])
    await nextTick()
    await nextTick()
    runFrame()
    vi.runAllTimers()
    expect(test.anchor()).toBe('none')
    test.reorder.clearDrag()
    expect(test.anchorWrites).toEqual(['none', ''])
  })

  it('rebases pending landing in scrolling content when wheel input continues after release', async () => {
    const test = setup()
    test.reorder.startDrag(pointer(220), 'track', 'b')
    test.reorder.finishDrag(pointer(320))
    test.scroller.scrollTop = 50
    await nextTick()
    expect(test.reorder.getItemStyle('track', 'b')?.transform).toBe('translate3d(0px, 0px, 0)')
    test.grow(40)
    test.observe()
    expect(test.reorder.getItemStyle('track', 'b')?.transform).toBe('translate3d(0px, -40px, 0)')
    expect(test.anchor()).toBe('none')
  })

  it('preserves a stationary grabbed point through a preceding row height change', () => {
    const test = setup()
    test.reorder.startDrag(pointer(220), 'track', 'b')
    test.grow(40)
    test.observe()
    runFrame()
    expect(test.reorder.getItemStyle('track', 'b')?.transform).toBe('translate3d(0px, -40px, 0)')
  })

  it('ignores a disconnected observer delivered after a new gesture starts', () => {
    const test = setup()
    test.reorder.startDrag(pointer(220), 'track', 'b')
    const stale = observers[0]!
    test.reorder.clearDrag()
    test.reorder.startDrag(pointer(220), 'track', 'b')
    const accepted = test.root.getBoundingClientRect
    test.root.getBoundingClientRect = () => ({ ...rect(0, 600), width: 400 })
    stale.callback([], {} as ResizeObserver)
    expect(test.reorder.draggedId.value).toBe('b')
    expect(test.anchor()).toBe('none')
    test.root.getBoundingClientRect = accepted
  })

  it('restores anchor suppression when no eligible geometry exists', () => {
    const test = setup()
    test.root.querySelectorAll.mockReturnValue([])
    test.reorder.startDrag(pointer(220), 'track', 'b')
    expect(test.anchor()).toBe('')
    expect(test.reorder.draggedId.value).toBeUndefined()
  })
})
