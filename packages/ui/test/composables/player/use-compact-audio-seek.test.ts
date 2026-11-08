import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, shallowRef } from 'vue'

import { useCompactAudioSeek } from '../../../src/composables/player/use-compact-audio-seek'

class SeekTarget {
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
  getBoundingClientRect() {
    return { left: 20, width: 200 }
  }
  focus() {}
}
const scopes: ReturnType<typeof effectScope>[] = []
beforeEach(() => vi.stubGlobal('HTMLElement', SeekTarget))
afterEach(() => {
  scopes.splice(0).forEach((scope) => scope.stop())
  vi.unstubAllGlobals()
})
function createSeek() {
  const disabled = shallowRef(false)
  const durationMs = shallowRef<number | undefined>(100_000)
  const positionMs = shallowRef(10_000)
  const seek = vi.fn()
  const scope = effectScope()
  scopes.push(scope)
  const control = scope.run(() => useCompactAudioSeek({ disabled, durationMs, positionMs, seek }))!
  const target = new SeekTarget()
  const pointer = (x: number, y = 0, overrides: Partial<PointerEvent> = {}) =>
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
  return { control, seek, target, pointer, disabled, durationMs, scope }
}

describe('useCompactAudioSeek', () => {
  it('previews a horizontal drag, clamps both ends and commits one seek only at release', () => {
    const { control, seek, pointer, target } = createSeek()
    control.handlePointerDown(pointer(20))
    control.handlePointerMove(pointer(120))
    expect(control.positionMs.value).toBe(50_000)
    expect(seek).not.toHaveBeenCalled()
    control.handlePointerMove(pointer(300))
    expect(control.positionMs.value).toBe(100_000)
    control.handlePointerMove(pointer(-40))
    expect(control.positionMs.value).toBe(0)
    control.handlePointerUp(pointer(170))
    expect(seek).toHaveBeenCalledExactlyOnceWith(75_000)
    expect(target.releasePointerCapture).toHaveBeenCalledOnce()
    expect(control.positionMs.value).toBe(10_000)
  })

  it('locks vertical movement away from seeking and rejects diagonal movement or cancellation', () => {
    const { control, seek, pointer } = createSeek()
    control.handlePointerDown(pointer(20))
    control.handlePointerMove(pointer(21, -20))
    control.handlePointerUp(pointer(180, -25))
    expect(seek).not.toHaveBeenCalled()
    control.handlePointerDown(pointer(20))
    control.handlePointerUp(pointer(80, -60))
    expect(seek).not.toHaveBeenCalled()
    control.handlePointerDown(pointer(20))
    control.handlePointerMove(pointer(180))
    control.handlePointerCancel(pointer(180))
    expect(control.isSeeking.value).toBe(false)
    expect(seek).not.toHaveBeenCalled()
  })

  it('supports taps and keyboard alternatives, while invalid or disabled media cannot seek', () => {
    const { control, seek, pointer, disabled, durationMs } = createSeek()
    control.handlePointerDown(pointer(120))
    control.handlePointerUp(pointer(120))
    expect(seek).toHaveBeenLastCalledWith(50_000)
    for (const [key, expected] of [
      ['ArrowRight', 15_000],
      ['Home', 0],
      ['End', 100_000],
    ] as const) {
      control.handleKeydown({ key, preventDefault() {}, stopPropagation() {} } as KeyboardEvent)
      expect(seek).toHaveBeenLastCalledWith(expected)
    }
    seek.mockClear()
    disabled.value = true
    control.handlePointerDown(pointer(120))
    control.handlePointerUp(pointer(120))
    control.handleKeydown({ key: 'End' } as KeyboardEvent)
    disabled.value = false
    durationMs.value = undefined
    control.handlePointerDown(pointer(120))
    control.handlePointerUp(pointer(120))
    expect(seek).not.toHaveBeenCalled()
  })

  it('releases captures and discards draft seeks when media becomes disabled or scope is disposed', () => {
    const { control, seek, pointer, disabled, scope, target } = createSeek()
    const drag = () => {
      control.handlePointerDown(pointer(20))
      control.handlePointerMove(pointer(120))
    }
    drag()
    disabled.value = true
    expect(control.isSeeking.value).toBe(false)
    disabled.value = false
    drag()
    scope.stop()
    expect(target.releasePointerCapture).toHaveBeenCalledTimes(2)
    expect(seek).not.toHaveBeenCalled()
  })
})
