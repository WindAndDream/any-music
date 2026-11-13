import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope } from 'vue'

import { useLongPressDrag } from '../../src/composables/use-long-press-drag'

/** 原生 EventTarget 验证计时、取消与点击保护，不模拟浏览器布局或触屏滚动。 */
function setup() {
  const element = Object.assign(new EventTarget(), {
    isConnected: true,
    closest: vi.fn(() => null as object | null),
    focus: vi.fn(),
  })
  const target = new EventTarget()
  const startDrag = vi.fn()
  const cancelDrag = vi.fn()
  const scope = effectScope()
  const drag = scope.run(() =>
    useLongPressDrag({ target: target as unknown as HTMLElement, startDrag, cancelDrag }),
  )!
  element.addEventListener('pointerdown', (event) => drag.start(event as PointerEvent, 'one'))
  function press(extra: Record<string, unknown> = {}) {
    element.dispatchEvent(pointer('pointerdown', extra))
  }
  function input(type: string, extra: Record<string, unknown> = {}) {
    window.dispatchEvent(pointer(type, extra))
  }
  function click(detail = 1) {
    const event = Object.assign(new Event('click', { cancelable: true }), { detail })
    target.dispatchEvent(event)
    return event
  }
  function touchMove() {
    const event = Object.assign(new Event('touchmove', { cancelable: true }), { touches: [{}] })
    element.dispatchEvent(event)
    return event
  }
  return { scope, drag, element, startDrag, cancelDrag, press, input, click, touchMove }
}

function pointer(type: string, extra: Record<string, unknown> = {}) {
  return Object.assign(new Event(type, { cancelable: true }), {
    button: 0,
    pointerId: 1,
    isPrimary: true,
    clientX: 100,
    clientY: 100,
    ...extra,
  })
}

describe('useLongPressDrag', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal('window', new EventTarget())
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('keeps short presses available for selection and starts sorting only after a hold', () => {
    const test = setup()
    test.press()
    vi.advanceTimersByTime(499)
    expect(test.startDrag).not.toHaveBeenCalled()
    expect(test.touchMove().defaultPrevented).toBe(false)
    vi.advanceTimersByTime(1)
    expect(test.startDrag).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ pointerId: 1, clientX: 100, clientY: 100 }),
      'one',
    )
    expect(test.element.focus).toHaveBeenCalledWith({ preventScroll: true })
    expect(test.touchMove().defaultPrevented).toBe(true)
    test.input('pointerup')
    expect(test.cancelDrag).not.toHaveBeenCalled()
    expect(test.click(0).defaultPrevented).toBe(false)
    expect(test.click().defaultPrevented).toBe(true)
    expect(test.click().defaultPrevented).toBe(false)
    test.scope.stop()
  })

  it.each([
    ['pointerup', {}],
    ['pointercancel', {}],
    ['pointermove', { clientY: 112 }],
    ['pointermove', { pointerType: 'mouse', buttons: 0 }],
    ['pointerdown', { pointerId: 2, isPrimary: false }],
    ['keydown', { key: 'Escape' }],
    ['scroll', {}],
    ['blur', {}],
    ['resize', {}],
  ])('cancels a pending hold on %s without blocking selection or scrolling', (type, extra) => {
    const test = setup()
    test.press()
    vi.advanceTimersByTime(200)
    test.input(type, extra)
    vi.advanceTimersByTime(500)
    expect(test.startDrag).not.toHaveBeenCalled()
    expect(test.click().defaultPrevented).toBe(false)
    expect(test.touchMove().defaultPrevented).toBe(false)
    test.scope.stop()
  })

  it('ignores other pointer releases and tolerates small movement while waiting', () => {
    const test = setup()
    test.press()
    test.input('pointerup', { pointerId: 2 })
    test.input('pointermove', { clientX: 103, clientY: 103 })
    vi.advanceTimersByTime(500)
    expect(test.startDrag).toHaveBeenCalledOnce()
    test.scope.stop()
  })

  it.each([{ button: 2 }, { isPrimary: false }])('ignores nonprimary presses: %j', (extra) => {
    const test = setup()
    test.press(extra)
    vi.advanceTimersByTime(500)
    expect(test.startDrag).not.toHaveBeenCalled()
    test.scope.stop()
  })

  it('cancels sorting on Escape and permits the next independent click immediately', () => {
    const test = setup()
    test.press()
    vi.advanceTimersByTime(500)
    test.input('keydown', { key: 'Escape' })
    expect(test.cancelDrag).toHaveBeenCalledOnce()
    test.input('pointerdown')
    expect(test.click().defaultPrevented).toBe(false)
    test.scope.stop()
  })

  it('does not cancel an activated drag when the grid automatically scrolls', () => {
    const test = setup()
    test.press()
    vi.advanceTimersByTime(500)
    test.input('scroll')
    expect(test.cancelDrag).not.toHaveBeenCalled()
    expect(test.touchMove().defaultPrevented).toBe(true)
    test.scope.stop()
  })

  it('cancels an activated hold on buttonless reentry and permits the next press', () => {
    const test = setup()
    test.press()
    vi.advanceTimersByTime(500)
    test.input('pointermove', { pointerType: 'mouse', buttons: 0 })
    expect(test.cancelDrag).toHaveBeenCalledOnce()
    expect(test.touchMove().defaultPrevented).toBe(false)
    test.press()
    vi.advanceTimersByTime(500)
    expect(test.startDrag).toHaveBeenCalledTimes(2)
    test.scope.stop()
  })

  it('rejects an inert or detached cover and clears pending work on disposal', () => {
    const test = setup()
    test.press()
    test.element.closest.mockReturnValue({})
    vi.advanceTimersByTime(500)
    expect(test.startDrag).not.toHaveBeenCalled()
    test.element.closest.mockReturnValue(null)
    test.press()
    test.element.isConnected = false
    vi.advanceTimersByTime(500)
    expect(test.startDrag).not.toHaveBeenCalled()
    test.element.isConnected = true
    test.press()
    test.scope.stop()
    vi.advanceTimersByTime(1000)
    expect(test.startDrag).not.toHaveBeenCalled()
    expect(test.touchMove().defaultPrevented).toBe(false)
  })
})
