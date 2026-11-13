import { afterEach, describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick, shallowRef } from 'vue'

import { useClassicCompactControls } from '../../src/composables/use-classic-compact-controls'

afterEach(() => vi.unstubAllGlobals())

describe('collection display control placement', () => {
  it('moves the picker at the arrangement breakpoint on a desktop and releases size observers', async () => {
    let notify: ResizeObserverCallback | undefined
    const observe = vi.fn(),
      disconnect = vi.fn()
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: ResizeObserverCallback) {
          notify = callback
        }
        observe = observe
        disconnect = disconnect
      },
    )
    const element = { clientWidth: 900 } as HTMLElement
    const target = shallowRef<HTMLElement | null>(element)
    const mobile = shallowRef(false)
    const scope = effectScope()
    const compact = scope.run(() => useClassicCompactControls(target, mobile))!
    await nextTick()
    const resize = (width: number) =>
      notify?.(
        [{ target: element, contentRect: { width } } as unknown as ResizeObserverEntry],
        {} as ResizeObserver,
      )
    expect(compact.value).toBe(false)
    expect(observe).toHaveBeenCalledWith(element)
    resize(760)
    expect(compact.value).toBe(true)
    resize(761)
    expect(compact.value).toBe(false)
    mobile.value = true
    expect(compact.value).toBe(true)
    mobile.value = false
    scope.stop()
    expect(disconnect).toHaveBeenCalledOnce()
    resize(500)
    expect(compact.value).toBe(false)
  })
})
