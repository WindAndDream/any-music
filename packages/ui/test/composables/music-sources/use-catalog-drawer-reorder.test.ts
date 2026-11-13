import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick, shallowRef } from 'vue'

import { useCatalogDrawerReorder } from '../../../src/composables/music-sources/use-catalog-drawer-reorder'
import { QUEUE_DRAG_READY_MESSAGE } from '../../../src/product/action-feedback'
import type { CatalogDrawerView } from '../../../src/product/catalog-drawer'

const showFeedback = vi.hoisted(() => vi.fn())
vi.mock('../../../src/composables/use-action-feedback', () => ({
  useActionFeedback: () => showFeedback,
}))

type Listener = (event: PointerEvent | KeyboardEvent) => void
class Target {
  isConnected = true
  focus = vi.fn()
  addEventListener = vi.fn()
  removeEventListener = vi.fn()
  closest = () => null
}

function rect(left = 0, width = 660): DOMRect {
  return { left, top: 0, width, height: 200, right: left + width, bottom: 200 } as DOMRect
}
function event(x = 60, target = new Target()): PointerEvent {
  return {
    pointerId: 1,
    isPrimary: true,
    button: 0,
    clientX: x,
    clientY: 60,
    target,
    currentTarget: target,
    detail: 1,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
    stopImmediatePropagation: vi.fn(),
  } as unknown as PointerEvent
}

/** 固定槽位和时钟验证长按输入、二维排序与取消；不启动产品界面。 */
function createReorder() {
  const listeners = new Map<string, Set<Listener>>()
  const addEventListener = (name: string, handler: Listener) => {
    const handlers = listeners.get(name) ?? new Set()
    handlers.add(handler)
    listeners.set(name, handlers)
  }
  const removeEventListener = (name: string, handler: Listener) =>
    listeners.get(name)?.delete(handler)
  const frames = new Map<number, FrameRequestCallback>()
  let frameId = 0
  vi.stubGlobal('Element', Target)
  vi.stubGlobal(
    'ShadowRoot',
    class {
      host = null
    },
  )
  vi.stubGlobal('document', Object.assign(new EventTarget(), { activeElement: null }))
  vi.stubGlobal('window', { innerHeight: 600, addEventListener, removeEventListener })
  vi.stubGlobal('requestAnimationFrame', (handler: FrameRequestCallback) => {
    frames.set(++frameId, handler)
    return frameId
  })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id))
  const drawers = shallowRef<readonly CatalogDrawerView[]>(
    ['a', 'b', 'c'].map((id) => ({ id, title: id }) as CatalogDrawerView),
  )
  const suspended = shallowRef(false)
  const rows = drawers.value.map(({ id }) => ({
    dataset: { catalogDropId: id },
    setAttribute: vi.fn(),
    removeAttribute: vi.fn(),
    getBoundingClientRect: () =>
      rect(drawers.value.findIndex((drawer) => drawer.id === id) * 220, 200),
  }))
  const elementListeners = new Map<string, Listener>()
  const element = {
    isConnected: true,
    scrollHeight: 0,
    clientHeight: 0,
    parentElement: null,
    getRootNode: () => ({}),
    getBoundingClientRect: () => rect(),
    querySelectorAll: () => rows,
    setPointerCapture: vi.fn(),
    setAttribute: vi.fn(),
    removeAttribute: vi.fn(),
    hasPointerCapture: () => true,
    releasePointerCapture: vi.fn(),
    addEventListener: (name: string, handler: Listener) => elementListeners.set(name, handler),
    removeEventListener: (name: string) => elementListeners.delete(name),
  }
  const move = vi.fn()
  const scope = effectScope()
  const reorder = scope.run(() =>
    useCatalogDrawerReorder({
      drawers,
      suspended,
      element: element as unknown as HTMLElement,
      move,
    }),
  )!
  const dispatch = (name: string, input: PointerEvent | KeyboardEvent) => {
    for (const handler of listeners.get(name) ?? []) handler(input)
    elementListeners.get(name)?.(input)
  }
  const hold = (id = 'a', x = 60) => {
    reorder.startPress(event(x), id)
    vi.advanceTimersByTime(500)
  }
  const click = () => {
    const input = event() as unknown as MouseEvent
    elementListeners.get('click')?.(input as unknown as PointerEvent)
    return input
  }
  return {
    reorder,
    drawers,
    suspended,
    move,
    event,
    hold,
    click,
    dispatch,
    element,
    rows,
    listeners,
    scope,
    frames,
    frame: () => {
      const callbacks = [...frames.values()]
      frames.clear()
      callbacks.forEach((callback) => callback(16))
    },
  }
}

beforeEach(() => {
  vi.useFakeTimers()
  showFeedback.mockClear()
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('useCatalogDrawerReorder', () => {
  it('keeps short presses available for selection and waits 500ms before capturing the pointer', () => {
    const test = createReorder()
    test.reorder.startPress(test.event(), 'a')
    vi.advanceTimersByTime(499)
    expect(test.reorder.draggedId.value).toBeUndefined()
    expect(test.element.setPointerCapture).not.toHaveBeenCalled()
    expect(showFeedback).not.toHaveBeenCalled()
    test.dispatch('pointerup', test.event())
    expect(test.click().preventDefault).not.toHaveBeenCalled()
    test.reorder.startPress(test.event(), 'a')
    vi.advanceTimersByTime(500)
    expect(test.reorder.draggedId.value).toBe('a')
    expect(test.element.setPointerCapture).toHaveBeenCalledExactlyOnceWith(1)
    expect(showFeedback).toHaveBeenCalledExactlyOnceWith({
      status: 'info',
      icon: 'drag',
      message: QUEUE_DRAG_READY_MESSAGE,
    })
    test.dispatch('pointerup', test.event())
    expect(test.reorder.draggedId.value).toBeUndefined()
    expect(test.move).not.toHaveBeenCalled()
    test.scope.stop()
    expect([...test.listeners.values()].every((handlers) => handlers.size === 0)).toBe(true)
  })

  it('commits only on release after a hold without selecting the card', async () => {
    const test = createReorder()
    test.hold()
    expect(test.reorder.draggedId.value).toBe('a')
    test.dispatch('pointermove', test.event(500))
    test.frame()
    expect(test.reorder.getItemStyle('drawer', 'a')?.transform).toBe('translate3d(440px, 0px, 0)')
    expect(test.reorder.getItemStyle('drawer', 'b')?.transform).toBe('translate3d(-220px, 0px, 0)')
    expect(test.move).not.toHaveBeenCalled()
    test.dispatch('pointerup', test.event(500))
    expect(test.move).toHaveBeenCalledExactlyOnceWith('a', 'c', ['a', 'b', 'c'])
    expect(showFeedback).toHaveBeenCalledOnce()
    const click = test.click()
    expect(click.preventDefault).toHaveBeenCalledOnce()
    expect(click.stopImmediatePropagation).toHaveBeenCalledOnce()
    const nextClick = test.click()
    expect(nextClick.preventDefault).not.toHaveBeenCalled()
    test.scope.stop()
    await nextTick()
    expect(test.frames.size).toBe(0)
  })

  it.each(['move', 'scroll', 'release', 'suspend', 'filter', 'pin', 'keyboard', 'dispose'])(
    'cancels the pending hold on %s without taking over the pointer or next click',
    (reason) => {
      const test = createReorder()
      test.reorder.startPress(test.event(), 'a')
      vi.advanceTimersByTime(200)
      if (reason === 'move') test.dispatch('pointermove', test.event(80))
      else if (reason === 'scroll') test.dispatch('scroll', test.event())
      else if (reason === 'release') test.dispatch('pointerup', test.event())
      else if (reason === 'suspend') test.suspended.value = true
      else if (reason === 'filter') test.drawers.value = test.drawers.value.slice(0, 2)
      else if (reason === 'pin')
        test.drawers.value = test.drawers.value.map((drawer) => ({ ...drawer, isPinned: true }))
      else if (reason === 'keyboard') test.reorder.shift('drawer', 'a', -1)
      else test.scope.stop()
      vi.advanceTimersByTime(500)
      expect(test.reorder.draggedId.value).toBeUndefined()
      expect(test.element.setPointerCapture).not.toHaveBeenCalled()
      expect(test.click().preventDefault).not.toHaveBeenCalled()
      expect(test.move).not.toHaveBeenCalled()
      expect(showFeedback).not.toHaveBeenCalled()
      test.scope.stop()
      expect(vi.getTimerCount()).toBe(0)
    },
  )

  it('keeps dragging when touch capture leaves the card, but cancels when the grid loses it', () => {
    const test = createReorder()
    const press = test.event()
    test.reorder.startPress(press, 'a')
    vi.advanceTimersByTime(500)
    // 卡片的隐式捕获移交网格时，捕获丢失事件会从卡片冒泡到网格。
    test.dispatch('lostpointercapture', press)
    expect(test.reorder.draggedId.value).toBe('a')
    test.dispatch('pointermove', test.event(500))
    test.frame()
    expect(test.reorder.dropTargetId.value).toBe('c')
    test.dispatch('lostpointercapture', {
      ...test.event(),
      target: test.element,
    } as unknown as PointerEvent)
    expect(test.reorder.draggedId.value).toBeUndefined()
    test.dispatch('pointerup', test.event(500))
    expect(test.move).not.toHaveBeenCalled()
    expect(test.element.releasePointerCapture).toHaveBeenCalledOnce()
    test.scope.stop()
    expect([...test.listeners.values()].every((handlers) => handlers.size === 0)).toBe(true)
  })

  it('rejects secondary pointers and suspended cards', () => {
    const test = createReorder()
    test.reorder.startPress({ ...test.event(), button: 2 } as PointerEvent, 'a')
    test.reorder.startPress({ ...test.event(), isPrimary: false } as PointerEvent, 'a')
    test.suspended.value = true
    test.reorder.startPress(test.event(), 'a')
    vi.advanceTimersByTime(500)
    expect(test.element.setPointerCapture).not.toHaveBeenCalled()
    expect(showFeedback).not.toHaveBeenCalled()
    test.suspended.value = false
    test.element.isConnected = false
    test.hold()
    expect(showFeedback).not.toHaveBeenCalled()
    test.element.isConnected = true
    test.reorder.startPress(test.event(), 'a')
    test.reorder.startPress({ ...test.event(), pointerId: 2 } as PointerEvent, 'b')
    vi.advanceTimersByTime(500)
    expect(test.reorder.draggedId.value).toBe('a')
    expect(test.element.setPointerCapture).toHaveBeenCalledOnce()
    test.scope.stop()
  })

  it('preserves the next independent card click after cancelling a drag', () => {
    const test = createReorder()
    test.hold()
    test.reorder.cancel()
    const endpointClick = test.click()
    expect(endpointClick.preventDefault).toHaveBeenCalledOnce()
    test.hold()
    test.reorder.cancel()
    test.dispatch('pointerdown', test.event())
    const nextClick = test.click()
    expect(nextClick.preventDefault).not.toHaveBeenCalled()
    test.scope.stop()
  })

  it.each([
    ['a', 60, 515, ['b', 'c', 'a'], 455],
    ['c', 500, 75, ['c', 'a', 'b'], -425],
  ] as const)(
    'keeps %s visible and elevated through the committed landing',
    async (id, from, to, order, offset) => {
      const test = createReorder()
      const row = test.rows.find((candidate) => candidate.dataset.catalogDropId === id)!
      vi.stubGlobal('getComputedStyle', () => ({
        getPropertyValue: () => '0.4s',
      }))
      test.move.mockImplementation(() => {
        test.drawers.value = order.map((nextId) =>
          test.drawers.value.find((drawer) => drawer.id === nextId)!,
        )
      })
      test.hold(id, from)
      test.dispatch('pointerup', test.event(to))
      expect(test.move).toHaveBeenCalledExactlyOnceWith(id, id === 'a' ? 'c' : 'a', ['a', 'b', 'c'])
      expect(row.setAttribute).toHaveBeenCalledWith('data-am-grid-landing', '')
      expect(test.reorder.getItemStyle('drawer', id)).toEqual({
        transform: `translate3d(${offset}px, 0px, 0)`,
        transition: 'none',
        contentVisibility: 'visible',
      })
      await nextTick()
      expect(test.reorder.isSettling.value).toBe(true)
      expect(test.reorder.getItemStyle('drawer', id)).toEqual({
        transform: 'translate3d(15px, 0px, 0)',
        transition: 'none',
        contentVisibility: 'visible',
      })
      await nextTick()
      test.frame()
      expect(test.reorder.isSettling.value).toBe(false)
      expect(test.reorder.getItemStyle('drawer', id)).toEqual({ contentVisibility: 'visible' })
      expect(row.removeAttribute).not.toHaveBeenCalledWith('data-am-grid-landing')
      vi.advanceTimersByTime(399)
      expect(row.removeAttribute).not.toHaveBeenCalledWith('data-am-grid-landing')
      vi.advanceTimersByTime(1)
      expect(
        row.removeAttribute.mock.calls.filter(([name]) => name === 'data-am-grid-landing'),
      ).toHaveLength(1)
      expect(test.reorder.getItemStyle('drawer', id)).toBeUndefined()
      test.scope.stop()
    },
  )

  it.each(['cancel', 'next drag', 'dispose'] as const)(
    'cleans landing protection on %s',
    async (action) => {
      const test = createReorder()
      test.hold()
      test.dispatch('pointerup', test.event(500))
      await nextTick()
      await nextTick()
      test.frame()
      if (action === 'cancel') test.reorder.cancel()
      else if (action === 'next drag') test.reorder.startDrag(test.event(), 'drawer', 'b')
      else test.scope.stop()
      expect(test.rows[0]!.removeAttribute).toHaveBeenCalledWith('data-am-grid-landing')
      for (const row of test.rows.slice(1)) {
        expect(row.removeAttribute).toHaveBeenCalledWith('data-am-grid-settling')
        expect(test.reorder.getItemStyle('drawer', row.dataset.catalogDropId)).toBeUndefined()
      }
      vi.advanceTimersByTime(1000)
      if (action === 'next drag') expect(test.reorder.draggedId.value).toBe('b')
      test.scope.stop()
      expect(vi.getTimerCount()).toBe(0)
    },
  )

  it('releases landing protection immediately for reduced motion', async () => {
    const test = createReorder()
    Object.assign(window, { matchMedia: () => ({ matches: true }) })
    test.hold()
    test.dispatch('pointerup', test.event(500))
    await nextTick()
    await nextTick()
    test.frame()
    vi.advanceTimersByTime(0)
    expect(test.rows[0]!.removeAttribute).toHaveBeenCalledWith('data-am-grid-landing')
    expect(test.reorder.getItemStyle('drawer', 'a')).toBeUndefined()
    for (const row of test.rows.slice(1)) {
      expect(row.removeAttribute).toHaveBeenCalledWith('data-am-grid-settling')
      expect(test.reorder.getItemStyle('drawer', row.dataset.catalogDropId)).toBeUndefined()
    }
    test.scope.stop()
  })

  it('keeps pointer capture and movement through loading metadata updates', () => {
    const test = createReorder()
    test.reorder.startPress(test.event(), 'a')
    // 工作台为加载/会话状态刷新公开投影；新数组的 ID 和分组与旧数组相同。
    test.drawers.value = test.drawers.value.map((drawer) => ({ ...drawer, loadedPageCount: 2 }))
    vi.advanceTimersByTime(1000)
    expect(test.reorder.draggedId.value).toBe('a')
    expect(test.element.releasePointerCapture).not.toHaveBeenCalled()
    test.dispatch('pointermove', test.event(500))
    test.frame()
    expect(test.reorder.getItemStyle('drawer', 'a')?.transform).toBe('translate3d(440px, 0px, 0)')
    expect(test.reorder.getItemStyle('drawer', 'b')?.transform).toBe('translate3d(-220px, 0px, 0)')
    test.dispatch('pointerup', test.event(500))
    expect(test.move).toHaveBeenCalledExactlyOnceWith('a', 'c', ['a', 'b', 'c'])
    test.scope.stop()
  })

  it('cancels when pin groups change even if the visible IDs stay the same', () => {
    const test = createReorder()
    test.hold()
    test.drawers.value = test.drawers.value.map((drawer) => ({
      ...drawer,
      isPinned: drawer.id === 'a',
    }))
    test.dispatch('pointerup', test.event(500))
    expect(test.reorder.draggedId.value).toBeUndefined()
    expect(test.element.releasePointerCapture).toHaveBeenCalledOnce()
    expect(test.move).not.toHaveBeenCalled()
    test.scope.stop()
  })

  it.each(['pointercancel', 'blur', 'Escape', 'suspend', 'filter', 'dispose'])(
    'cancels %s without committing or leaving pointer capture and timers',
    (reason) => {
      const test = createReorder()
      test.hold()
      test.dispatch('pointermove', test.event(500))
      test.frame()
      if (reason === 'suspend') test.suspended.value = true
      else if (reason === 'filter') test.drawers.value = test.drawers.value.slice(0, 2)
      else if (reason === 'dispose') test.scope.stop()
      else
        test.dispatch(
          reason === 'Escape' ? 'keydown' : reason,
          reason === 'Escape'
            ? ({ key: 'Escape', stopPropagation: vi.fn() } as unknown as KeyboardEvent)
            : test.event(),
        )
      test.dispatch('pointerup', test.event(500))
      expect(test.move).not.toHaveBeenCalled()
      expect(test.reorder.draggedId.value).toBeUndefined()
      expect(test.element.releasePointerCapture).toHaveBeenCalledOnce()
      expect(test.reorder.getItemStyle('drawer', 'b')).toBeUndefined()
      test.scope.stop()
      expect(vi.getTimerCount()).toBe(0)
    },
  )

  it('keeps keyboard movement inside pinned groups and ignores their boundary', () => {
    const test = createReorder()
    test.drawers.value = test.drawers.value.map((drawer) => ({
      ...drawer,
      isPinned: drawer.id !== 'c',
    }))
    test.reorder.shift('drawer', 'a', 1)
    expect(test.move).toHaveBeenCalledExactlyOnceWith('a', 'b', ['a', 'b'])
    test.reorder.shift('drawer', 'b', 1)
    expect(test.move).toHaveBeenCalledTimes(1)
    expect(showFeedback).not.toHaveBeenCalled()
    test.scope.stop()
  })

  it.each([
    ['pinned to regular', 'a', 60, 500],
    ['regular to pinned', 'c', 500, 60],
  ] as const)('warns once per drag from %s and rejects the drop', (_label, id, from, to) => {
    const test = createReorder()
    test.drawers.value = test.drawers.value.map((drawer) => ({
      ...drawer,
      isPinned: drawer.id !== 'c',
    }))
    test.hold(id, from)
    test.dispatch('pointermove', test.event(to))
    test.frame()
    expect(showFeedback).toHaveBeenCalledTimes(2)
    expect(showFeedback).toHaveBeenLastCalledWith({
      status: 'warning',
      message: '置顶列表无法与未置顶列表交换位置，请先取消置顶。',
    })
    expect(test.reorder.dropTargetId.value).toBeUndefined()
    expect(test.reorder.getItemStyle('drawer', 'b')).toBeUndefined()
    test.dispatch('pointermove', test.event(to + 5))
    test.frame()
    test.dispatch('pointerup', test.event(to))
    expect(showFeedback).toHaveBeenCalledTimes(2)
    expect(test.move).not.toHaveBeenCalled()
    expect(test.reorder.draggedId.value).toBeUndefined()
    // 下一次独立拖拽仍能提示，不能被上次的去重状态吞掉。
    test.hold(id, from)
    test.dispatch('pointerup', test.event(to))
    expect(showFeedback).toHaveBeenCalledTimes(4)
    expect(test.move).not.toHaveBeenCalled()
    test.scope.stop()
  })

  it('clears a valid preview over a regular list and can return to pinned-group sorting', () => {
    const test = createReorder()
    test.drawers.value = test.drawers.value.map((drawer) => ({
      ...drawer,
      isPinned: drawer.id !== 'c',
    }))
    test.hold()
    test.dispatch('pointermove', test.event(280))
    test.frame()
    expect(test.reorder.dropTargetId.value).toBe('b')
    test.dispatch('pointermove', test.event(500))
    test.frame()
    expect(test.reorder.dropTargetId.value).toBeUndefined()
    expect(test.reorder.getItemStyle('drawer', 'b')).toBeUndefined()
    expect(test.move).not.toHaveBeenCalled()
    test.dispatch('pointermove', test.event(280))
    test.frame()
    expect(test.reorder.dropTargetId.value).toBe('b')
    test.dispatch('pointerup', test.event(280))
    expect(test.move).toHaveBeenCalledExactlyOnceWith('a', 'b', ['a', 'b', 'c'])
    expect(showFeedback).toHaveBeenCalledTimes(2)
    test.scope.stop()
  })

  it('does not mistake a drop outside the grid for a cross-group attempt', () => {
    const test = createReorder()
    test.drawers.value = test.drawers.value.map((drawer) => ({
      ...drawer,
      isPinned: drawer.id === 'a',
    }))
    test.hold()
    test.dispatch('pointerup', test.event(720))
    expect(showFeedback).toHaveBeenCalledExactlyOnceWith({
      status: 'info',
      icon: 'drag',
      message: QUEUE_DRAG_READY_MESSAGE,
    })
    expect(test.move).not.toHaveBeenCalled()
    test.scope.stop()
  })
})
