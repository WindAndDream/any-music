import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, shallowRef } from 'vue'
import type { EffectScope } from 'vue'

import type {
  GridReorderGeometryFactory,
  GridReorderGeometrySession,
} from '../../src/composables/grid-reorder-geometry'
import { useGridReorder } from '../../src/composables/use-grid-reorder'
import { createVirtualGridReorderGeometry } from '../../src/composables/virtual-scroll/virtual-grid-reorder-geometry'

function rect(top = 0, height = 400): DOMRect {
  return { left: 0, top, width: 300, height, right: 300, bottom: top + height } as DOMRect
}

function pointer(y = 20): PointerEvent {
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

function setup(
  options: {
    missing?: boolean
    group?: boolean
    candidateId?: string
    factory?: (
      input: Parameters<GridReorderGeometryFactory<'track'>>[0],
      session: GridReorderGeometrySession,
    ) => GridReorderGeometrySession | undefined
  } = {},
) {
  const row = {
    dataset: { testDropId: 'a' },
    setAttribute: vi.fn(),
    removeAttribute: vi.fn(),
    getBoundingClientRect: vi.fn(() => rect(10, 40)),
  }
  const container = {
    isConnected: true,
    scrollTop: 0,
    scrollHeight: 0,
    clientHeight: 0,
    parentElement: null,
    getRootNode: () => ({}),
    getBoundingClientRect: vi.fn(() => rect()),
    querySelectorAll: vi.fn(() => [row]),
    setAttribute: vi.fn(),
    removeAttribute: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    setPointerCapture: vi.fn(),
    hasPointerCapture: () => true,
    releasePointerCapture: vi.fn(),
  }
  let candidateId = options.candidateId ?? 'b'
  const getOffsets = vi.fn(() => new Map([['b', { x: -17, y: 31 }]]))
  const findSlot = vi.fn(() => ({ id: candidateId, left: 80, top: 80, width: 40, height: 40 }))
  const session: GridReorderGeometrySession = {
    sourceSlot: { id: 'a', left: 0, top: 10, width: 40, height: 40 },
    sourceElement: row as unknown as HTMLElement,
    findSlot,
    getOffsets,
  }
  const createGeometry = vi.fn<GridReorderGeometryFactory<'track'>>((input) =>
    options.factory ? options.factory(input, session) : options.missing ? undefined : session,
  )
  const ids = shallowRef<readonly string[]>(['a', 'b', 'c'])
  const move = vi.fn()
  const mismatch = vi.fn()
  const scope = effectScope()
  scopes.push(scope)
  const reorder = scope.run(() =>
    useGridReorder({
      idsByKind: () => ({ track: ids.value }),
      scrollElement: container as unknown as HTMLElement,
      attributePrefix: 'test',
      createGeometry,
      getGroupId: options.group ? (_kind, id) => (id === 'c' ? 'other' : 'same') : undefined,
      onGroupMismatch: mismatch,
      move,
    }),
  )!
  return {
    reorder,
    createGeometry,
    session,
    container,
    row,
    findSlot,
    getOffsets,
    move,
    mismatch,
    ids,
    scope,
    setCandidate: (id: string) => {
      candidateId = id
    },
  }
}

describe('useGridReorder injected geometry', () => {
  it('uses the virtual adapter to commit an initially unmounted destination', () => {
    const ids = ['a', 'b', 'c']
    const test = setup({
      factory: (input, session) =>
        createVirtualGridReorderGeometry(input, {
          geometry: {
            count: ids.length,
            getItem: (index) =>
              index >= 0 && index < ids.length
                ? {
                    key: ids[index]!,
                    index,
                    rowIndex: index,
                    columnIndex: 0,
                    start: 10 + index * 70,
                    size: 40,
                    inlineStart: 0,
                    inlineSize: 40,
                  }
                : undefined,
          },
          columns: 1,
          listWidth: 40,
          origin: { left: 0, top: 0 },
          sourceElement: session.sourceElement,
          mountedIds: () => ['a'],
        }),
    })
    test.reorder.startDrag(pointer(), 'track', 'a')
    expect(test.container.querySelectorAll).not.toHaveBeenCalled()
    test.reorder.continueDrag(pointer(160))
    runFrame()
    expect(test.reorder.dropTargetId.value).toBe('c')
    expect(test.reorder.getItemStyle('track', 'b')).toBeUndefined()
    test.reorder.finishDrag(pointer(160))
    expect(test.move).toHaveBeenCalledExactlyOnceWith('track', 'a', 'c', ids)
    expect(test.container.setPointerCapture).toHaveBeenCalledOnce()
    expect(test.container.releasePointerCapture).toHaveBeenCalledOnce()
  })

  it('queries injected slots and offsets without enumerating DOM at pointer down', () => {
    const test = setup()
    test.reorder.startDrag(pointer(), 'track', 'a')
    expect(test.createGeometry).toHaveBeenCalledOnce()
    expect(test.createGeometry.mock.calls[0]![0]).toMatchObject({
      kind: 'track',
      sourceId: 'a',
      ids: ['a', 'b', 'c'],
      initialScrollTop: 0,
      container: test.container,
    })
    expect(test.container.querySelectorAll).not.toHaveBeenCalled()
    test.reorder.continueDrag(pointer(90))
    runFrame()
    expect(test.findSlot).toHaveBeenCalledExactlyOnceWith(20, 100)
    expect(test.reorder.dropTargetId.value).toBe('b')
    expect(test.getOffsets).toHaveBeenCalledExactlyOnceWith('b')
    expect(test.reorder.getItemStyle('track', 'b')).toEqual({
      transform: 'translate3d(-17px, 31px, 0)',
    })
    // Queries may reconstruct slot objects; eligibility is based on the complete ID snapshot.
    test.reorder.finishDrag(pointer(90))
    expect(test.move).toHaveBeenCalledExactlyOnceWith('track', 'a', 'b', ['a', 'b', 'c'])
  })

  it('does not capture or listen when the geometry cannot supply the source', () => {
    const test = setup({ missing: true })
    test.reorder.startDrag(pointer(), 'track', 'a')
    expect(test.reorder.draggedId.value).toBeUndefined()
    expect(test.container.setPointerCapture).not.toHaveBeenCalled()
    expect(test.container.addEventListener).not.toHaveBeenCalled()
    expect(test.container.setAttribute).not.toHaveBeenCalled()
  })

  it('rejects a geometry session for a different source identity', () => {
    const test = setup()
    test.session.sourceSlot.id = 'b'
    test.reorder.startDrag(pointer(), 'track', 'a')
    expect(test.container.setPointerCapture).not.toHaveBeenCalled()
    expect(test.reorder.draggedId.value).toBeUndefined()
  })

  it('reports known cross-group candidates once and can return to an eligible destination', () => {
    const test = setup({ group: true, candidateId: 'c' })
    test.reorder.startDrag(pointer(), 'track', 'a')
    expect([...test.createGeometry.mock.calls[0]![0].eligibleIds]).toEqual(['a', 'b'])
    for (const y of [90, 95]) {
      test.reorder.continueDrag(pointer(y))
      runFrame()
      expect(test.reorder.dropTargetId.value).toBeUndefined()
    }
    expect(test.mismatch).toHaveBeenCalledExactlyOnceWith('track', 'a', 'c')
    test.setCandidate('b')
    test.reorder.finishDrag(pointer(100))
    expect(test.move).toHaveBeenCalledExactlyOnceWith('track', 'a', 'b', ['a', 'b', 'c'])
  })

  it('ignores unknown identities without reporting a group mismatch or committing', () => {
    const test = setup({ candidateId: 'absent' })
    test.reorder.startDrag(pointer(), 'track', 'a')
    test.reorder.finishDrag(pointer(90))
    expect(test.mismatch).not.toHaveBeenCalled()
    expect(test.getOffsets).not.toHaveBeenCalled()
    expect(test.move).not.toHaveBeenCalled()
  })

  it('preserves the pointer domain before asking for a nearest destination', () => {
    const test = setup()
    test.session.domain = { left: 0, top: 0, width: 300, height: 50 }
    test.reorder.startDrag(pointer(), 'track', 'a')
    test.reorder.finishDrag(pointer(90))
    expect(test.findSlot).not.toHaveBeenCalled()
    expect(test.move).not.toHaveBeenCalled()
    expect(test.mismatch).not.toHaveBeenCalled()
  })

  it('cancels stale queries on real ID changes but retains equal identity snapshots', () => {
    const test = setup()
    test.reorder.startDrag(pointer(), 'track', 'a')
    test.ids.value = [...test.ids.value]
    expect(test.reorder.draggedId.value).toBe('a')
    test.reorder.continueDrag(pointer(90))
    expect(frames.size).toBe(1)
    test.ids.value = ['a', 'c']
    expect(frames.size).toBe(0)
    test.reorder.finishDrag(pointer(90))
    expect(test.findSlot).not.toHaveBeenCalled()
    expect(test.move).not.toHaveBeenCalled()
    expect(test.container.releasePointerCapture).toHaveBeenCalledOnce()
  })

  it('drops the old geometry on explicit cancellation and scope disposal', () => {
    const test = setup()
    test.reorder.startDrag(pointer(), 'track', 'a')
    test.reorder.clearDrag()
    test.reorder.finishDrag(pointer(90))
    expect(test.findSlot).not.toHaveBeenCalled()
    test.reorder.startDrag(pointer(), 'track', 'a')
    test.reorder.continueDrag(pointer(90))
    test.scope.stop()
    runFrame()
    test.reorder.finishDrag(pointer(90))
    expect(test.findSlot).not.toHaveBeenCalled()
    expect(test.move).not.toHaveBeenCalled()
    expect(test.container.releasePointerCapture).toHaveBeenCalledTimes(2)
  })
})
