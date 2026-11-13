import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick, shallowRef } from 'vue'

import { useReadonlyTrackViewport } from '../../src/composables/use-readonly-track-viewport'

const scopes: ReturnType<typeof effectScope>[] = []
const observers: { notify(): void; disconnect: ReturnType<typeof vi.fn> }[] = []
beforeEach(() => {
  observers.length = 0
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe = vi.fn()
      disconnect = vi.fn()
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

function fixture(positions: [top: number, height: number][], initialRows = 2) {
  const properties = new Map<string, string>()
  const view = new EventTarget()
  const cells = positions.map(([top, height]) => ({
    top,
    height,
    getBoundingClientRect() {
      return {
        top: this.top + 100 - target.scrollTop,
        bottom: this.top + this.height + 100 - target.scrollTop,
        height: this.height,
      }
    },
  }))
  const target = {
    scrollTop: 0,
    ownerDocument: { defaultView: view },
    querySelectorAll: () => cells,
    getBoundingClientRect: () => ({ top: 100 }),
    style: {
      setProperty: (key: string, value: string) => properties.set(key, value),
      removeProperty: (key: string) => properties.delete(key),
    },
  }
  const rows = shallowRef(initialRows)
  const content = shallowRef(0)
  const scope = effectScope()
  scopes.push(scope)
  scope.run(() =>
    useReadonlyTrackViewport({ element: target as unknown as HTMLElement, rows, content }),
  )
  return {
    target,
    cells,
    rows,
    content,
    scope,
    size: () => properties.get('--am-readonly-track-viewport-size'),
  }
}

describe('readonly music viewport', () => {
  it('limits complete grid rows with uneven card heights and includes the gaps', () => {
    const f = fixture([
      [0, 80],
      [0.25, 100],
      [112, 120],
      [112, 90],
      [244, 80],
    ])
    expect(f.size()).toBe('232px')
    // Scrolling does not change the total height admitted by the row limit.
    f.target.scrollTop = 90
    observers[0]!.notify()
    expect(f.size()).toBe('232px')
  })

  it('allows three phone rows and recalculates after filtering, reflow and artwork changes', async () => {
    const f = fixture([
      [0, 80],
      [92, 80],
      [184, 80],
      [276, 80],
    ])
    expect(f.size()).toBe('172px')
    f.rows.value = 3
    await nextTick()
    expect(f.size()).toBe('264px')
    f.cells[2]!.height = 100
    observers.at(-1)!.notify()
    expect(f.size()).toBe('284px')
    f.cells.splice(1)
    f.content.value++
    await nextTick()
    expect(f.size()).toBe('80px')
    f.cells.length = 0
    f.content.value++
    await nextTick()
    expect(f.size()).toBeUndefined()
  })

  it('disconnects observers and ignores queued size callbacks after disposal', () => {
    const f = fixture([
      [0, 80],
      [92, 80],
      [184, 80],
    ])
    f.scope.stop()
    expect(observers[0]!.disconnect).toHaveBeenCalledOnce()
    observers[0]!.notify()
    expect(f.size()).toBeUndefined()
  })
})
