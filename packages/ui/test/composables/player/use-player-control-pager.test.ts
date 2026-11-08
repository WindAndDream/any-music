import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, shallowRef } from 'vue'

import { usePlayerControlPager } from '../../../src/composables/player/use-player-control-pager'

/** 用指针捕获替身验证手势与清理，不启动产品界面。 */
class PointerCaptureTarget {
  capturedPointerId: number | undefined
  setPointerCapture = vi.fn((pointerId: number) => {
    this.capturedPointerId = pointerId
  })
  hasPointerCapture(pointerId: number): boolean {
    return this.capturedPointerId === pointerId
  }
  releasePointerCapture = vi.fn(() => {
    this.capturedPointerId = undefined
  })
}

const scopes: ReturnType<typeof effectScope>[] = []

beforeEach(() => {
  vi.stubGlobal('HTMLElement', PointerCaptureTarget)
  vi.stubGlobal('window', new EventTarget())
})
afterEach(() => {
  for (const scope of scopes.splice(0)) scope.stop()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

function createPager() {
  const enabled = shallowRef(true)
  const suspended = shallowRef(false)
  const scope = effectScope()
  scopes.push(scope)
  const pager = scope.run(() => usePlayerControlPager({ enabled, suspended }))!
  return { pager, enabled, suspended, scope }
}

function createPointer(x: number, y = 0, overrides: Partial<PointerEvent> = {}): PointerEvent {
  return {
    clientX: x,
    clientY: y,
    pointerId: 1,
    isPrimary: true,
    button: 0,
    pointerType: 'mouse',
    preventDefault: vi.fn(),
    ...overrides,
  } as PointerEvent
}

function createClick(detail = 1): MouseEvent {
  return { detail, preventDefault: vi.fn(), stopPropagation: vi.fn() } as unknown as MouseEvent
}

function createWheel(deltaY: number, overrides: Partial<WheelEvent> = {}): WheelEvent {
  return {
    deltaY,
    deltaX: 0,
    deltaMode: 0,
    ctrlKey: false,
    preventDefault: vi.fn(),
    ...overrides,
  } as unknown as WheelEvent
}

describe('usePlayerControlPager', () => {
  it('cancels a mouse swipe on reentry without buttons and can page again', () => {
    const { pager } = createPager()
    const target = new PointerCaptureTarget() as unknown as HTMLElement
    pager.handlePointerDown(createPointer(0))
    pager.handlePointerMove(createPointer(100, 0, { currentTarget: target }))
    window.dispatchEvent(
      Object.assign(new Event('pointermove'), {
        pointerId: 1,
        pointerType: 'mouse',
        buttons: 0,
      }),
    )
    expect(target.releasePointerCapture).toHaveBeenCalledOnce()
    pager.handlePointerUp(createPointer(100))
    expect(pager.isActionsVisible.value).toBe(false)
    pager.handlePointerDown(createPointer(0))
    pager.handlePointerUp(createPointer(100))
    expect(pager.isActionsVisible.value).toBe(true)
  })
  it('完整播放器暂停交互、释放手势后保留第二页，收起后仍可切换', () => {
    const { pager, suspended } = createPager()
    const target = new PointerCaptureTarget() as unknown as HTMLElement
    pager.showActions()
    pager.handlePointerDown(createPointer(100))
    pager.handlePointerMove(createPointer(30, 0, { currentTarget: target }))
    suspended.value = true
    expect(target.releasePointerCapture).toHaveBeenCalledOnce()
    pager.handlePointerUp(createPointer(0))
    pager.showPlayback()
    expect(pager.isActionsVisible.value).toBe(true)
    suspended.value = false
    expect(pager.isActionsVisible.value).toBe(true)
    pager.showPlayback()
    expect(pager.isActionsVisible.value).toBe(false)
  })
  it('鼠标滚轮与触控板翻页，惯性输入只翻一次且保留缩放与停用状态', () => {
    vi.useFakeTimers()
    const { pager, enabled } = createPager()
    pager.handleWheel(createWheel(12))
    expect(pager.isActionsVisible.value).toBe(false)
    pager.handleWheel(createWheel(24))
    expect(pager.isActionsVisible.value).toBe(true)
    pager.handleWheel(createWheel(-100))
    expect(pager.isActionsVisible.value).toBe(true)
    vi.advanceTimersByTime(301)
    pager.handleWheel(createWheel(0, { deltaX: -100 }))
    expect(pager.isActionsVisible.value).toBe(false)
    const zoom = createWheel(100, { ctrlKey: true })
    pager.handleWheel(zoom)
    expect(zoom.preventDefault).not.toHaveBeenCalled()
    enabled.value = false
    const disabled = createWheel(100)
    pager.handleWheel(disabled)
    expect(disabled.preventDefault).not.toHaveBeenCalled()
    expect(pager.isActionsVisible.value).toBe(false)
  })
  it('点击入口与右滑显示设置，左滑返回播放控制', () => {
    const { pager } = createPager()
    pager.showActions()
    expect(pager.isActionsVisible.value).toBe(true)
    pager.showPlayback()
    expect(pager.isActionsVisible.value).toBe(false)

    pager.handlePointerDown(createPointer(20))
    pager.handlePointerUp(createPointer(100))
    expect(pager.isActionsVisible.value).toBe(true)
    pager.handlePointerDown(createPointer(100))
    pager.handlePointerUp(createPointer(20))
    expect(pager.isActionsVisible.value).toBe(false)
  })

  it('短距离和纵向手势不会切换页面或屏蔽普通点击', () => {
    const { pager } = createPager()
    for (const end of [createPointer(25), createPointer(80, 100)]) {
      pager.handlePointerDown(createPointer(0))
      pager.handlePointerUp(end)
      expect(pager.isActionsVisible.value).toBe(false)
      const click = createClick()
      pager.handleClick(click)
      expect(click.preventDefault).not.toHaveBeenCalled()
    }
  })

  it('水平滑动抑制落点按钮的点击，后续普通点击与键盘操作仍可用', () => {
    const { pager } = createPager()
    pager.handlePointerDown(createPointer(0))
    pager.handlePointerUp(createPointer(80))
    const keyboardClick = createClick(0)
    pager.handleClick(keyboardClick)
    expect(keyboardClick.preventDefault).not.toHaveBeenCalled()
    const swipeClick = createClick()
    pager.handleClick(swipeClick)
    expect(swipeClick.preventDefault).toHaveBeenCalledOnce()
    expect(swipeClick.stopPropagation).toHaveBeenCalledOnce()

    pager.handlePointerDown(createPointer(0))
    pager.handlePointerUp(createPointer(0))
    const click = createClick()
    pager.handleClick(click)
    expect(click.preventDefault).not.toHaveBeenCalled()
  })

  it('确认横向意图后捕获指针，取消滑动时释放且不翻页', () => {
    const { pager } = createPager()
    const target = new PointerCaptureTarget() as unknown as HTMLElement
    pager.handlePointerDown(createPointer(0))
    pager.handlePointerMove(createPointer(2, 20, { currentTarget: target }))
    expect(target.setPointerCapture).not.toHaveBeenCalled()
    pager.handlePointerMove(createPointer(60, 2, { currentTarget: target }))
    // 已确认的纵向手势即使中途拐弯也不能被分页器接管。
    expect(target.setPointerCapture).not.toHaveBeenCalled()
    pager.handlePointerUp(createPointer(60, 2))
    expect(pager.isActionsVisible.value).toBe(false)
    pager.handlePointerDown(createPointer(0))
    pager.handlePointerMove(createPointer(60, 2, { currentTarget: target }))
    expect(target.setPointerCapture).toHaveBeenCalledExactlyOnceWith(1)
    pager.handlePointerCancel(createPointer(60))
    expect(target.releasePointerCapture).toHaveBeenCalledExactlyOnceWith(1)
    pager.handlePointerUp(createPointer(100))
    expect(pager.isActionsVisible.value).toBe(false)
  })

  it('忽略鼠标副键、非主指针和其他指针的释放', () => {
    const { pager } = createPager()
    for (const overrides of [{ button: 2 }, { isPrimary: false }]) {
      pager.handlePointerDown(createPointer(0, 0, overrides))
      pager.handlePointerUp(createPointer(100))
      expect(pager.isActionsVisible.value).toBe(false)
    }
    pager.handlePointerDown(createPointer(0))
    pager.handlePointerDown(createPointer(100, 0, { pointerId: 2 }))
    pager.handlePointerUp(createPointer(100, 0, { pointerId: 2 }))
    expect(pager.isActionsVisible.value).toBe(false)
    pager.handlePointerUp(createPointer(100))
    expect(pager.isActionsVisible.value).toBe(true)
  })

  it('退出迷你布局或卸载时释放捕获，停用状态不会翻页', () => {
    const { pager, enabled, scope } = createPager()
    const target = new PointerCaptureTarget() as unknown as HTMLElement
    pager.showActions()
    pager.handlePointerDown(createPointer(0))
    pager.handlePointerMove(createPointer(60, 0, { currentTarget: target }))
    enabled.value = false
    expect(target.releasePointerCapture).toHaveBeenCalledOnce()
    expect(pager.isActionsVisible.value).toBe(false)
    pager.showActions()
    pager.handlePointerUp(createPointer(100))
    expect(pager.isActionsVisible.value).toBe(false)

    enabled.value = true
    pager.handlePointerDown(createPointer(0))
    pager.handlePointerMove(createPointer(60, 0, { currentTarget: target }))
    scope.stop()
    expect(target.releasePointerCapture).toHaveBeenCalledTimes(2)
  })
})
