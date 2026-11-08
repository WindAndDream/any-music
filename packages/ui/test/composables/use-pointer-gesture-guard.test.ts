import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope } from 'vue'

import { usePointerGestureGuard } from '../../src/composables/use-pointer-gesture-guard'

const scopes: ReturnType<typeof effectScope>[] = []
beforeEach(() => {
  vi.stubGlobal('window', new EventTarget())
  vi.stubGlobal('document', Object.assign(new EventTarget(), { visibilityState: 'visible' }))
})
afterEach(() => {
  scopes.splice(0).forEach((scope) => scope.stop())
  vi.unstubAllGlobals()
})

function pointer(type: string, extra: Record<string, unknown> = {}) {
  return Object.assign(new Event(type), {
    pointerId: 1,
    pointerType: 'mouse',
    buttons: 1,
    ...extra,
  }) as PointerEvent
}

function setup() {
  const finish = vi.fn()
  const cancel = vi.fn()
  const scope = effectScope()
  scopes.push(scope)
  const guard = scope.run(() => usePointerGestureGuard({ finish, cancel }))!
  guard.start(pointer('pointerdown'))
  return { guard, finish, cancel, scope }
}

describe('usePointerGestureGuard', () => {
  it('finishes once on a matching global release and ignores other pointers', () => {
    const { finish, cancel } = setup()
    window.dispatchEvent(pointer('pointerup', { pointerId: 2 }))
    window.dispatchEvent(pointer('pointercancel', { pointerId: 2 }))
    window.dispatchEvent(pointer('pointermove', { pointerId: 2, buttons: 0 }))
    expect(finish).not.toHaveBeenCalled()
    expect(cancel).not.toHaveBeenCalled()
    const release = pointer('pointerup', { buttons: 0 })
    window.dispatchEvent(release)
    window.dispatchEvent(release)
    window.dispatchEvent(new Event('blur'))
    expect(finish).toHaveBeenCalledExactlyOnceWith(release)
    expect(cancel).not.toHaveBeenCalled()
  })

  it.each([
    ['pointercancel', {}],
    ['pointermove', { buttons: 0 }],
    ['pointermove', { pointerType: 'pen', buttons: 2 }],
    ['blur', {}],
    ['keydown', { key: 'Escape' }],
  ])('cancels on %s %j without committing a stale release', (type, extra) => {
    const { guard, finish, cancel } = setup()
    window.dispatchEvent(pointer(type, extra))
    window.dispatchEvent(pointer('pointerup'))
    window.dispatchEvent(new Event('blur'))
    expect(cancel).toHaveBeenCalledOnce()
    expect(finish).not.toHaveBeenCalled()
    guard.start(pointer('pointerdown'))
    window.dispatchEvent(pointer('pointerup'))
    expect(finish).toHaveBeenCalledOnce()
  })

  it('keeps held mouse buttons and touch moves active', () => {
    const { cancel, finish } = setup()
    window.dispatchEvent(pointer('pointermove', { buttons: 1 }))
    window.dispatchEvent(pointer('pointermove', { buttons: 3 }))
    window.dispatchEvent(pointer('pointermove', { pointerType: 'touch', buttons: 0 }))
    window.dispatchEvent(Object.assign(new Event('keydown'), { key: 'ArrowDown' }))
    expect(cancel).not.toHaveBeenCalled()
    window.dispatchEvent(pointer('pointerup'))
    expect(finish).toHaveBeenCalledOnce()
  })

  it('cancels when hidden and removes all listeners on stop and disposal', () => {
    const { guard, cancel, finish, scope } = setup()
    document.dispatchEvent(new Event('visibilitychange'))
    expect(cancel).not.toHaveBeenCalled()
    Object.assign(document, { visibilityState: 'hidden' })
    document.dispatchEvent(new Event('visibilitychange'))
    expect(cancel).toHaveBeenCalledOnce()
    guard.start(pointer('pointerdown'))
    guard.stop()
    window.dispatchEvent(pointer('pointerup'))
    guard.start(pointer('pointerdown'))
    scope.stop()
    window.dispatchEvent(pointer('pointerup'))
    window.dispatchEvent(new Event('blur'))
    document.dispatchEvent(new Event('visibilitychange'))
    expect(finish).not.toHaveBeenCalled()
    expect(cancel).toHaveBeenCalledOnce()
  })
})
