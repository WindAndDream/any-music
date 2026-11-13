import { createBackNavigation } from '@any-music/ui'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope } from 'vue'

import { useAndroidBackNavigation } from '@/platform/use-android-back-navigation'

const native = vi.hoisted(() => ({ listen: vi.fn(), exit: vi.fn(), unregister: vi.fn() }))
vi.mock('@tauri-apps/api/app', () => ({ onBackButtonPress: native.listen, exit: native.exit }))

let press: () => void
let documentTarget: EventTarget & { visibilityState: string }
const scopes: ReturnType<typeof effectScope>[] = []
beforeEach(() => {
  vi.useFakeTimers()
  documentTarget = Object.assign(new EventTarget(), { visibilityState: 'visible' })
  vi.stubGlobal('document', documentTarget)
  native.exit.mockReset().mockResolvedValue(undefined)
  native.unregister.mockReset().mockResolvedValue(undefined)
  native.listen.mockReset().mockImplementation((handler: () => void) => {
    press = handler
    return Promise.resolve({ unregister: native.unregister })
  })
})
afterEach(() => {
  scopes.splice(0).forEach((scope) => scope.stop())
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

function setup(enabled = true) {
  const navigation = createBackNavigation()
  const scope = effectScope()
  scopes.push(scope)
  const notice = scope.run(() => useAndroidBackNavigation(enabled ? navigation : undefined))!
  return { navigation, notice, stop: () => scope.stop() }
}

describe('Android system Back', () => {
  it('shows a top notice first and finishes natively only on a second root Back within two seconds', async () => {
    const { notice } = setup()
    press()
    expect(notice.message.value).toBe('再按一次返回键退出应用')
    expect(native.exit).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1999)
    press()
    expect(native.exit).toHaveBeenCalledExactlyOnceWith(0)
    expect(notice.message.value).toBeUndefined()
  })

  it('expires the confirmation and requires a fresh pair after the deadline', async () => {
    const { notice } = setup()
    press()
    await vi.advanceTimersByTimeAsync(2000)
    expect(notice.message.value).toBeUndefined()
    press()
    expect(native.exit).not.toHaveBeenCalled()
    expect(notice.message.value).toBe('再按一次返回键退出应用')
  })

  it('consumes navigation before exit and resets a pending exit when UI state changes', () => {
    const { navigation, notice } = setup()
    press()
    const back = vi.fn()
    const remove = navigation.register('modal', back)
    expect(notice.message.value).toBeUndefined()
    press()
    expect(back).toHaveBeenCalledOnce()
    expect(native.exit).not.toHaveBeenCalled()
    remove()
    press()
    expect(native.exit).not.toHaveBeenCalled()
    expect(notice.message.value).toBe('再按一次返回键退出应用')
    navigation.invalidate()
    expect(notice.message.value).toBeUndefined()
  })

  it.each(['click', 'visibilitychange'])('resets the pair on %s', (eventName) => {
    const { notice } = setup()
    press()
    documentTarget.dispatchEvent(new Event(eventName))
    expect(notice.message.value).toBeUndefined()
    press()
    expect(native.exit).not.toHaveBeenCalled()
  })

  it('does not reset the confirmation for a cancelled pointer sequence from a Back swipe', () => {
    setup()
    press()
    documentTarget.dispatchEvent(new Event('pointerdown'))
    documentTarget.dispatchEvent(new Event('pointercancel'))
    press()
    expect(native.exit).toHaveBeenCalledOnce()
  })

  it('ignores back while backgrounded and does not register on desktop or iOS', () => {
    setup(false)
    expect(native.listen).not.toHaveBeenCalled()
    const { notice } = setup()
    documentTarget.visibilityState = 'hidden'
    press()
    expect(notice.message.value).toBeUndefined()
    expect(native.exit).not.toHaveBeenCalled()
  })

  it('unregisters even if listener registration completes after disposal', async () => {
    let complete!: (listener: { unregister: typeof native.unregister }) => void
    native.listen.mockImplementation(() => new Promise((resolve) => (complete = resolve)))
    const view = setup()
    view.stop()
    complete({ unregister: native.unregister })
    await Promise.resolve()
    expect(native.unregister).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('blocks concurrent finishes, reports failures, and allows a new confirmation', async () => {
    let reject!: (error: Error) => void
    native.exit.mockImplementationOnce(() => new Promise((_, fail) => (reject = fail)))
    const { notice } = setup()
    press()
    press()
    press()
    expect(native.exit).toHaveBeenCalledOnce()
    reject(new Error('finish failed'))
    await Promise.resolve()
    expect(notice.message.value).toBe('退出失败，请重试')
    press()
    expect(notice.message.value).toBe('再按一次返回键退出应用')
    expect(native.exit).toHaveBeenCalledOnce()
  })

  it('cleans the listener, timer and input subscriptions on disposal', async () => {
    const { navigation, notice, stop } = setup()
    await Promise.resolve()
    press()
    stop()
    press()
    navigation.invalidate()
    expect(native.unregister).toHaveBeenCalledOnce()
    expect(notice.message.value).toBeUndefined()
    expect(native.exit).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })
})
