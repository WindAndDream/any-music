import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, shallowRef } from 'vue'

import { useMobilePlayerSheet } from '../../../src/composables/player/use-mobile-player-sheet'

class GestureTarget {
  captured?: number
  blocked = false
  closest() {
    return this.blocked ? this : null
  }
  setPointerCapture = vi.fn((id: number) => {
    this.captured = id
  })
  hasPointerCapture(id: number) {
    return this.captured === id
  }
  releasePointerCapture = vi.fn(() => {
    this.captured = undefined
  })
}
const scopes: ReturnType<typeof effectScope>[] = []
beforeEach(() => {
  vi.stubGlobal('HTMLElement', GestureTarget)
  vi.stubGlobal('window', new EventTarget())
})
afterEach(() => {
  scopes.splice(0).forEach((scope) => scope.stop())
  vi.unstubAllGlobals()
})
function createSheet(getScrollTop?: () => number) {
  const enabled = shallowRef(true)
  const scope = effectScope()
  scopes.push(scope)
  const sheet = scope.run(() =>
    useMobilePlayerSheet({ enabled, getHeight: () => 600, getScrollTop }),
  )!
  const target = new GestureTarget()
  const pointer = (x: number, y: number, overrides: Partial<PointerEvent> = {}) =>
    ({
      clientX: x,
      clientY: y,
      pointerId: 1,
      isPrimary: true,
      button: 0,
      target,
      preventDefault: vi.fn(),
      ...overrides,
    }) as unknown as PointerEvent
  return { sheet, enabled, scope, target, pointer }
}

describe('useMobilePlayerSheet', () => {
  it.each(['blur', 'pointermove', 'pointercancel'])(
    'releases an interrupted sheet drag on %s without expanding',
    (type) => {
      const { sheet, pointer, target } = createSheet()
      sheet.handlePointerDown(pointer(0, 600))
      sheet.handlePointerMove(pointer(0, 390))
      expect(sheet.isDragging.value).toBe(true)
      window.dispatchEvent(
        Object.assign(new Event(type), { pointerId: 1, pointerType: 'mouse', buttons: 0 }),
      )
      expect(sheet.isDragging.value).toBe(false)
      expect(sheet.offsetPercentage.value).toBe(100)
      expect(target.releasePointerCapture).toHaveBeenCalledOnce()
      sheet.handlePointerEnd(pointer(0, 390))
      expect(sheet.isExpanded.value).toBe(false)
      sheet.handlePointerDown(pointer(0, 600))
      sheet.handlePointerEnd(pointer(0, 390))
      expect(sheet.isExpanded.value).toBe(true)
    },
  )
  it('leaves scrolled content and interactive controls alone before allowing downward dismissal', () => {
    let scrollTop = 20
    const { sheet, pointer, target } = createSheet(() => scrollTop)
    sheet.expand()
    sheet.handlePointerDown(pointer(0, 100))
    sheet.handlePointerEnd(pointer(0, 400))
    expect(sheet.isExpanded.value).toBe(true)
    expect(target.setPointerCapture).not.toHaveBeenCalled()
    scrollTop = 0
    target.blocked = true
    sheet.handlePointerDown(pointer(0, 100))
    sheet.handlePointerEnd(pointer(0, 400))
    expect(sheet.isExpanded.value).toBe(true)
    expect(target.setPointerCapture).not.toHaveBeenCalled()
    target.blocked = false
    sheet.handlePointerDown(pointer(0, 100))
    sheet.handlePointerMove(pointer(0, 300))
    expect(sheet.offsetPercentage.value).toBeCloseTo(100 / 3)
    sheet.handlePointerCancel(pointer(0, 300))
    expect(sheet.isExpanded.value).toBe(true)
    expect(sheet.offsetPercentage.value).toBe(0)
    sheet.handlePointerDown(pointer(0, 100))
    sheet.handlePointerEnd(pointer(0, 300))
    expect(sheet.isExpanded.value).toBe(false)
  })
  it('follows a slow upward drag and lets users reverse before releasing', () => {
    const { sheet, pointer, target } = createSheet()
    sheet.handlePointerDown(pointer(0, 600))
    expect(sheet.isVisible.value).toBe(false)
    sheet.handlePointerMove(pointer(0, 570))
    expect(sheet.isExpanded.value).toBe(false)
    expect(sheet.isVisible.value).toBe(true)
    expect(sheet.offsetPercentage.value).toBeCloseTo(95)
    sheet.handlePointerMove(pointer(0, 390))
    expect(sheet.offsetPercentage.value).toBeCloseTo(65)
    sheet.handlePointerMove(pointer(0, 595))
    sheet.handlePointerEnd(pointer(0, 595))
    expect(sheet.isExpanded.value).toBe(false)
    expect(sheet.isVisible.value).toBe(false)
    expect(target.releasePointerCapture).toHaveBeenCalledOnce()
  })

  it('opens past the threshold, tolerates a small downward drag and closes after a larger drag', () => {
    const { sheet, pointer } = createSheet()
    sheet.handlePointerDown(pointer(0, 600))
    sheet.handlePointerEnd(pointer(0, 440))
    expect(sheet.isExpanded.value).toBe(true)
    sheet.handlePointerDown(pointer(0, 0))
    sheet.handlePointerMove(pointer(0, 70))
    expect(sheet.offsetPercentage.value).toBeCloseTo(70 / 6)
    sheet.handlePointerEnd(pointer(0, 70))
    expect(sheet.isExpanded.value).toBe(true)
    expect(sheet.offsetPercentage.value).toBe(0)
    sheet.handlePointerDown(pointer(0, 0))
    sheet.handlePointerEnd(pointer(0, 170))
    expect(sheet.isExpanded.value).toBe(false)
  })

  it('locks horizontal gestures away from expansion and ignores progress/buttons and extra pointers', () => {
    const { sheet, pointer, target } = createSheet()
    target.blocked = true
    sheet.handlePointerDown(pointer(0, 600))
    sheet.handlePointerEnd(pointer(0, 0))
    expect(target.setPointerCapture).not.toHaveBeenCalled()
    target.blocked = false
    sheet.handlePointerDown(pointer(0, 600, { isPrimary: false }))
    expect(target.setPointerCapture).not.toHaveBeenCalled()
    sheet.handlePointerDown(pointer(0, 600))
    sheet.handlePointerMove(pointer(50, 600))
    sheet.handlePointerEnd(pointer(50, 0))
    expect(sheet.isExpanded.value).toBe(false)
    expect(sheet.isVisible.value).toBe(false)
    const click = {
      detail: 1,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    } as unknown as MouseEvent
    sheet.handleClick(click)
    expect(click.preventDefault).toHaveBeenCalledOnce()
    sheet.handlePointerDown(pointer(0, 600))
    sheet.handlePointerEnd(pointer(0, 0, { pointerId: 2 }))
    expect(sheet.isExpanded.value).toBe(false)
    sheet.handlePointerEnd(pointer(0, 440))
    expect(sheet.isExpanded.value).toBe(true)
  })

  it('cancels previews on interruption, layout changes or unmount and suppresses the generated click', () => {
    const { sheet, pointer, enabled, scope, target } = createSheet()
    const startDrag = () => {
      sheet.handlePointerDown(pointer(0, 600))
      sheet.handlePointerMove(pointer(0, 440))
    }
    startDrag()
    sheet.handlePointerCancel(pointer(0, 440))
    expect(sheet.isVisible.value).toBe(false)
    const click = {
      detail: 1,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    } as unknown as MouseEvent
    sheet.handleClick(click)
    expect(click.preventDefault).toHaveBeenCalledOnce()
    startDrag()
    enabled.value = false
    expect(sheet.isVisible.value).toBe(false)
    enabled.value = true
    sheet.expand()
    expect(sheet.isExpanded.value).toBe(true)
    sheet.collapse()
    startDrag()
    scope.stop()
    expect(sheet.isDragging.value).toBe(false)
    expect(target.releasePointerCapture).toHaveBeenCalledTimes(3)
  })

  it('does not swallow the next button click when a cancelled drag generated no click', () => {
    const { sheet, pointer, target } = createSheet()
    sheet.handlePointerDown(pointer(0, 600))
    sheet.handlePointerMove(pointer(0, 550))
    sheet.handlePointerCancel(pointer(0, 550))
    target.blocked = true
    sheet.handlePointerDown(pointer(0, 600))
    const click = {
      detail: 1,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    } as unknown as MouseEvent
    sheet.handleClick(click)
    expect(click.preventDefault).not.toHaveBeenCalled()
  })
})
