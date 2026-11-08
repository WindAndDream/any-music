import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, shallowRef } from 'vue'

import { useCatalogHeadingCollapse } from '../../../src/composables/music-sources/use-catalog-heading-collapse'

class HandleTarget {
  listeners = new Map<string, EventListener>()
  closest = vi.fn(() => null)
  addEventListener(name: string, listener: EventListener) {
    this.listeners.set(name, listener)
  }
  removeEventListener(name: string) {
    this.listeners.delete(name)
  }
  dispatch(name: string, overrides: Record<string, unknown> = {}) {
    this.listeners.get(name)?.({
      target: this,
      currentTarget: this,
      pointerId: 1,
      clientX: 100,
      clientY: 100,
      isPrimary: true,
      button: 0,
      detail: 1,
      preventDefault: vi.fn(),
      ...overrides,
    } as unknown as Event)
  }
  captured?: number
  setPointerCapture = vi.fn((id: number) => {
    this.captured = id
  })
  hasPointerCapture(id: number) {
    return this.captured === id
  }
  releasePointerCapture = vi.fn(() => {
    this.captured = undefined
  })
  focus = vi.fn()
}

const scopes: ReturnType<typeof effectScope>[] = []
beforeEach(() => {
  vi.stubGlobal('HTMLElement', HandleTarget)
  vi.stubGlobal('window', new EventTarget())
})
afterEach(() => {
  scopes.splice(0).forEach((scope) => scope.stop())
  vi.unstubAllGlobals()
})

function createHandle(initialCollapsed = false, initialDragOnly = false) {
  const collapsed = shallowRef(initialCollapsed)
  const dragOnly = shallowRef(initialDragOnly)
  const updateCollapsed = vi.fn((next: boolean) => {
    collapsed.value = next
  })
  const scope = effectScope()
  scopes.push(scope)
  const handle = scope.run(() =>
    useCatalogHeadingCollapse({ collapsed, dragOnly, updateCollapsed }),
  )!
  const target = new HandleTarget()
  const pointer = (y: number, x = 100, overrides: Partial<PointerEvent> = {}) =>
    ({
      clientX: x,
      clientY: y,
      pointerId: 1,
      isPrimary: true,
      button: 0,
      currentTarget: target,
      preventDefault: vi.fn(),
      ...overrides,
    }) as unknown as PointerEvent
  const click = (detail = 1) =>
    handle.handleClick({ detail, preventDefault: vi.fn() } as unknown as MouseEvent)
  return { handle, collapsed, dragOnly, updateCollapsed, target, pointer, click, scope }
}

describe('useCatalogHeadingCollapse', () => {
  it.each(['blur', 'pointermove', 'pointercancel'])(
    'resets the drag on %s and permits a new gesture',
    (type) => {
      const { handle, target, pointer, updateCollapsed } = createHandle()
      handle.handlePointerDown(pointer(100))
      handle.handlePointerMove(pointer(60))
      expect(handle.isDragging.value).toBe(true)
      window.dispatchEvent(
        Object.assign(new Event(type), { pointerId: 1, pointerType: 'mouse', buttons: 0 }),
      )
      expect(handle.isDragging.value).toBe(false)
      expect(handle.dragOffset.value).toBe(0)
      expect(target.releasePointerCapture).toHaveBeenCalledOnce()
      handle.handlePointerUp(pointer(60))
      expect(updateCollapsed).not.toHaveBeenCalled()
      handle.handlePointerDown(pointer(100))
      handle.handlePointerUp(pointer(60))
      expect(updateCollapsed).toHaveBeenCalledExactlyOnceWith(true)
    },
  )
  it('toggles once on a tap and tolerates small pointer movement', () => {
    const { handle, collapsed, updateCollapsed, pointer, click } = createHandle()
    handle.handlePointerDown(pointer(100))
    handle.handlePointerUp(pointer(96, 103))
    expect(updateCollapsed).not.toHaveBeenCalled()
    click()
    expect(collapsed.value).toBe(true)
    expect(updateCollapsed).toHaveBeenCalledOnce()
    click(0)
    expect(collapsed.value).toBe(false)
  })

  it('ignores all mobile handle clicks, commits only drags, and restores clicking on desktop', () => {
    const { handle, collapsed, dragOnly, updateCollapsed, pointer, click } = createHandle(
      false,
      true,
    )
    handle.handlePointerDown(pointer(100))
    handle.handlePointerUp(pointer(100))
    click()
    click(0)
    expect(updateCollapsed).not.toHaveBeenCalled()
    handle.handlePointerDown(pointer(100))
    handle.handlePointerUp(pointer(60))
    click()
    expect(collapsed.value).toBe(true)
    expect(updateCollapsed).toHaveBeenCalledExactlyOnceWith(true)
    handle.handlePointerDown(pointer(100))
    handle.handlePointerUp(pointer(140))
    click()
    expect(collapsed.value).toBe(false)
    expect(updateCollapsed.mock.calls).toEqual([[true], [false]])
    dragOnly.value = false
    click()
    expect(collapsed.value).toBe(true)
  })

  it('commits upward/downward drags at release and suppresses the subsequent native click', () => {
    const { handle, collapsed, updateCollapsed, pointer, click, target } = createHandle()
    handle.handlePointerDown(pointer(100))
    handle.handlePointerMove(pointer(60))
    expect(handle.isDragging.value).toBe(true)
    expect(collapsed.value).toBe(false)
    expect(updateCollapsed).not.toHaveBeenCalled()
    handle.handlePointerUp(pointer(60))
    expect(collapsed.value).toBe(true)
    click()
    expect(updateCollapsed).toHaveBeenCalledExactlyOnceWith(true)
    expect(handle.isDragging.value).toBe(false)
    expect(handle.dragOffset.value).toBe(0)
    expect(target.releasePointerCapture).toHaveBeenCalledOnce()

    handle.handlePointerDown(pointer(100))
    handle.handlePointerUp(pointer(140))
    click()
    expect(collapsed.value).toBe(false)
    expect(updateCollapsed.mock.calls).toEqual([[true], [false]])
  })

  it('does not toggle for a short drag or after dragging back to the starting position', () => {
    const { handle, collapsed, updateCollapsed, pointer, click } = createHandle()
    handle.handlePointerDown(pointer(100))
    handle.handlePointerUp(pointer(80))
    click()
    handle.handlePointerDown(pointer(100))
    handle.handlePointerMove(pointer(50))
    handle.handlePointerUp(pointer(100))
    click()
    expect(collapsed.value).toBe(false)
    expect(updateCollapsed).not.toHaveBeenCalled()
    // 下一次正常轻触不受先前取消的拖动影响。
    handle.handlePointerDown(pointer(100))
    handle.handlePointerUp(pointer(100))
    click()
    expect(collapsed.value).toBe(true)
  })

  it('locks horizontal intent and rejects diagonal movement instead of treating it as a click', () => {
    const { handle, updateCollapsed, pointer, click } = createHandle()
    handle.handlePointerDown(pointer(100))
    handle.handlePointerMove(pointer(101, 130))
    handle.handlePointerUp(pointer(30, 132))
    click()
    handle.handlePointerDown(pointer(100))
    handle.handlePointerUp(pointer(60, 140))
    click()
    expect(updateCollapsed).not.toHaveBeenCalled()
  })

  it('cancels pointer loss and permits keyboard activation immediately after a cancelled drag', () => {
    const { handle, collapsed, updateCollapsed, pointer, click } = createHandle()
    handle.handlePointerDown(pointer(100))
    handle.handlePointerMove(pointer(50))
    handle.handlePointerCancel(pointer(50))
    handle.handlePointerUp(pointer(50))
    click()
    expect(updateCollapsed).not.toHaveBeenCalled()
    expect(handle.isDragging.value).toBe(false)
    click(0)
    expect(collapsed.value).toBe(true)
    for (const [key, next] of [
      ['ArrowDown', false],
      ['ArrowUp', true],
    ] as const) {
      const event = { key, preventDefault: vi.fn(), stopPropagation: vi.fn() }
      handle.handleKeydown(event as unknown as KeyboardEvent)
      expect(collapsed.value).toBe(next)
      expect(event.preventDefault).toHaveBeenCalledOnce()
    }
  })

  it('ignores secondary buttons and pointers without disrupting an active drag', () => {
    const { handle, collapsed, updateCollapsed, pointer, target } = createHandle()
    handle.handlePointerDown(pointer(100, 100, { isPrimary: false }))
    handle.handlePointerDown(pointer(100, 100, { button: 2 }))
    expect(target.setPointerCapture).not.toHaveBeenCalled()
    handle.handlePointerDown(pointer(100))
    handle.handlePointerUp(pointer(50, 100, { pointerId: 2 }))
    handle.handlePointerCancel(pointer(50, 100, { pointerId: 2 }))
    expect(updateCollapsed).not.toHaveBeenCalled()
    handle.handlePointerUp(pointer(50))
    expect(collapsed.value).toBe(true)
  })

  it('releases capture without committing when controlled state changes or the scope ends', () => {
    const { handle, collapsed, updateCollapsed, pointer, target, scope } = createHandle()
    const drag = () => {
      handle.handlePointerDown(pointer(100))
      handle.handlePointerMove(pointer(50))
    }
    drag()
    collapsed.value = true
    expect(target.captured).toBeUndefined()
    expect(handle.isDragging.value).toBe(false)
    drag()
    scope.stop()
    expect(target.captured).toBeUndefined()
    expect(handle.dragOffset.value).toBe(0)
    handle.handlePointerUp(pointer(50))
    expect(updateCollapsed).not.toHaveBeenCalled()
  })

  it.each([false, true])(
    'lets heading whitespace and text drag without tapping in drag-only mode %s',
    (dragOnly) => {
      const heading = new HandleTarget()
      const collapsed = shallowRef(false)
      const updateCollapsed = vi.fn((value: boolean) => {
        collapsed.value = value
      })
      const scope = effectScope()
      scopes.push(scope)
      scope.run(() =>
        useCatalogHeadingCollapse({
          collapsed,
          dragOnly,
          updateCollapsed,
          gestureTarget: heading as unknown as HTMLElement,
        }),
      )
      heading.dispatch('click')
      expect(updateCollapsed).not.toHaveBeenCalled()
      heading.dispatch('pointerdown')
      heading.dispatch('pointermove', { clientY: 60 })
      heading.dispatch('pointerup', { clientY: 60 })
      heading.dispatch('click')
      expect(collapsed.value).toBe(true)
      heading.dispatch('pointerdown')
      heading.dispatch('pointerup', { clientY: 140 })
      heading.dispatch('click')
      expect(collapsed.value).toBe(false)
      expect(updateCollapsed.mock.calls).toEqual([[true], [false]])
      updateCollapsed.mockClear()
      // 信息区、标题和数量文字都可作为起点；pointer capture 仍归整个顶部栏。
      for (const tag of ['div', 'strong', 'span']) {
        const target = { tag, closest: vi.fn(() => null) }
        const preventDefault = vi.fn()
        heading.dispatch('pointerdown', { target, preventDefault })
        expect(preventDefault).not.toHaveBeenCalled()
        heading.dispatch('pointermove', { clientY: 50 })
        heading.dispatch('pointerup', { clientY: 50 })
        heading.dispatch('click', { target })
        expect(collapsed.value).toBe(true)
        heading.dispatch('pointerdown', { target })
        heading.dispatch('pointerup', { clientY: 140 })
        expect(collapsed.value).toBe(false)
        for (const name of ['selectstart', 'contextmenu']) {
          const preventSelectionDefault = vi.fn()
          heading.dispatch(name, { target, preventDefault: preventSelectionDefault })
          expect(preventSelectionDefault).not.toHaveBeenCalled()
        }
      }
      updateCollapsed.mockClear()
      const button = { closest: vi.fn(() => button) }
      // 按钮及其子元素仍由按钮处理，链接/输入框/可编辑区域也沿用同一控件边界。
      for (const target of [button, { closest: vi.fn(() => button) }]) {
        const preventDefault = vi.fn()
        heading.dispatch('pointerdown', { target, preventDefault })
        heading.dispatch('pointerup', { target, clientY: 50 })
        heading.dispatch('click', { target })
        heading.dispatch('selectstart', { target, preventDefault })
        heading.dispatch('contextmenu', { target, preventDefault })
        expect(preventDefault).not.toHaveBeenCalled()
      }
      expect(updateCollapsed).not.toHaveBeenCalled()
      scope.stop()
      expect(heading.listeners.size).toBe(0)
    },
  )

  it('leaves text selection and copy menus available before vertical movement takes over', () => {
    const heading = new HandleTarget()
    const gestureTarget = shallowRef<HTMLElement | null>(heading as unknown as HTMLElement)
    const scope = effectScope()
    scopes.push(scope)
    const handle = scope.run(() =>
      useCatalogHeadingCollapse({
        collapsed: false,
        dragOnly: true,
        gestureTarget,
        updateCollapsed() {},
      }),
    )!
    const target = { parentElement: { closest: vi.fn(() => null) } }
    const preventDefault = vi.fn()
    heading.dispatch('pointerdown', { target, preventDefault })
    heading.dispatch('selectstart', { target, preventDefault })
    heading.dispatch('contextmenu', { target, preventDefault })
    expect(preventDefault).not.toHaveBeenCalled()
    heading.dispatch('pointermove', { clientX: 102, clientY: 104, preventDefault })
    expect(preventDefault).not.toHaveBeenCalled()
    expect(handle.isDragging.value).toBe(false)
    heading.dispatch('pointermove', { clientY: 60, preventDefault })
    expect(preventDefault).toHaveBeenCalledOnce()
    expect(handle.isDragging.value).toBe(true)
    gestureTarget.value = null
    expect(handle.isDragging.value).toBe(false)
    preventDefault.mockClear()
    heading.dispatch('selectstart', { target, preventDefault })
    heading.dispatch('contextmenu', { target, preventDefault })
    expect(preventDefault).not.toHaveBeenCalled()
    expect(heading.listeners.size).toBe(0)
  })

  it('removes delegated listeners and cancels a mobile drag when the heading or layout changes', () => {
    const heading = new HandleTarget()
    const gestureTarget = shallowRef<HTMLElement | null>(heading as unknown as HTMLElement)
    const updateCollapsed = vi.fn()
    const scope = effectScope()
    scopes.push(scope)
    scope.run(() => useCatalogHeadingCollapse({ collapsed: false, updateCollapsed, gestureTarget }))
    heading.dispatch('pointerdown')
    heading.dispatch('pointermove', { clientY: 50 })
    expect(heading.captured).toBe(1)
    gestureTarget.value = null
    expect(heading.captured).toBeUndefined()
    expect(heading.listeners.size).toBe(0)
    heading.dispatch('pointerup', { clientY: 50 })
    heading.dispatch('click')
    expect(updateCollapsed).not.toHaveBeenCalled()
  })
})
