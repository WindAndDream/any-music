import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick, shallowRef } from 'vue'
import type { EffectScope } from 'vue'

import type { GridReorderGeometryFactory } from '../../src/composables/grid-reorder-geometry'
import { useGridReorder } from '../../src/composables/use-grid-reorder'

function rect(top: number, height = 400): DOMRect {
  return { left: 0, top, width: 300, height, right: 300, bottom: top + height } as DOMRect
}

function pointer(y: number): PointerEvent {
  return {
    pointerId: 1,
    button: 0,
    clientX: 20,
    clientY: y,
    preventDefault: vi.fn(),
  } as unknown as PointerEvent
}

const scopes: EffectScope[] = []
let frames: Map<number, FrameRequestCallback>

beforeEach(() => {
  vi.useFakeTimers()
  frames = new Map()
  let frameId = 0
  vi.stubGlobal('window', Object.assign(new EventTarget(), { innerHeight: 600 }))
  vi.stubGlobal('ResizeObserver', undefined)
  vi.stubGlobal(
    'ShadowRoot',
    class {
      host = null
    },
  )
  vi.stubGlobal('getComputedStyle', () => ({ overflowY: 'hidden', getPropertyValue: () => '' }))
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++frameId, callback)
    return frameId
  })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id))
})

afterEach(() => {
  for (const scope of scopes.splice(0)) scope.stop()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

function runFrame() {
  const callbacks = [...frames.values()]
  frames.clear()
  for (const callback of callbacks) callback(16)
}

/** Controller-only fixture: mounted identities and immutable slots have separate lifetimes. */
function setup(
  options: {
    initialScrollTop?: number
    sourceTop?: number
    rejectedId?: string
    retentionLimit?: number
    legacyGeometry?: boolean
  } = {},
) {
  const ids = shallowRef<readonly string[]>(['a', 'b', 'c', 'd', 'e'])
  const mountedIds = shallowRef<readonly string[]>(['a', 'b'])
  const revision = shallowRef(0)
  const valid = shallowRef(true)
  const active = new Set<string>()
  const retentionEvents: string[] = []
  const holdCounts: number[] = []
  const scroller = Object.assign(new EventTarget(), {
    isConnected: true,
    scrollTop: options.initialScrollTop ?? 0,
    scrollHeight: 2000,
    clientHeight: 400,
    getBoundingClientRect: vi.fn(() => rect(0)),
  })
  // The explicit scroll root is deliberately absent from parentElement discovery.
  const shadowRoot = Object.assign(new ShadowRoot(), { host: scroller })
  const sourceTop = options.sourceTop ?? 100
  let sourcePosition = sourceTop
  const rows = new Map(
    ids.value.map((id, index) => [
      id,
      {
        isConnected: true,
        dataset: { testDropId: id },
        setAttribute: vi.fn(),
        removeAttribute: vi.fn(),
        getBoundingClientRect: vi.fn(() =>
          rect(20 - scroller.scrollTop + (id === 'a' ? sourcePosition : 200 + index * 40), 40),
        ),
      },
    ]),
  )
  const container = Object.assign(new EventTarget(), {
    isConnected: true,
    scrollTop: 0,
    scrollHeight: 2000,
    clientHeight: 2000,
    parentElement: null,
    getRootNode: () => shadowRoot,
    getBoundingClientRect: vi.fn(() => rect(20 - scroller.scrollTop, 2000)),
    querySelectorAll: vi.fn(() =>
      [...new Set([...mountedIds.value, ...active])].map((id) => rows.get(id)!),
    ),
    setAttribute: vi.fn(),
    removeAttribute: vi.fn(),
    setPointerCapture: vi.fn(),
    hasPointerCapture: () => true,
    releasePointerCapture: vi.fn(),
  })
  let targetId = 'b'
  const findSlot = vi.fn(() => ({ id: targetId, left: 0, top: 200, width: 40, height: 40 }))
  const getOffsets = vi.fn(
    () =>
      new Map(
        mountedIds.value
          .filter((id) => id !== 'a')
          .map((id) => [id, { x: 0, y: -10 * ids.value.indexOf(id) }]),
      ),
  )
  const createGeometry = vi.fn<GridReorderGeometryFactory<'track'>>(() => ({
    sourceSlot: { id: 'a', left: 0, top: sourceTop, width: 40, height: 40 },
    sourceElement: rows.get('a')! as unknown as HTMLElement,
    domain: { left: 0, top: -10000, width: 300, height: 20000 },
    findSlot,
    getOffsets,
    getRevision: options.legacyGeometry ? undefined : () => revision.value,
    isValid: () => valid.value,
  }))
  const retainItem = vi.fn((_kind: 'track', id: string) => {
    if (id === options.rejectedId || active.size >= (options.retentionLimit ?? 32)) return undefined
    retentionEvents.push(`retain:${id}`)
    active.add(id)
    holdCounts.push(active.size)
    return vi.fn(() => {
      retentionEvents.push(`release:${id}`)
      active.delete(id)
      holdCounts.push(active.size)
    })
  })
  const move = vi.fn()
  const scope = effectScope()
  scopes.push(scope)
  const reorder = scope.run(() =>
    useGridReorder({
      idsByKind: () => ({ track: ids.value }),
      scrollElement: container as unknown as HTMLElement,
      autoScrollElement: scroller as unknown as HTMLElement,
      attributePrefix: 'test',
      createGeometry,
      retainItem,
      move,
    }),
  )!
  return {
    reorder,
    scope,
    ids,
    mountedIds,
    revision,
    valid,
    active,
    retentionEvents,
    holdCounts,
    retainItem,
    move,
    rows,
    container,
    scroller,
    createGeometry,
    getOffsets,
    findSlot,
    startY: 20 - scroller.scrollTop + sourceTop + 20,
    setTarget: (id: string) => {
      targetId = id
    },
    setSourcePosition: (value: number) => {
      sourcePosition = value
    },
  }
}

describe('useGridReorder virtual-window lifetimes (Node geometry and pointer fixture)', () => {
  it.each([
    ['forward', 0, 100, 390, 14],
    ['backward', 300, 400, 10, 286],
  ] as const)(
    'does not take another %s edge-scroll step on pointer release',
    (_label, initialScrollTop, sourceTop, edgeY, expected) => {
      const test = setup({ initialScrollTop, sourceTop })
      test.reorder.startDrag(pointer(test.startY), 'track', 'a')
      test.reorder.continueDrag(pointer(edgeY))
      runFrame()
      expect(test.scroller.scrollTop).toBe(expected)
      expect(frames.size).toBe(1)
      test.reorder.finishDrag(pointer(edgeY))
      expect(test.scroller.scrollTop).toBe(expected)
      expect(test.move).toHaveBeenCalledOnce()
      expect(frames.size).toBe(0)
    },
  )

  it.each([
    ['forward', 0, 100, 390, 14],
    ['backward', 300, 400, 10, 286],
  ] as const)(
    'refreshes new mounted neighbors during stationary %s edge scrolling without a new target',
    async (_label, initialScrollTop, sourceTop, edgeY, nextScrollTop) => {
      const test = setup({ initialScrollTop, sourceTop })
      test.reorder.startDrag(pointer(test.startY), 'track', 'a')
      expect(test.rows.get('a')!.setAttribute).toHaveBeenCalledWith('data-am-grid-source', '')
      test.reorder.continueDrag(pointer(edgeY))
      runFrame()
      expect(test.scroller.scrollTop).toBe(nextScrollTop)
      expect(test.reorder.dropTargetId.value).toBe('b')
      const previous = test.reorder.getItemStyle('track', 'b')
      expect(previous).toEqual({ transform: 'translate3d(0px, -10px, 0)' })
      test.mountedIds.value = ['b', 'c']
      test.revision.value++
      await nextTick()
      runFrame()
      expect(test.reorder.dropTargetId.value).toBe('b')
      expect(test.reorder.getItemStyle('track', 'b')).toBe(previous)
      expect(test.reorder.getItemStyle('track', 'c')).toEqual({
        transform: 'translate3d(0px, -20px, 0)',
      })
      test.mountedIds.value = ['c', 'd']
      test.revision.value++
      await nextTick()
      runFrame()
      expect(test.reorder.getItemStyle('track', 'b')).toBeUndefined()
      expect(test.reorder.getItemStyle('track', 'd')).toEqual({
        transform: 'translate3d(0px, -30px, 0)',
      })
      expect(test.createGeometry).toHaveBeenCalledOnce()
      expect(test.container.querySelectorAll).not.toHaveBeenCalled()
      expect(test.container.setPointerCapture).toHaveBeenCalledOnce()
      expect(test.active).toEqual(new Set(['a', 'b']))
      test.reorder.clearDrag()
      expect(frames.size).toBe(0)
      expect(test.active.size).toBe(0)
      expect(test.rows.get('a')!.removeAttribute).toHaveBeenCalledWith('data-am-grid-source')
    },
  )

  it('refreshes mounted offsets from a revision when no pointer or scroll frame is pending', async () => {
    const test = setup()
    test.reorder.startDrag(pointer(test.startY), 'track', 'a')
    test.reorder.continueDrag(pointer(250))
    runFrame()
    expect(frames.size).toBe(0)
    const previous = test.reorder.getItemStyle('track', 'b')
    test.mountedIds.value = ['b', 'c']
    test.revision.value++
    test.revision.value++
    await nextTick()
    expect(frames.size).toBe(1)
    runFrame()
    expect(test.reorder.getItemStyle('track', 'b')).toBe(previous)
    expect(test.reorder.getItemStyle('track', 'c')).toEqual({
      transform: 'translate3d(0px, -20px, 0)',
    })
    expect(frames.size).toBe(0)
  })

  it('keeps the legacy geometry path from recomputing unchanged target offsets every frame', () => {
    const test = setup({ legacyGeometry: true })
    test.reorder.startDrag(pointer(test.startY), 'track', 'a')
    test.reorder.continueDrag(pointer(250))
    runFrame()
    const previous = test.reorder.getItemStyle('track', 'b')
    expect(test.getOffsets).toHaveBeenCalledOnce()
    test.reorder.continueDrag(pointer(260))
    runFrame()
    test.reorder.continueDrag(pointer(270))
    runFrame()
    expect(test.getOffsets).toHaveBeenCalledOnce()
    expect(test.reorder.getItemStyle('track', 'b')).toBe(previous)
    expect(test.createGeometry).toHaveBeenCalledOnce()
  })

  it('uses an explicit initially nonoverflowing Shadow-adjacent root once its range grows', async () => {
    const test = setup()
    test.scroller.scrollHeight = 400
    test.reorder.startDrag(pointer(test.startY), 'track', 'a')
    test.reorder.continueDrag(pointer(390))
    runFrame()
    expect(test.scroller.scrollTop).toBe(0)
    expect(frames.size).toBe(0)
    test.scroller.scrollHeight = 1000
    test.mountedIds.value = ['a', 'b', 'c']
    test.revision.value++
    await nextTick()
    runFrame()
    expect(test.scroller.scrollTop).toBe(14)
    expect(test.findSlot).toHaveBeenLastCalledWith(20, 384)
    test.scroller.scrollTop = 600
    test.scroller.dispatchEvent(new Event('scroll'))
    runFrame()
    expect(frames.size).toBe(0)
    expect(test.scroller.scrollTop).toBe(600)
    test.reorder.clearDrag()
    test.scroller.dispatchEvent(new Event('scroll'))
    test.revision.value++
    expect(frames.size).toBe(0)
  })

  it('rejects an unavailable source hold before pointer capture or interaction listeners', () => {
    const test = setup({ rejectedId: 'a' })
    const addListener = vi.spyOn(test.container, 'addEventListener')
    test.reorder.startDrag(pointer(test.startY), 'track', 'a')
    expect(test.retainItem).toHaveBeenCalledWith('track', 'a')
    expect(test.container.setPointerCapture).not.toHaveBeenCalled()
    expect(addListener).not.toHaveBeenCalled()
    expect(test.rows.get('a')!.setAttribute).not.toHaveBeenCalledWith('data-am-grid-source', '')
    expect(test.reorder.draggedId.value).toBeUndefined()
    expect(test.active.size).toBe(0)
  })

  it('cancels without committing when the destination hold is rejected', () => {
    const test = setup({ rejectedId: 'b' })
    test.reorder.startDrag(pointer(test.startY), 'track', 'a')
    expect(test.active).toEqual(new Set(['a']))
    test.reorder.finishDrag(pointer(250))
    expect(test.move).not.toHaveBeenCalled()
    expect(test.reorder.draggedId.value).toBeUndefined()
    expect(test.active.size).toBe(0)
    expect(test.retentionEvents).toEqual(['retain:a', 'release:a'])
    expect(test.container.releasePointerCapture).toHaveBeenCalledOnce()
    expect(frames.size).toBe(0)
  })

  it('keeps at most the source and current destination when destinations change', () => {
    const test = setup({ retentionLimit: 2 })
    test.reorder.startDrag(pointer(test.startY), 'track', 'a')
    test.reorder.continueDrag(pointer(250))
    runFrame()
    test.setTarget('c')
    test.reorder.continueDrag(pointer(260))
    runFrame()
    expect(test.active).toEqual(new Set(['a', 'c']))
    expect(test.retentionEvents).toContain('release:b')
    expect(Math.max(...test.holdCounts)).toBe(2)
    test.setTarget('a')
    test.reorder.finishDrag(pointer(test.startY))
    expect(test.move).not.toHaveBeenCalled()
    expect(test.active.size).toBe(0)
    expect(test.retentionEvents.filter((event) => event === 'release:a')).toHaveLength(1)
    expect(test.retentionEvents.filter((event) => event === 'release:c')).toHaveLength(1)
  })

  it('releases the previous destination and source when a replacement hold is rejected', () => {
    const test = setup({ retentionLimit: 2, rejectedId: 'c' })
    test.reorder.startDrag(pointer(test.startY), 'track', 'a')
    test.reorder.continueDrag(pointer(250))
    runFrame()
    expect(test.active).toEqual(new Set(['a', 'b']))
    test.setTarget('c')
    test.reorder.finishDrag(pointer(260))
    expect(test.active.size).toBe(0)
    expect(test.rows.get('a')!.removeAttribute).toHaveBeenCalledWith('data-am-grid-source')
    expect(test.move).not.toHaveBeenCalled()
    expect(test.retentionEvents.filter((event) => event === 'release:a')).toHaveLength(1)
    expect(test.retentionEvents.filter((event) => event === 'release:b')).toHaveLength(1)
    expect(Math.max(...test.holdCounts)).toBe(2)
    expect(frames.size).toBe(0)
  })

  it('transfers holds through a synchronous controlled commit until landing completes', async () => {
    const test = setup()
    test.move.mockImplementation(() => {
      expect(test.active).toEqual(new Set(['a', 'b']))
      expect(test.retentionEvents).toEqual(['retain:a', 'retain:b'])
      test.ids.value = ['b', 'a', 'c', 'd', 'e']
      test.setSourcePosition(200)
    })
    test.reorder.startDrag(pointer(test.startY), 'track', 'a')
    test.reorder.finishDrag(pointer(250))
    expect(test.move).toHaveBeenCalledExactlyOnceWith('track', 'a', 'b', ['a', 'b', 'c', 'd', 'e'])
    expect(test.active).toEqual(new Set(['a', 'b']))
    expect(test.rows.get('a')!.removeAttribute).toHaveBeenCalledWith('data-am-grid-source')
    expect(test.rows.get('a')!.setAttribute).toHaveBeenCalledWith('data-am-grid-landing', '')
    await nextTick()
    await nextTick()
    runFrame()
    expect(test.active).toEqual(new Set(['a', 'b']))
    expect(test.reorder.getItemStyle('track', 'a')).toEqual({ contentVisibility: 'visible' })
    vi.advanceTimersByTime(340)
    expect(test.active.size).toBe(0)
    expect(test.retentionEvents).toEqual(['retain:a', 'retain:b', 'release:a', 'release:b'])
    expect(test.rows.get('a')!.removeAttribute).toHaveBeenCalledWith('data-am-grid-landing')
    test.scope.stop()
    expect(test.retentionEvents.filter((event) => event.startsWith('release:'))).toHaveLength(2)
  })

  it.each([
    'cancel',
    'pointercancel',
    'lost-capture',
    'dispose',
    'invalid',
    'remove-source',
  ] as const)('releases drag holds and pending work on %s', (reason) => {
    const test = setup()
    test.reorder.startDrag(pointer(test.startY), 'track', 'a')
    test.reorder.continueDrag(pointer(250))
    runFrame()
    test.revision.value++
    if (reason === 'cancel') test.reorder.clearDrag()
    else if (reason === 'pointercancel' || reason === 'lost-capture')
      test.container.dispatchEvent(
        Object.assign(
          new Event(reason === 'pointercancel' ? 'pointercancel' : 'lostpointercapture'),
          { pointerId: 1 },
        ),
      )
    else if (reason === 'dispose') test.scope.stop()
    else if (reason === 'remove-source') test.ids.value = ['b', 'c', 'd', 'e']
    else {
      test.valid.value = false
      test.revision.value++
      runFrame()
    }
    test.reorder.finishDrag(pointer(250))
    expect(test.move).not.toHaveBeenCalled()
    expect(test.active.size).toBe(0)
    expect(test.rows.get('a')!.removeAttribute).toHaveBeenCalledWith('data-am-grid-source')
    expect(test.retentionEvents.filter((event) => event === 'release:a')).toHaveLength(1)
    expect(test.retentionEvents.filter((event) => event === 'release:b')).toHaveLength(1)
    expect(frames.size).toBe(0)
    test.scroller.dispatchEvent(new Event('scroll'))
    test.revision.value++
    expect(frames.size).toBe(0)
  })

  it('does not let stale landing callbacks release a new drag source hold', async () => {
    const test = setup()
    test.reorder.startDrag(pointer(test.startY), 'track', 'a')
    test.reorder.finishDrag(pointer(250))
    test.reorder.startDrag(pointer(test.startY), 'track', 'a')
    expect(test.active).toEqual(new Set(['a']))
    await nextTick()
    await nextTick()
    runFrame()
    vi.advanceTimersByTime(1000)
    expect(test.active).toEqual(new Set(['a']))
    expect(test.rows.get('a')!.removeAttribute).toHaveBeenCalledWith('data-am-grid-landing')
    test.reorder.clearDrag()
    expect(test.active.size).toBe(0)
    expect(test.retentionEvents.filter((event) => event === 'release:a')).toHaveLength(2)
    expect(test.retentionEvents.filter((event) => event === 'release:b')).toHaveLength(1)
  })
})
