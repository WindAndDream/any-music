import { afterEach, describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick, shallowRef } from 'vue'

import { useElementBlockSize } from '../../src/composables/use-element-block-size'

afterEach(() => vi.unstubAllGlobals())

describe('element block size', () => {
  it('tracks the actual player size and releases observers when the host changes or unmounts', async () => {
    const observers: {
      notify: (blockSize: number) => void
      observe: ReturnType<typeof vi.fn>
      disconnect: ReturnType<typeof vi.fn>
    }[] = []
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe = vi.fn()
        disconnect = vi.fn()
        constructor(notify: ResizeObserverCallback) {
          observers.push({
            notify: (blockSize) => {
              const entry: Partial<ResizeObserverEntry> = {
                borderBoxSize: [{ blockSize, inlineSize: 500 }],
              }
              notify([entry as ResizeObserverEntry], this as unknown as ResizeObserver)
            },
            observe: this.observe,
            disconnect: this.disconnect,
          })
        }
      },
    )
    const scope = effectScope()
    const readHeight = vi.fn(() => 68)
    const first = Object.defineProperty({}, 'offsetHeight', { get: readHeight })
    const element = shallowRef<HTMLElement | null>(first as HTMLElement)
    const size = scope.run(() => useElementBlockSize(element))!
    expect(size.value).toBe(68)
    expect(observers[0]!.observe).toHaveBeenCalledWith(first, { box: 'border-box' })
    observers[0]!.notify(68)
    readHeight.mockClear()
    observers[0]!.notify(68)
    expect(readHeight).not.toHaveBeenCalled()
    readHeight.mockReturnValue(92)
    observers[0]!.notify(92)
    expect(size.value).toBe(92)
    expect(readHeight).toHaveBeenCalledOnce()
    element.value = { offsetHeight: 112 } as HTMLElement
    await nextTick()
    expect(observers[0]!.disconnect).toHaveBeenCalledOnce()
    expect(size.value).toBe(112)
    observers[0]!.notify(100)
    expect(size.value).toBe(112)
    scope.stop()
    expect(observers[1]!.disconnect).toHaveBeenCalledOnce()
  })

  it('resets reserved geometry when the player is removed and falls back to a cleaned resize listener', async () => {
    vi.stubGlobal('ResizeObserver', undefined)
    const addEventListener = vi.fn()
    const removeEventListener = vi.fn()
    vi.stubGlobal('window', { addEventListener, removeEventListener })
    const scope = effectScope()
    const element = shallowRef<HTMLElement | null>({ offsetHeight: 68 } as HTMLElement)
    const size = scope.run(() => useElementBlockSize(element))!
    const measure = addEventListener.mock.calls[0]![1]
    element.value = null
    await nextTick()
    expect(size.value).toBe(0)
    expect(removeEventListener).toHaveBeenCalledWith('resize', measure)
    scope.stop()
  })
})
