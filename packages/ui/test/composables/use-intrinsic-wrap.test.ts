import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick, shallowRef } from 'vue'

import { useIntrinsicWrap } from '../../src/composables/use-intrinsic-wrap'

const observers: { notify(): void; disconnect: ReturnType<typeof vi.fn> }[] = []
const scopes: ReturnType<typeof effectScope>[] = []
const sizeProperty = '--am-intrinsic-wrap-size'

beforeEach(() => {
  observers.length = 0
  vi.stubGlobal(
    'ResizeObserver',
    class {
      disconnect = vi.fn()
      observe = vi.fn()
      constructor(notify: () => void) {
        observers.push({ notify, disconnect: this.disconnect })
      }
    },
  )
})
afterEach(() => {
  scopes.splice(0).forEach((scope) => scope.stop())
  vi.unstubAllGlobals()
})

/** Simulated geometry exercises allocation/lifecycle without opening a product or browser. */
function fixture(width: number, intrinsicWidths: number[], padding = 0) {
  const view = Object.assign(new EventTarget(), {
    getComputedStyle: () => ({
      paddingLeft: `${padding}px`,
      paddingRight: `${padding}px`,
      columnGap: '8px',
    }),
  })
  const fonts = new EventTarget()
  const container = {
    clientWidth: width,
    ownerDocument: { defaultView: view, fonts },
    children: intrinsicWidths.map((intrinsic) => {
      const properties = new Map<string, string>()
      return {
        intrinsic,
        properties,
        style: {
          setProperty: (name: string, value: string) => properties.set(name, value),
          removeProperty: (name: string) => properties.delete(name),
        },
        getBoundingClientRect() {
          return {
            width: properties.has(sizeProperty)
              ? parseFloat(properties.get(sizeProperty)!)
              : Math.min(this.intrinsic, container.clientWidth - padding * 2),
          }
        },
      }
    }),
  }
  const enabled = shallowRef(true)
  const revision = shallowRef(0)
  const element = shallowRef<HTMLElement | null>(container as unknown as HTMLElement)
  const scope = effectScope()
  scopes.push(scope)
  scope.run(() => useIntrinsicWrap({ container: element, enabled, content: revision }))
  return {
    container,
    fonts,
    view,
    enabled,
    revision,
    element,
    scope,
    sizes: () => container.children.map((item) => item.properties.get(sizeProperty)),
  }
}

describe('intrinsic wrapping', () => {
  it('keeps short tags intrinsic and caps an oversized tag at one full row', () => {
    expect(fixture(400, [80, 100]).sizes()).toEqual(['80px', '100px'])
    expect(fixture(400, [900]).sizes()).toEqual(['400px'])
  })

  it('clips the second tag into the remaining quarter and starts the third on a new row', () => {
    // 400px content plus an 8px gap: 300px first tag, 100px clipped second tag.
    expect(fixture(408, [300, 200, 80]).sizes()).toEqual(['300px', '100px', '80px'])
    expect(fixture(440, [300, 200, 80], 16).sizes()).toEqual(['300px', '100px', '80px'])
  })

  it('retains a usable hit target when only a sliver remains, including very narrow containers', () => {
    expect(fixture(400, [360, 120]).sizes()).toEqual(['360px', '120px'])
    expect(fixture(30, [100, 100]).sizes()).toEqual(['30px', '30px'])
  })

  it('remeasures intrinsic widths after resize, font loading and content changes', async () => {
    const test = fixture(408, [300, 200, 80])
    test.container.clientWidth = 600
    observers[0]!.notify()
    expect(test.sizes()).toEqual(['300px', '200px', '80px'])
    test.container.clientWidth = 408
    observers[0]!.notify()
    expect(test.sizes()).toEqual(['300px', '100px', '80px'])
    test.container.children[0]!.intrinsic = 100
    test.fonts.dispatchEvent(new Event('loadingdone'))
    expect(test.sizes()).toEqual(['100px', '200px', '80px'])
    test.container.children[1]!.intrinsic = 500
    test.revision.value++
    await nextTick()
    expect(test.sizes()).toEqual(['100px', '300px', '80px'])
    expect(observers[0]!.disconnect).toHaveBeenCalledOnce()
  })

  it('clears allocations in row mode, ignores stale callbacks and cleans up on removal', async () => {
    const test = fixture(408, [300, 200])
    test.enabled.value = false
    await nextTick()
    expect(test.sizes()).toEqual([undefined, undefined])
    expect(observers[0]!.disconnect).toHaveBeenCalledOnce()
    test.container.clientWidth = 600
    observers[0]!.notify()
    test.fonts.dispatchEvent(new Event('loadingdone'))
    expect(test.sizes()).toEqual([undefined, undefined])
    test.enabled.value = true
    await nextTick()
    expect(test.sizes()).toEqual(['300px', '200px'])
    test.element.value = null
    await nextTick()
    expect(test.sizes()).toEqual([undefined, undefined])
    expect(observers[1]!.disconnect).toHaveBeenCalledOnce()
  })

  it('measures after a hidden container becomes visible and releases the resize fallback', () => {
    vi.stubGlobal('ResizeObserver', undefined)
    const test = fixture(0, [300, 200])
    expect(test.sizes()).toEqual([undefined, undefined])
    test.container.clientWidth = 408
    test.view.dispatchEvent(new Event('resize'))
    expect(test.sizes()).toEqual(['300px', '100px'])
    test.scope.stop()
    test.container.clientWidth = 600
    test.view.dispatchEvent(new Event('resize'))
    expect(test.sizes()).toEqual([undefined, undefined])
  })
})
