import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick, shallowRef } from 'vue'
import type { EffectScope } from 'vue'

import type { GridReorderGeometryFactory } from '../../src/composables/grid-reorder-geometry'
import { useGridReorder } from '../../src/composables/use-grid-reorder'

/** Counts real EventTarget registrations; simulated boxes do not establish browser acceptance. */
class TrackedTarget extends EventTarget {
  readonly listeners = new Map<string, Set<EventListenerOrEventListenerObject>>()

  override addEventListener(
    type: string,
    callback: EventListenerOrEventListenerObject | null,
    options?: AddEventListenerOptions | boolean,
  ): void {
    super.addEventListener(type, callback, options)
    if (!callback) return
    const key = `${type}:${typeof options === 'boolean' ? options : Boolean(options?.capture)}`
    const listeners = this.listeners.get(key) ?? new Set()
    listeners.add(callback)
    this.listeners.set(key, listeners)
  }

  override removeEventListener(
    type: string,
    callback: EventListenerOrEventListenerObject | null,
    options?: EventListenerOptions | boolean,
  ): void {
    super.removeEventListener(type, callback, options)
    if (!callback) return
    const key = `${type}:${typeof options === 'boolean' ? options : Boolean(options?.capture)}`
    this.listeners.get(key)?.delete(callback)
  }

  get listenerCount(): number {
    return [...this.listeners.values()].reduce((count, listeners) => count + listeners.size, 0)
  }
}

function rect(top = 0, height = 600, width = 300): DOMRect {
  return { left: 0, top, width, height, right: width, bottom: top + height } as DOMRect
}

function pointer(y = 120, pointerId = 1): PointerEvent {
  return {
    pointerId,
    button: 0,
    clientX: 30,
    clientY: y,
    preventDefault: vi.fn(),
  } as unknown as PointerEvent
}

let frames: Map<number, FrameRequestCallback>
let observers: { callback: ResizeObserverCallback; targets: Set<Element> }[]
let testWindow: TrackedTarget
let testDocument: TrackedTarget & { visibilityState: string }
const scopes: EffectScope[] = []

beforeEach(() => {
  vi.useFakeTimers()
  frames = new Map()
  observers = []
  let frameId = 0
  testWindow = Object.assign(new TrackedTarget(), { innerHeight: 600 })
  testDocument = Object.assign(new TrackedTarget(), { visibilityState: 'visible' })
  vi.stubGlobal('window', testWindow)
  vi.stubGlobal('document', testDocument)
  vi.stubGlobal('getComputedStyle', () => ({ overflowY: 'hidden', getPropertyValue: () => '' }))
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
        this.record = { callback, targets: new Set() }
        observers.push(this.record)
      }
      observe(target: Element) {
        this.record.targets.add(target)
      }
      disconnect() {
        this.record.targets.clear()
      }
    },
  )
})

afterEach(() => {
  for (const scope of scopes.splice(0)) scope.stop()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

function runFrame(): void {
  const pending = [...frames.values()]
  frames.clear()
  for (const callback of pending) callback(16)
}

async function flushLanding(): Promise<void> {
  await nextTick()
  await nextTick()
  runFrame()
  await nextTick()
}

function setup(measured = false) {
  const ids = shallowRef<readonly string[]>(['a', 'b', 'c'])
  const revision = shallowRef(0)
  const valid = shallowRef(true)
  const leases: { id: string; release: ReturnType<typeof vi.fn> }[] = []
  const active = new Map<string, number>()
  const rows = new Map(
    ids.value.map((id) => {
      const attributes = new Set<string>()
      const row = {
        isConnected: true,
        dataset: { testDropId: id },
        attributes,
        getAttribute: (name: string) => (attributes.has(name) ? '' : null),
        setAttribute: (name: string) => attributes.add(name),
        removeAttribute: (name: string) => attributes.delete(name),
        getBoundingClientRect: () => rect(100 + ids.value.indexOf(id) * 100, 80),
        querySelector: () => ({
          getBoundingClientRect: () => rect(100 + ids.value.indexOf(id) * 100, 80),
        }),
      }
      return [id, row] as const
    }),
  )
  let width = 300
  let height = 600
  const attributes = new Set<string>()
  const root = Object.assign(new TrackedTarget(), {
    isConnected: true,
    scrollTop: 0,
    scrollHeight: 600,
    clientHeight: 600,
    attributes,
    setAttribute: (name: string) => attributes.add(name),
    removeAttribute: (name: string) => attributes.delete(name),
    getBoundingClientRect: () => rect(0, height, width),
    querySelectorAll: () => [...rows.values()],
    setPointerCapture: vi.fn(),
    hasPointerCapture: () => true,
    releasePointerCapture: vi.fn(),
  })
  const scroller = Object.assign(new TrackedTarget(), {
    isConnected: true,
    scrollTop: 0,
    scrollHeight: 1000,
    clientHeight: 600,
    getBoundingClientRect: () => rect(),
  })
  const rootRef = shallowRef<HTMLElement | null>(root as unknown as HTMLElement)
  const scrollerRef = shallowRef<HTMLElement | null>(scroller as unknown as HTMLElement)
  let offsets = new Map([['b', { x: 0, y: -100 }]])
  const createGeometry: GridReorderGeometryFactory<'track'> = (input) => ({
    sourceSlot: {
      id: input.sourceId,
      left: 0,
      top: 100 + ids.value.indexOf(input.sourceId) * 100,
      width: 300,
      height: 80,
    },
    sourceElement: rows.get(input.sourceId)! as unknown as HTMLElement,
    getMountedElement: (id) => rows.get(id) as unknown as HTMLElement | undefined,
    findSlot: () => ({ id: 'b', left: 0, top: 200, width: 300, height: 80 }),
    getOffsets: () => offsets,
    getRevision: () => revision.value,
    allowsHeightChanges: measured,
    getLayoutRevision: () => revision.value,
    isValid: () => valid.value,
  })
  const move = vi.fn(() => {
    ids.value = ['b', 'a', 'c']
  })
  const scope = effectScope()
  scopes.push(scope)
  const reorder = scope.run(() =>
    useGridReorder({
      idsByKind: () => ({ track: ids.value }),
      scrollElement: rootRef,
      autoScrollElement: scrollerRef,
      attributePrefix: 'test',
      createGeometry,
      retainItem: (_kind, id) => {
        active.set(id, (active.get(id) ?? 0) + 1)
        const release = vi.fn(() => {
          const count = active.get(id)! - 1
          if (count) active.set(id, count)
          else active.delete(id)
        })
        leases.push({ id, release })
        return release
      },
      move,
    }),
  )!
  return {
    reorder,
    scope,
    ids,
    revision,
    valid,
    rows,
    root,
    rootRef,
    scroller,
    scrollerRef,
    move,
    leases,
    active,
    grow: (next: number) => {
      height = next
    },
    setOffsets: (next: typeof offsets) => {
      offsets = next
      revision.value++
    },
    resize: () => {
      width += 20
      for (const observer of observers)
        if (observer.targets.size) observer.callback([], {} as ResizeObserver)
    },
    start: () => {
      reorder.startDrag(pointer(), 'track', 'a')
      reorder.continueDrag(pointer(240))
      runFrame()
      expect(reorder.dropTargetId.value).toBe('b')
      expect(active.size).toBe(2)
    },
  }
}

type Fixture = ReturnType<typeof setup>

function expectClean(test: Fixture): void {
  expect(test.reorder.draggedId.value).toBeUndefined()
  expect(test.reorder.dropTargetId.value).toBeUndefined()
  expect(test.reorder.isSettling.value).toBe(false)
  expect(test.reorder.getItemStyle('track', 'a')).toBeUndefined()
  expect(test.reorder.getItemStyle('track', 'b')).toBeUndefined()
  expect(test.active.size).toBe(0)
  for (const lease of test.leases) expect(lease.release).toHaveBeenCalledOnce()
  for (const row of test.rows.values()) expect(row.attributes.size).toBe(0)
  expect(test.root.attributes.size).toBe(0)
  for (const target of [test.root, test.scroller, testWindow, testDocument])
    expect(target.listenerCount).toBe(0)
  expect(observers.every((observer) => observer.targets.size === 0)).toBe(true)
  expect(frames.size).toBe(0)
  expect(vi.getTimerCount()).toBe(0)
}

const activeInterruptions = [
  'window-resize',
  'container-resize',
  'filter',
  'order',
  'remove-source',
  'explicit-cancel',
  'pointercancel',
  'lost-capture',
  'blur',
  'hidden',
  'escape',
  'detached-root',
  'replaced-root',
  'detached-source',
  'replaced-scroller',
  'dispose',
] as const

function interrupt(test: Fixture, reason: (typeof activeInterruptions)[number]): void {
  if (reason === 'window-resize') testWindow.dispatchEvent(new Event('resize'))
  else if (reason === 'container-resize') test.resize()
  else if (reason === 'filter') test.ids.value = ['a', 'b']
  else if (reason === 'order') test.ids.value = ['a', 'c', 'b']
  else if (reason === 'remove-source') test.ids.value = ['b', 'c']
  else if (reason === 'explicit-cancel') test.reorder.clearDrag()
  else if (reason === 'dispose') test.scope.stop()
  else if (reason === 'detached-root') test.root.isConnected = false
  else if (reason === 'replaced-root') test.rootRef.value = null
  else if (reason === 'detached-source') test.rows.get('a')!.isConnected = false
  else if (reason === 'replaced-scroller') test.scrollerRef.value = null
  else if (reason === 'pointercancel' || reason === 'lost-capture')
    test.root.dispatchEvent(
      Object.assign(
        new Event(reason === 'pointercancel' ? 'pointercancel' : 'lostpointercapture'),
        { pointerId: 1 },
      ),
    )
  else if (reason === 'blur') testWindow.dispatchEvent(new Event('blur'))
  else if (reason === 'hidden') {
    testDocument.visibilityState = 'hidden'
    testDocument.dispatchEvent(new Event('visibilitychange'))
  } else testWindow.dispatchEvent(Object.assign(new Event('keydown'), { key: 'Escape' }))
}

describe('useGridReorder interruption boundaries (Node lifecycle fixtures)', () => {
  it('rebases a final measured commit before motion and ignores its delayed resize notification', async () => {
    const test = setup(true)
    test.start()
    test.reorder.finishDrag(pointer(240))
    await nextTick()
    await nextTick()
    // The DOM/window extent changes before RO delivers the committed measurement.
    test.grow(660)
    runFrame()
    expect(test.reorder.isSettling.value).toBe(true)
    await nextTick()
    await nextTick()
    runFrame()
    await nextTick()
    expect(test.reorder.isSettling.value).toBe(false)
    const source = test.rows.get('a')!
    expect(source.attributes.has('data-am-grid-landing')).toBe(true)
    for (const observer of observers)
      if (observer.targets.size) observer.callback([], {} as ResizeObserver)
    expect(source.attributes.has('data-am-grid-landing')).toBe(true)
    expect(test.reorder.getItemStyle('track', 'a')).toEqual({ contentVisibility: 'visible' })
    // An independent reflow after motion starts still invalidates landing.
    test.grow(700)
    for (const observer of observers)
      if (observer.targets.size) observer.callback([], {} as ResizeObserver)
    expectClean(test)
  })

  it('holds returning neighbors through their CSS tail and rejects an obsolete tail release', () => {
    const test = setup()
    test.start()
    const row = test.rows.get('b')!
    expect(row.attributes.has('data-am-grid-moving')).toBe(true)
    test.setOffsets(new Map())
    test.reorder.continueDrag(pointer(245))
    runFrame()
    expect(row.attributes.has('data-am-grid-moving')).toBe(true)
    vi.advanceTimersByTime(300)
    test.setOffsets(new Map([['b', { x: 0, y: -100 }]]))
    test.reorder.continueDrag(pointer(250))
    runFrame()
    vi.advanceTimersByTime(100)
    expect(row.attributes.has('data-am-grid-moving')).toBe(true)
    test.setOffsets(new Map())
    test.reorder.continueDrag(pointer(255))
    runFrame()
    vi.advanceTimersByTime(340)
    expect(row.attributes.has('data-am-grid-moving')).toBe(false)
    test.reorder.clearDrag()
    expectClean(test)
  })

  it('transfers source and neighbor visibility before dropping their drag holds', async () => {
    const test = setup()
    test.start()
    const source = test.rows.get('a')!
    const neighbor = test.rows.get('b')!
    const removeSource = source.removeAttribute
    const removeNeighbor = neighbor.removeAttribute
    source.removeAttribute = (name) => {
      if (name === 'data-am-grid-source')
        expect(source.attributes.has('data-am-grid-landing')).toBe(true)
      return removeSource(name)
    }
    neighbor.removeAttribute = (name) => {
      if (name === 'data-am-grid-moving')
        expect(neighbor.attributes.has('data-am-grid-settling')).toBe(true)
      return removeNeighbor(name)
    }
    test.reorder.finishDrag(pointer(240))
    await flushLanding()
    expect(source.attributes.has('data-am-grid-landing')).toBe(true)
    expect(neighbor.attributes.has('data-am-grid-settling')).toBe(true)
    vi.runAllTimers()
    expectClean(test)
  })

  it.each(activeInterruptions)(
    'clears active %s without committing a stale release',
    async (reason) => {
      const test = setup()
      test.start()
      test.reorder.continueDrag(pointer(250))
      expect(frames.size).toBe(1)
      interrupt(test, reason)
      test.reorder.finishDrag(pointer(250))
      await flushLanding()
      expect(test.move).not.toHaveBeenCalled()
      expect(test.root.releasePointerCapture).toHaveBeenCalledOnce()
      expectClean(test)
    },
  )

  it('retains the gesture and landing across equal identity snapshots', async () => {
    const test = setup()
    test.start()
    test.ids.value = [...test.ids.value]
    test.revision.value++
    await nextTick()
    runFrame()
    expect(test.reorder.draggedId.value).toBe('a')
    test.reorder.finishDrag(pointer(240))
    test.ids.value = [...test.ids.value]
    await flushLanding()
    expect(test.move).toHaveBeenCalledOnce()
    expect(test.active.size).toBe(2)
    expect(test.rows.get('a')!.attributes.has('data-am-grid-landing')).toBe(true)
    vi.advanceTimersByTime(340)
    expectClean(test)
  })

  it.each(
    (['pending', 'animating'] as const).flatMap((phase) =>
      (
        [
          'window-resize',
          'container-resize',
          'filter',
          'order',
          'remove-source',
          'explicit-cancel',
          'replaced-root',
          'replaced-scroller',
          'dispose',
        ] as const
      ).map((reason) => ({ phase, reason })),
    ),
  )('clears $phase landing on $reason', async ({ phase, reason }) => {
    const test = setup()
    test.start()
    test.reorder.finishDrag(pointer(240))
    if (phase === 'animating') await flushLanding()
    expect(test.active.size, `${phase}:${reason}`).toBe(2)
    interrupt(test, reason)
    await flushLanding()
    expect(test.move, `${phase}:${reason}`).toHaveBeenCalledOnce()
    expectClean(test)
  })

  it.each(
    (['pending', 'after-first-tick', 'before-frame'] as const).flatMap((phase) =>
      (['detached-root', 'detached-source'] as const).map((reason) => ({ phase, reason })),
    ),
  )('clears $phase landing before measuring a $reason', async ({ phase, reason }) => {
    const test = setup()
    test.start()
    test.reorder.finishDrag(pointer(240))
    if (phase !== 'pending') await nextTick()
    if (phase === 'before-frame') {
      await nextTick()
      expect(frames.size).toBe(1)
    }
    interrupt(test, reason)
    await flushLanding()
    expect(test.move).toHaveBeenCalledOnce()
    expectClean(test)
  })

  it.each(['pending', 'rebased', 'animating'] as const)(
    'keeps a new drag safe from the old %s landing callbacks',
    async (phase) => {
      const test = setup()
      test.start()
      test.reorder.finishDrag(pointer(240))
      if (phase !== 'pending') {
        await nextTick()
        await nextTick()
      }
      if (phase === 'animating') runFrame()
      test.reorder.startDrag(pointer(220, 2), 'track', 'a')
      expect(test.active).toEqual(new Map([['a', 1]]))
      const newLease = test.leases.at(-1)!
      expect(newLease.id).toBe('a')
      await flushLanding()
      vi.advanceTimersByTime(1000)
      expect(test.reorder.draggedId.value).toBe('a')
      expect(test.rows.get('a')!.attributes).toEqual(new Set(['data-am-grid-source']))
      expect(test.reorder.getItemStyle('track', 'a')).toBeUndefined()
      expect(test.active).toEqual(new Map([['a', 1]]))
      expect(newLease.release).not.toHaveBeenCalled()
      expect(test.move).toHaveBeenCalledOnce()
      test.reorder.clearDrag()
      expectClean(test)
    },
  )

  it('honors reentrant cancellation by the controlled move owner', async () => {
    const test = setup()
    test.move.mockImplementation(() => test.reorder.clearDrag())
    test.start()
    test.reorder.finishDrag(pointer(240))
    await flushLanding()
    expect(test.move).toHaveBeenCalledOnce()
    expectClean(test)
  })

  it('does not overwrite a new drag started inside the controlled move callback', async () => {
    const test = setup()
    test.move.mockImplementation(() => {
      test.ids.value = ['b', 'a', 'c']
      test.reorder.startDrag(pointer(220, 2), 'track', 'a')
    })
    test.start()
    test.reorder.finishDrag(pointer(240))
    const newLease = test.leases.at(-1)!
    await flushLanding()
    vi.advanceTimersByTime(1000)
    expect(test.reorder.draggedId.value).toBe('a')
    expect(test.rows.get('a')!.attributes).toEqual(new Set(['data-am-grid-source']))
    expect(test.reorder.getItemStyle('track', 'a')).toBeUndefined()
    expect(test.active).toEqual(new Map([['a', 1]]))
    expect(newLease.release).not.toHaveBeenCalled()
    test.reorder.clearDrag()
    expectClean(test)
  })

  it('does not revive landing work after disposal inside the move callback', async () => {
    const test = setup()
    test.move.mockImplementation(() => test.scope.stop())
    test.start()
    test.reorder.finishDrag(pointer(240))
    await flushLanding()
    expect(test.move).toHaveBeenCalledOnce()
    expectClean(test)
  })

  it('clears transferred landing resources when the controlled move throws', () => {
    const test = setup()
    const failure = new Error('controlled move rejected')
    test.move.mockImplementation(() => {
      throw failure
    })
    test.start()
    expect(() => test.reorder.finishDrag(pointer(240))).toThrow(failure)
    expectClean(test)
  })
})
