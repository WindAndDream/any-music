import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick, shallowRef } from 'vue'

import { useQueueReorder } from '../../../src/composables/music-sources/use-queue-reorder'
import { QUEUE_DRAG_READY_MESSAGE } from '../../../src/product/action-feedback'

const showFeedback = vi.hoisted(() => vi.fn())
vi.mock('../../../src/composables/use-action-feedback', () => ({
  useActionFeedback: () => showFeedback,
}))
beforeEach(() => showFeedback.mockClear())

describe('useQueueReorder keyboard movement', () => {
  it('moves within the active platform and moves whole platform blocks', () => {
    const scope = effectScope()
    const arrangementMode = shallowRef<'flat' | 'platform'>('platform')
    const moveTrack = vi.fn()
    const movePlatform = vi.fn()
    const reorder = scope.run(() =>
      useQueueReorder({
        arrangementMode,
        trackIds: ['a1', 'a2', 'b1'],
        platformIds: ['a', 'b'],
        scrollElement: null,
        getPlatformId: (trackId) => trackId[0],
        moveTrack,
        movePlatform,
      }),
    )!

    reorder.shift('track', 'a1', 1)
    reorder.shift('platform', 'a', 1)
    reorder.shift('track', 'a2', 1)
    expect(moveTrack).toHaveBeenCalledExactlyOnceWith('a1', 'a2', ['a1', 'a2'])
    expect(movePlatform).toHaveBeenCalledExactlyOnceWith('a', 'b', ['a', 'b'])

    arrangementMode.value = 'flat'
    reorder.shift('track', 'a2', 1)
    expect(moveTrack).toHaveBeenLastCalledWith('a2', 'b1', ['a1', 'a2', 'b1'])
    expect(showFeedback).not.toHaveBeenCalled()
    scope.stop()
  })
})

function createPointerEvent(y: number, pointerId = 1, x = 100): PointerEvent {
  return { button: 0, pointerId, clientX: x, clientY: y, preventDefault() {} } as PointerEvent
}
function rect(top: number, height = 100, left = 0, width = 300): DOMRect {
  return { top, left, width, height, bottom: top + height, right: left + width } as DOMRect
}

type QueueAdapter = Pick<
  Parameters<typeof useQueueReorder>[0],
  'createGeometry' | 'autoScrollElement' | 'retainItem' | 'focusItem'
>
function createPointerQueueTest(mode: 'flat' | 'platform' = 'flat', adapter: QueueAdapter = {}) {
  const arrangementMode = shallowRef(mode)
  const trackIds = shallowRef<readonly string[]>(['a1', 'a2', 'b1'])
  const platformIds = shallowRef<readonly string[]>(['a', 'b'])
  const groups = ['a', 'b'].map((id, index) => ({
    dataset: { queueDropId: id },
    setAttribute: vi.fn(),
    removeAttribute: vi.fn(),
    getBoundingClientRect: vi.fn(() => rect(index ? 270 : 50, index ? 100 : 210)),
  }))
  const rows = trackIds.value.map((id, index) => ({
    dataset: { queueDropId: id },
    setAttribute: vi.fn(),
    removeAttribute: vi.fn(),
    getBoundingClientRect: vi.fn(() => rect(50 + index * 110)),
    closest: () => groups[id[0] === 'a' ? 0 : 1],
  }))
  const listeners = new Map<string, (event: PointerEvent) => void>()
  const element = {
    scrollHeight: 0,
    scrollTop: 0,
    clientHeight: 0,
    parentElement: null,
    getRootNode: () => ({}),
    getBoundingClientRect: vi.fn(() => rect(0, 400)),
    querySelectorAll: (selector: string) => (selector.includes('platform') ? groups : rows),
    contains: () => true,
    setPointerCapture: vi.fn(),
    setAttribute: vi.fn(),
    removeAttribute: vi.fn(),
    hasPointerCapture: () => true,
    releasePointerCapture: vi.fn(),
    addEventListener: vi.fn((name, handler) => listeners.set(name, handler)),
    removeEventListener: vi.fn((name) => listeners.delete(name)),
  }
  const scope = effectScope()
  const moveTrack = vi.fn()
  const movePlatform = vi.fn()
  const reorder = scope.run(() =>
    useQueueReorder({
      arrangementMode,
      trackIds,
      platformIds,
      scrollElement: element as unknown as HTMLElement,
      get createGeometry() {
        return adapter.createGeometry
      },
      get autoScrollElement() {
        return adapter.autoScrollElement
      },
      get retainItem() {
        return adapter.retainItem
      },
      get focusItem() {
        return adapter.focusItem
      },
      getPlatformId: (id) => id[0],
      moveTrack,
      movePlatform,
    }),
  )!
  return {
    scope,
    reorder,
    moveTrack,
    movePlatform,
    trackIds,
    platformIds,
    arrangementMode,
    element,
    rows,
    groups,
    rect,
    listeners,
    event: createPointerEvent,
  }
}
/** 固定几何与帧时钟只验证输入、让位和提交契约，不宣称真实浏览器动画验证。 */
describe('useQueueReorder pointer movement', () => {
  let frames: Map<number, FrameRequestCallback>
  let nextFrame: number
  beforeEach(() => {
    frames = new Map()
    nextFrame = 0
    vi.stubGlobal(
      'ShadowRoot',
      class {
        host = null
      },
    )
    const windowTarget = Object.assign(new EventTarget(), { innerHeight: 600 })
    vi.spyOn(windowTarget, 'addEventListener')
    vi.spyOn(windowTarget, 'removeEventListener')
    vi.stubGlobal('window', windowTarget)
    vi.stubGlobal(
      'requestAnimationFrame',
      vi.fn((callback: FrameRequestCallback) => {
        frames.set(++nextFrame, callback)
        return nextFrame
      }),
    )
    vi.stubGlobal(
      'cancelAnimationFrame',
      vi.fn((id: number) => frames.delete(id)),
    )
  })
  afterEach(() => vi.unstubAllGlobals())
  function runFrame() {
    const pending = [...frames.values()]
    frames.clear()
    pending.forEach((callback) => callback(16))
  }
  it('switches between semantic and DOM geometry as the controlled consumer surface changes', () => {
    const adapter: QueueAdapter = {}
    const test = createPointerQueueTest('flat', adapter)
    try {
      test.reorder.startDrag(test.event(100), 'track', 'a1')
      expect(test.reorder.draggedId.value).toBe('a1')
      test.reorder.clearDrag()

      const geometry = vi.fn<NonNullable<QueueAdapter['createGeometry']>>(() => undefined)
      adapter.createGeometry = geometry
      test.reorder.startDrag(test.event(100), 'track', 'a1')
      expect(geometry).toHaveBeenCalledOnce()
      expect(geometry.mock.calls[0]?.[0]).toMatchObject({
        kind: 'track',
        sourceId: 'a1',
        ids: ['a1', 'a2', 'b1'],
        container: test.element,
      })
      expect(test.reorder.draggedId.value).toBeUndefined()

      adapter.createGeometry = undefined
      adapter.retainItem = vi.fn(() => undefined)
      test.reorder.startDrag(test.event(100), 'track', 'a1')
      expect(adapter.retainItem).toHaveBeenCalledExactlyOnceWith('track', 'a1')
      expect(test.reorder.draggedId.value).toBeUndefined()

      adapter.retainItem = undefined
      test.reorder.startDrag(test.event(100), 'track', 'a1')
      expect(test.reorder.draggedId.value).toBe('a1')
    } finally {
      test.scope.stop()
    }
  })
  it('cancels a stale drag when the mouse returns without its primary button', () => {
    const test = createPointerQueueTest()
    test.reorder.startDrag(test.event(100), 'track', 'a1')
    test.reorder.continueDrag(test.event(210))
    runFrame()
    expect(test.reorder.dropTargetId.value).toBe('a2')
    window.dispatchEvent(
      Object.assign(new Event('pointermove'), {
        pointerId: 1,
        pointerType: 'mouse',
        buttons: 0,
      }),
    )
    expect(test.reorder.draggedId.value).toBeUndefined()
    expect(test.reorder.dropTargetId.value).toBeUndefined()
    expect(test.element.removeAttribute).toHaveBeenCalledWith('data-am-grid-dragging')
    expect(test.element.releasePointerCapture).toHaveBeenCalledOnce()
    expect(frames.size).toBe(0)
    test.reorder.finishDrag(test.event(210))
    expect(test.moveTrack).not.toHaveBeenCalled()
    test.reorder.startDrag(test.event(100), 'track', 'a1')
    window.dispatchEvent(Object.assign(new Event('pointerup'), test.event(210)))
    expect(test.moveTrack).toHaveBeenCalledExactlyOnceWith('a1', 'a2', ['a1', 'a2', 'b1'])
    test.scope.stop()
  })
  it.each(['flat', 'platform'] as const)(
    'activates the shared grid only after holding artwork in %s view',
    (mode) => {
      vi.useFakeTimers()
      const test = createPointerQueueTest(mode)
      try {
        const cover = Object.assign(new EventTarget(), { closest: () => null, focus: vi.fn() })
        test.reorder.startTrackPress(
          { ...test.event(100), currentTarget: cover } as unknown as PointerEvent,
          'a1',
        )
        vi.advanceTimersByTime(499)
        expect(test.reorder.draggedId.value).toBeUndefined()
        expect(test.element.setPointerCapture).not.toHaveBeenCalled()
        expect(showFeedback).not.toHaveBeenCalled()
        // 相同 ID 的公开投影刷新不能撤销长按。
        test.trackIds.value = [...test.trackIds.value]
        vi.advanceTimersByTime(1)
        expect(test.reorder.draggedId.value).toBe('a1')
        expect(test.element.setPointerCapture).toHaveBeenCalledWith(1)
        expect(test.element.setAttribute).toHaveBeenCalledWith('data-am-grid-dragging', '')
        expect(showFeedback).toHaveBeenCalledExactlyOnceWith({
          status: 'info',
          icon: 'drag',
          message: QUEUE_DRAG_READY_MESSAGE,
        })
        test.reorder.continueDrag(test.event(210))
        runFrame()
        expect(test.moveTrack).not.toHaveBeenCalled()
        test.reorder.finishDrag(test.event(210))
        expect(test.moveTrack).toHaveBeenCalledOnce()
        expect(test.element.removeAttribute).toHaveBeenCalledWith('data-am-grid-dragging')
        expect(test.moveTrack.mock.lastCall?.slice(0, 2)).toEqual(['a1', 'a2'])
        expect(showFeedback).toHaveBeenCalledOnce()
      } finally {
        test.scope.stop()
        vi.useRealTimers()
      }
    },
  )
  it('waits for a platform hold, announces activation once, and commits the platform block on release', () => {
    vi.useFakeTimers()
    const test = createPointerQueueTest('platform')
    try {
      const card = Object.assign(new EventTarget(), { closest: () => null, focus: vi.fn() })
      test.reorder.startPlatformPress(
        { ...test.event(100), currentTarget: card } as unknown as PointerEvent,
        'a',
      )
      vi.advanceTimersByTime(499)
      expect(test.reorder.draggedId.value).toBeUndefined()
      expect(test.element.setPointerCapture).not.toHaveBeenCalled()
      expect(showFeedback).not.toHaveBeenCalled()
      vi.advanceTimersByTime(1)
      expect(test.reorder.dragKind.value).toBe('platform')
      expect(test.reorder.draggedId.value).toBe('a')
      expect(showFeedback).toHaveBeenCalledExactlyOnceWith({
        status: 'info',
        icon: 'drag',
        message: QUEUE_DRAG_READY_MESSAGE,
      })
      test.reorder.continueDrag(test.event(330))
      runFrame()
      expect(test.movePlatform).not.toHaveBeenCalled()
      test.reorder.finishDrag(test.event(330))
      expect(test.movePlatform).toHaveBeenCalledExactlyOnceWith('a', 'b', ['a', 'b'])
      expect(test.moveTrack).not.toHaveBeenCalled()
      expect(showFeedback).toHaveBeenCalledOnce()
    } finally {
      test.scope.stop()
      vi.useRealTimers()
    }
  })
  it('does not activate or announce a released or cancelled platform hold', () => {
    vi.useFakeTimers()
    const test = createPointerQueueTest('platform')
    try {
      const card = Object.assign(new EventTarget(), { closest: () => null, focus: vi.fn() })
      const event = { ...test.event(100), currentTarget: card } as unknown as PointerEvent
      test.reorder.startPlatformPress(event, 'a')
      vi.advanceTimersByTime(200)
      const release = vi
        .mocked(window.addEventListener)
        .mock.calls.find(([name]) => name === 'pointerup')?.[1] as (event: PointerEvent) => void
      release(event)
      vi.advanceTimersByTime(500)
      expect(showFeedback).not.toHaveBeenCalled()
      test.reorder.startPlatformPress(event, 'a')
      vi.advanceTimersByTime(200)
      test.reorder.clearDrag()
      vi.advanceTimersByTime(500)
      expect(test.reorder.draggedId.value).toBeUndefined()
      expect(test.movePlatform).not.toHaveBeenCalled()
      expect(showFeedback).not.toHaveBeenCalled()
    } finally {
      test.scope.stop()
      vi.useRealTimers()
    }
  })
  it.each(['layout', 'arrangement', 'tracks'])(
    'cancels pending artwork activation when %s changes',
    (change) => {
      vi.useFakeTimers()
      const test = createPointerQueueTest()
      try {
        const cover = Object.assign(new EventTarget(), { closest: () => null, focus: vi.fn() })
        test.reorder.startTrackPress(
          { ...test.event(100), currentTarget: cover } as unknown as PointerEvent,
          'a1',
        )
        vi.advanceTimersByTime(200)
        if (change === 'layout') test.reorder.clearDrag()
        else if (change === 'arrangement') test.arrangementMode.value = 'platform'
        else test.trackIds.value = ['a2', 'b1']
        vi.advanceTimersByTime(500)
        expect(test.reorder.draggedId.value).toBeUndefined()
        expect(test.element.setPointerCapture).not.toHaveBeenCalled()
        expect(test.moveTrack).not.toHaveBeenCalled()
        expect(showFeedback).not.toHaveBeenCalled()
      } finally {
        test.scope.stop()
        vi.useRealTimers()
      }
    },
  )
  it('does not announce a short press or a hold that cannot start grid sorting', () => {
    vi.useFakeTimers()
    const test = createPointerQueueTest()
    try {
      const cover = Object.assign(new EventTarget(), { closest: () => null, focus: vi.fn() })
      const event = { ...test.event(100), currentTarget: cover } as unknown as PointerEvent
      test.reorder.startTrackPress(event, 'a1')
      vi.advanceTimersByTime(200)
      const release = vi
        .mocked(window.addEventListener)
        .mock.calls.find(([name]) => name === 'pointerup')?.[1] as (event: PointerEvent) => void
      release(test.event(100))
      vi.advanceTimersByTime(500)
      expect(showFeedback).not.toHaveBeenCalled()
      test.reorder.startTrackPress(event, 'missing-track')
      vi.advanceTimersByTime(500)
      expect(test.reorder.draggedId.value).toBeUndefined()
      expect(showFeedback).not.toHaveBeenCalled()
    } finally {
      test.scope.stop()
      vi.useRealTimers()
    }
  })
  it('announces each new activated hold without a cooldown', () => {
    vi.useFakeTimers()
    const test = createPointerQueueTest()
    try {
      const cover = Object.assign(new EventTarget(), { closest: () => null, focus: vi.fn() })
      const event = { ...test.event(100), currentTarget: cover } as unknown as PointerEvent
      test.reorder.startTrackPress(event, 'a1')
      vi.advanceTimersByTime(500)
      expect(showFeedback).toHaveBeenCalledOnce()
      test.reorder.clearDrag()
      test.reorder.startTrackPress(event, 'a1')
      vi.advanceTimersByTime(500)
      expect(showFeedback).toHaveBeenCalledTimes(2)
    } finally {
      test.scope.stop()
      vi.useRealTimers()
    }
  })
  it('releases touch handling when the grid unexpectedly loses pointer capture', () => {
    vi.useFakeTimers()
    const test = createPointerQueueTest()
    try {
      const cover = Object.assign(new EventTarget(), { closest: () => null, focus: vi.fn() })
      test.reorder.startTrackPress(
        { ...test.event(100), currentTarget: cover } as unknown as PointerEvent,
        'a1',
      )
      vi.advanceTimersByTime(500)
      test.listeners.get('lostpointercapture')?.({
        ...test.event(100),
        target: test.element,
      } as unknown as PointerEvent)
      expect(test.reorder.draggedId.value).toBeUndefined()
      const event = Object.assign(new Event('touchmove', { cancelable: true }), { touches: [{}] })
      cover.dispatchEvent(event)
      expect(event.defaultPrevented).toBe(false)
      expect(test.moveTrack).not.toHaveBeenCalled()
    } finally {
      test.scope.stop()
      vi.useRealTimers()
    }
  })
  it('coalesces pointer events, floats the source over fixed slots and saves only on release', async () => {
    const test = createPointerQueueTest()
    test.reorder.startDrag(test.event(100), 'track', 'a1')
    test.reorder.continueDrag(test.event(200))
    test.reorder.continueDrag(test.event(210))
    expect(frames.size).toBe(1)
    runFrame()
    expect(test.reorder.getItemStyle('track', 'a1')?.transform).toBe('translate3d(0px, 110px, 0)')
    expect(test.reorder.getItemStyle('track', 'a2')?.transform).toBe('translate3d(0px, -110px, 0)')
    expect(test.trackIds.value).toEqual(['a1', 'a2', 'b1'])
    expect(test.moveTrack).not.toHaveBeenCalled()
    // 模拟动画中的邻卡位置变化；固定槽位不重新测量它，也不会交换回去。
    test.rows[1]!.getBoundingClientRect.mockReturnValue(test.rect(50))
    test.reorder.continueDrag(test.event(210))
    runFrame()
    expect(test.reorder.dropTargetId.value).toBe('a2')
    expect(test.rows[1]!.getBoundingClientRect).toHaveBeenCalledTimes(1)
    test.reorder.finishDrag(test.event(210))
    expect(test.moveTrack).toHaveBeenCalledExactlyOnceWith('a1', 'a2', ['a1', 'a2', 'b1'])
    expect(test.element.releasePointerCapture).toHaveBeenCalledWith(1)
    expect(test.reorder.isSettling.value).toBe(true)
    await nextTick()
    await nextTick()
    runFrame()
    expect(test.reorder.getItemStyle('track', 'a1')).toEqual({ contentVisibility: 'visible' })
    test.scope.stop()
  })
  it('can move back to the original slot without writing a changed order', () => {
    const test = createPointerQueueTest()
    test.reorder.startDrag(test.event(100), 'track', 'a1')
    test.reorder.continueDrag(test.event(210))
    runFrame()
    // 向上拖回原来的固定槽位，恢复顺序而不提交。
    test.reorder.continueDrag(test.event(100))
    runFrame()
    expect(test.reorder.dropTargetId.value).toBeUndefined()
    expect(test.reorder.getItemStyle('track', 'a2')).toBeUndefined()
    test.reorder.finishDrag(test.event(100))
    expect(test.moveTrack).not.toHaveBeenCalled()
    test.scope.stop()
  })
  it.each(['flat', 'platform'] as const)(
    'preserves track landing when the parent publishes the committed %s order',
    async (mode) => {
      const test = createPointerQueueTest(mode)
      test.moveTrack.mockImplementation(() => {
        test.rows[0]!.getBoundingClientRect.mockReturnValue(test.rect(160))
        test.trackIds.value = ['a2', 'a1', 'b1']
      })
      try {
        test.reorder.startDrag(test.event(100), 'track', 'a1')
        test.reorder.finishDrag(test.event(225))
        // The order notification is part of committing this drag, not a cancellation.
        expect(test.reorder.isSettling.value).toBe(true)
        expect(test.reorder.getItemStyle('track', 'a1')?.transform).toBe(
          'translate3d(0px, 125px, 0)',
        )
        await nextTick()
        expect(test.reorder.isSettling.value).toBe(true)
        expect(test.reorder.getItemStyle('track', 'a1')?.transform).toBe(
          'translate3d(0px, 15px, 0)',
        )
        await nextTick()
        runFrame()
        expect(test.reorder.isSettling.value).toBe(false)
        expect(test.reorder.getItemStyle('track', 'a1')).toEqual({ contentVisibility: 'visible' })
      } finally {
        test.scope.stop()
      }
    },
  )
  it.each([
    ['same row forward', 'a1', 'a2', ['a2', 'a1', 'b1']],
    ['same row backward', 'a2', 'a1', ['a2', 'a1', 'b1']],
    ['across rows forward', 'a1', 'b1', ['a2', 'b1', 'a1']],
    ['across rows backward', 'b1', 'a1', ['b1', 'a1', 'a2']],
  ] as const)(
    'hands shifted neighbors to their committed slots without another transform transition: %s',
    async (_label, source, target, order) => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
      const test = createPointerQueueTest()
      const originalIds = [...test.trackIds.value]
      const position = (index: number) =>
        test.rect(50 + Math.floor(index / 2) * 110, 100, (index % 2) * 330)
      test.element.getBoundingClientRect.mockReturnValue(test.rect(0, 400, 0, 660))
      for (const row of test.rows)
        row.getBoundingClientRect.mockImplementation(() =>
          position(test.trackIds.value.indexOf(row.dataset.queueDropId)),
        )
      const pointer = (id: string) => {
        const bounds = position(originalIds.indexOf(id))
        return test.event(bounds.top + 50, 1, bounds.left + 100)
      }
      test.moveTrack.mockImplementation(() => {
        test.trackIds.value = order
      })
      try {
        test.reorder.startDrag(pointer(source), 'track', source)
        test.reorder.continueDrag(pointer(target))
        runFrame()
        const shifted = originalIds.filter(
          (id) => id !== source && test.reorder.getItemStyle('track', id),
        )
        expect(shifted.length).toBeGreaterThan(0)
        test.reorder.finishDrag(pointer(target))
        expect(test.moveTrack).toHaveBeenCalledExactlyOnceWith(source, target, originalIds)
        for (const id of shifted) {
          expect(test.reorder.getItemStyle('track', id)).toEqual({
            transition: 'none',
            contentVisibility: 'visible',
          })
          const row = test.rows.find((candidate) => candidate.dataset.queueDropId === id)!
          expect(row.setAttribute).toHaveBeenCalledWith('data-am-grid-settling', '')
          expect(row.setAttribute).not.toHaveBeenCalledWith('data-am-grid-landing', '')
        }
        await nextTick()
        await nextTick()
        runFrame()
        for (const id of shifted)
          expect(test.reorder.getItemStyle('track', id)).toEqual({ contentVisibility: 'visible' })
        vi.advanceTimersByTime(340)
        for (const id of shifted) {
          expect(test.reorder.getItemStyle('track', id)).toBeUndefined()
          expect(
            test.rows.find((row) => row.dataset.queueDropId === id)!.removeAttribute,
          ).toHaveBeenCalledWith('data-am-grid-settling')
        }
      } finally {
        test.scope.stop()
        vi.useRealTimers()
      }
    },
  )
  it.each([
    ['forward', 'a1', 'a2', -55, 55],
    ['backward', 'a2', 'a1', 55, -55],
  ] as const)(
    'rebases a partially shifted neighbor from its visible position on a quick %s release',
    async (_label, source, target, previewY, remainingY) => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
      const test = createPointerQueueTest()
      const originalIds = [...test.trackIds.value]
      const neighbor = test.rows.find((row) => row.dataset.queueDropId === target)!
      for (const row of test.rows)
        row.getBoundingClientRect.mockImplementation(() =>
          rect(50 + test.trackIds.value.indexOf(row.dataset.queueDropId) * 110),
        )
      const surface = {
        getBoundingClientRect: () => rect(50 + originalIds.indexOf(target) * 110 + previewY),
      }
      Object.assign(neighbor, { querySelector: () => surface })
      test.moveTrack.mockImplementation(() => {
        test.trackIds.value = ['a2', 'a1', 'b1']
      })
      try {
        test.reorder.startDrag(test.event(100 + originalIds.indexOf(source) * 110), 'track', source)
        test.reorder.finishDrag(test.event(100 + originalIds.indexOf(target) * 110))
        expect(test.reorder.getItemStyle('track', target)).toEqual({
          transform: `translate3d(0px, ${previewY}px, 0)`,
          transition: 'none',
          contentVisibility: 'visible',
        })
        await nextTick()
        expect(test.reorder.getItemStyle('track', target)).toEqual({
          transform: `translate3d(0px, ${remainingY}px, 0)`,
          transition: 'none',
          contentVisibility: 'visible',
        })
        await nextTick()
        runFrame()
        expect(test.reorder.getItemStyle('track', target)).toEqual({ contentVisibility: 'visible' })
        vi.advanceTimersByTime(340)
        expect(test.reorder.getItemStyle('track', target)).toBeUndefined()
        expect(neighbor.removeAttribute).toHaveBeenCalledWith('data-am-grid-settling')
      } finally {
        test.scope.stop()
        vi.useRealTimers()
      }
    },
  )
  it('preserves platform landing when the parent publishes the committed group order', async () => {
    const test = createPointerQueueTest('platform')
    test.movePlatform.mockImplementation(() => {
      test.groups[0]!.getBoundingClientRect.mockReturnValue(test.rect(270, 210))
      test.platformIds.value = ['b', 'a']
      test.trackIds.value = ['b1', 'a1', 'a2']
    })
    try {
      test.reorder.startDrag(test.event(100), 'platform', 'a')
      test.reorder.finishDrag(test.event(340))
      expect(test.reorder.isSettling.value).toBe(true)
      await nextTick()
      expect(test.reorder.isSettling.value).toBe(true)
      expect(test.reorder.getItemStyle('platform', 'a')?.transform).toBe(
        'translate3d(0px, 20px, 0)',
      )
      await nextTick()
      runFrame()
      expect(test.reorder.isSettling.value).toBe(false)
      expect(test.reorder.getItemStyle('platform', 'a')).toEqual({ contentVisibility: 'visible' })
    } finally {
      test.scope.stop()
    }
  })
  it('keeps the last position while crossing grid gaps and can drop into that gap', () => {
    const test = createPointerQueueTest()
    test.reorder.startDrag(test.event(100), 'track', 'a1')
    test.reorder.continueDrag(test.event(210))
    runFrame()
    test.reorder.continueDrag(test.event(260))
    runFrame()
    expect(test.reorder.dropTargetId.value).toBe('a2')
    test.reorder.finishDrag(test.event(260))
    expect(test.moveTrack).toHaveBeenCalledExactlyOnceWith('a1', 'a2', ['a1', 'a2', 'b1'])
    test.scope.stop()
  })
  it('rejects cross-platform drops and cancels when the visible snapshot changes', () => {
    const test = createPointerQueueTest('platform')
    test.reorder.startDrag(test.event(100), 'track', 'a1')
    test.reorder.continueDrag(test.event(320))
    runFrame()
    expect(test.reorder.dropTargetId.value).toBeUndefined()
    test.reorder.continueDrag(test.event(210))
    runFrame()
    expect(test.reorder.dropTargetId.value).toBe('a2')
    test.trackIds.value = ['a1', 'b1']
    expect(test.reorder.draggedId.value).toBeUndefined()
    test.reorder.finishDrag(test.event(210))
    expect(test.moveTrack).not.toHaveBeenCalled()
    test.scope.stop()
  })
  it('keeps identical ID refreshes draggable, but cancels when arrangement changes', () => {
    const test = createPointerQueueTest()
    test.reorder.startDrag(test.event(100), 'track', 'a1')
    test.trackIds.value = [...test.trackIds.value]
    expect(test.reorder.draggedId.value).toBe('a1')
    test.reorder.continueDrag(test.event(210))
    runFrame()
    expect(test.reorder.dropTargetId.value).toBe('a2')
    test.arrangementMode.value = 'platform'
    expect(test.reorder.draggedId.value).toBeUndefined()
    test.reorder.finishDrag(test.event(210))
    expect(test.moveTrack).not.toHaveBeenCalled()
    test.scope.stop()
  })
  it('leaves order unchanged on a tap, an outside drop, or disposal with a scheduled frame', () => {
    const test = createPointerQueueTest()
    test.reorder.startDrag(test.event(100), 'track', 'a1')
    test.reorder.finishDrag(test.event(102))
    expect(test.moveTrack).not.toHaveBeenCalled()
    test.reorder.startDrag(test.event(100), 'track', 'a1')
    test.reorder.continueDrag(test.event(210))
    runFrame()
    test.reorder.finishDrag(test.event(450))
    expect(test.moveTrack).not.toHaveBeenCalled()
    test.reorder.startDrag(test.event(100), 'track', 'a1')
    test.reorder.continueDrag(test.event(200))
    test.scope.stop()
    expect(frames.size).toBe(0)
    expect(test.reorder.draggedId.value).toBeUndefined()
  })
  it('restores keyboard handle focus after reordering and does not steal focus from a dialog', async () => {
    const test = createPointerQueueTest()
    const focus = vi.fn()
    const row = { dataset: { queueDropId: 'a2' }, querySelector: () => ({ focus }) }
    vi.stubGlobal('document', { activeElement: { hasAttribute: () => true, closest: () => row } })
    Object.assign(test.element, {
      isConnected: true,
      closest: () => null,
      querySelectorAll: () => [row],
    })
    test.reorder.shift('track', 'a2', -1)
    await nextTick()
    expect(focus).toHaveBeenCalledExactlyOnceWith({ preventScroll: true })
    vi.stubGlobal('document', { activeElement: { hasAttribute: () => false } })
    test.reorder.shift('track', 'a2', -1)
    await nextTick()
    expect(focus).toHaveBeenCalledTimes(1)
    test.scope.stop()
  })
  it('moves complete platform groups and ignores other pointers and pointer cancellation', () => {
    const test = createPointerQueueTest('platform')
    test.reorder.startDrag(test.event(100), 'platform', 'a')
    test.reorder.continueDrag(test.event(320, 2))
    expect(frames.size).toBe(0)
    test.reorder.continueDrag(test.event(320))
    runFrame()
    expect(test.reorder.getItemStyle('platform', 'b')?.transform).toBe(
      'translate3d(0px, -220px, 0)',
    )
    expect(test.reorder.getItemStyle('track', 'a1')).toBeUndefined()
    test.reorder.finishDrag(test.event(320))
    expect(test.movePlatform).toHaveBeenCalledExactlyOnceWith('a', 'b', ['a', 'b'])
    test.reorder.startDrag(test.event(100), 'platform', 'a')
    test.reorder.continueDrag(test.event(320))
    test.listeners.get('pointercancel')?.(test.event(320))
    expect(frames.size).toBe(0)
    expect(test.reorder.draggedId.value).toBeUndefined()
    expect(test.movePlatform).toHaveBeenCalledTimes(1)
    test.scope.stop()
  })
  it('moves platform cards across columns using both horizontal and vertical offsets', () => {
    const test = createPointerQueueTest('platform')
    const groups = test.element.querySelectorAll('platform')
    groups[0]!.getBoundingClientRect.mockReturnValue({ ...test.rect(50, 140, 10, 200) } as DOMRect)
    groups[1]!.getBoundingClientRect.mockReturnValue({ ...test.rect(50, 140, 230, 200) } as DOMRect)
    test.element.getBoundingClientRect.mockReturnValue(test.rect(0, 400, 0, 450))
    test.reorder.startDrag({ ...test.event(100), clientX: 110 }, 'platform', 'a')
    test.reorder.continueDrag({ ...test.event(100), clientX: 330 })
    runFrame()
    expect(test.reorder.getItemStyle('platform', 'b')?.transform).toBe(
      'translate3d(-220px, 0px, 0)',
    )
    test.reorder.finishDrag({ ...test.event(100), clientX: 330 })
    expect(test.movePlatform).toHaveBeenCalledExactlyOnceWith('a', 'b', ['a', 'b'])
    test.scope.stop()
  })
  it('continues ancestor edge scrolling with a stationary pointer and stops on cancellation', () => {
    const test = createPointerQueueTest()
    const scroller = Object.assign(new EventTarget(), {
      scrollHeight: 1000,
      clientHeight: 400,
      scrollTop: 0,
      parentElement: null,
      getBoundingClientRect: () => test.rect(0, 400),
    })
    Object.assign(test.element, { parentElement: scroller })
    test.element.getBoundingClientRect.mockImplementation(() =>
      test.rect(-scroller.scrollTop, 1000),
    )
    vi.stubGlobal('getComputedStyle', () => ({ overflowY: 'auto' }))
    test.reorder.startDrag(test.event(100), 'track', 'a1')
    test.reorder.continueDrag(test.event(390))
    runFrame()
    expect(scroller.scrollTop).toBe(14)
    expect(test.reorder.getItemStyle('track', 'a1')?.transform).toBe('translate3d(0px, 304px, 0)')
    runFrame()
    expect(scroller.scrollTop).toBe(28)
    expect(test.moveTrack).not.toHaveBeenCalled()
    test.reorder.clearDrag()
    expect(frames.size).toBe(0)
    test.scope.stop()
  })
  it('coalesces ancestor scrolling with pointer movement and follows scrolling without further pointer input', () => {
    const test = createPointerQueueTest()
    const scroller = Object.assign(new EventTarget(), {
      scrollHeight: 1000,
      clientHeight: 400,
      scrollTop: 0,
      parentElement: null,
      getBoundingClientRect: () => test.rect(0, 400),
    })
    Object.assign(test.element, { parentElement: scroller })
    test.element.getBoundingClientRect.mockImplementation(() =>
      test.rect(-scroller.scrollTop, 1000),
    )
    vi.stubGlobal('getComputedStyle', () => ({ overflowY: 'auto' }))
    test.reorder.startDrag(test.event(100), 'track', 'a1')
    test.reorder.continueDrag(test.event(110))
    scroller.scrollTop = 100
    scroller.dispatchEvent(new Event('scroll'))
    scroller.dispatchEvent(new Event('scroll'))
    expect(frames.size).toBe(1)
    runFrame()
    expect(test.reorder.getItemStyle('track', 'a1')?.transform).toBe('translate3d(0px, 110px, 0)')
    expect(test.reorder.dropTargetId.value).toBe('a2')
    // 滚轮继续移动内容，指针没有新的 pointermove 也必须同步浮起卡片和落点。
    scroller.scrollTop = 210
    scroller.dispatchEvent(new Event('scroll'))
    runFrame()
    expect(test.reorder.getItemStyle('track', 'a1')?.transform).toBe('translate3d(0px, 220px, 0)')
    expect(test.reorder.dropTargetId.value).toBe('b1')
    expect(test.rows.every((row) => row.getBoundingClientRect.mock.calls.length === 1)).toBe(true)
    expect(test.moveTrack).not.toHaveBeenCalled()
    test.reorder.finishDrag(test.event(110))
    expect(test.moveTrack).toHaveBeenCalledExactlyOnceWith('a1', 'b1', ['a1', 'a2', 'b1'])
    test.scope.stop()
    scroller.dispatchEvent(new Event('scroll'))
    expect(frames.size).toBe(0)
  })
  it('allows scrolling alone to move the held card when the grid itself is the scroller', () => {
    const test = createPointerQueueTest()
    Object.assign(test.element, { scrollHeight: 1000, clientHeight: 400, scrollTop: 120 })
    vi.stubGlobal('getComputedStyle', () => ({ overflowY: 'auto' }))
    test.reorder.startDrag(test.event(100), 'track', 'a1')
    test.element.scrollTop = 450
    test.listeners.get('scroll')?.(new Event('scroll') as unknown as PointerEvent)
    runFrame()
    expect(test.reorder.getItemStyle('track', 'a1')?.transform).toBe('translate3d(0px, 330px, 0)')
    expect(test.reorder.dropTargetId.value).toBe('b1')
    test.reorder.clearDrag()
    expect(test.listeners.has('scroll')).toBe(false)
    expect(frames.size).toBe(0)
    test.scope.stop()
  })
  it('reads geometry before writing edge scroll and stops at the scroll boundary', () => {
    const test = createPointerQueueTest()
    const operations: string[] = []
    let scrollTop = 590
    const scroller = Object.assign(new EventTarget(), {
      scrollHeight: 1000,
      clientHeight: 400,
      parentElement: null,
      getBoundingClientRect: () => {
        operations.push('read scroller')
        return test.rect(0, 400)
      },
    })
    Object.defineProperty(scroller, 'scrollTop', {
      get: () => scrollTop,
      set: (value: number) => {
        operations.push('write scroll')
        scrollTop = value
      },
    })
    Object.assign(test.element, { parentElement: scroller })
    test.element.getBoundingClientRect.mockImplementation(() => {
      operations.push('read grid')
      return test.rect(-scrollTop, 1000)
    })
    vi.stubGlobal('getComputedStyle', () => ({ overflowY: 'auto' }))
    test.reorder.startDrag(test.event(100), 'track', 'a1')
    operations.length = 0
    test.reorder.continueDrag(test.event(390))
    runFrame()
    expect(operations).toEqual(['read grid', 'read scroller', 'write scroll'])
    expect(scrollTop).toBe(600)
    expect(frames.size).toBe(1)
    runFrame()
    expect(frames.size).toBe(0)
    test.scope.stop()
  })
  it('keeps unchanged transforms stable during repeated movement and target changes', () => {
    const test = createPointerQueueTest()
    test.reorder.startDrag(test.event(100), 'track', 'a1')
    test.reorder.continueDrag(test.event(210))
    runFrame()
    const sourceStyle = test.reorder.getItemStyle('track', 'a1')
    const shiftedStyle = test.reorder.getItemStyle('track', 'a2')
    test.reorder.continueDrag(test.event(210))
    runFrame()
    expect(test.reorder.getItemStyle('track', 'a1')).toBe(sourceStyle)
    test.reorder.continueDrag(test.event(320))
    runFrame()
    expect(test.reorder.getItemStyle('track', 'a2')).toBe(shiftedStyle)
    test.scope.stop()
  })
  it('discards pending landing work when deactivated or disposed', async () => {
    const test = createPointerQueueTest()
    test.reorder.startDrag(test.event(100), 'track', 'a1')
    test.reorder.finishDrag(test.event(210))
    expect(test.reorder.isSettling.value).toBe(true)
    test.reorder.clearDrag()
    await nextTick()
    await nextTick()
    expect(frames.size).toBe(0)
    expect(test.reorder.isSettling.value).toBe(false)
    test.reorder.startDrag(test.event(100), 'track', 'a1')
    test.reorder.finishDrag(test.event(210))
    test.scope.stop()
    await nextTick()
    expect(frames.size).toBe(0)
  })

  it('cancels when a sidebar changes grid width and releases the single observer', () => {
    const disconnect = vi.fn()
    let onResize!: ResizeObserverCallback
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: ResizeObserverCallback) {
          onResize = callback
        }
        observe() {}
        disconnect = disconnect
      },
    )
    const test = createPointerQueueTest()
    test.reorder.startDrag(test.event(100), 'track', 'a1')
    test.element.getBoundingClientRect.mockReturnValue(test.rect(0, 400, 0, 240))
    onResize([], {} as ResizeObserver)
    expect(test.reorder.draggedId.value).toBeUndefined()
    expect(test.moveTrack).not.toHaveBeenCalled()
    expect(test.element.releasePointerCapture).toHaveBeenCalledOnce()
    expect(disconnect).toHaveBeenCalledOnce()
    test.scope.stop()
  })
})
