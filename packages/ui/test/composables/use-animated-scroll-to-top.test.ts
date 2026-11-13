import { afterEach, describe, expect, it, vi } from 'vitest'
import { effectScope, shallowRef } from 'vue'

import { useAnimatedScrollToTop } from '../../src/composables/use-animated-scroll-to-top'

class ScrollContainer extends EventTarget {
  scrollTop = 1000
  isConnected = true
  scrollTo = vi.fn((options: ScrollToOptions) => {
    this.scrollTop = options.top ?? this.scrollTop
  })
}

class MotionPreference extends EventTarget {
  matches = false
}

/** 用帧时钟与事件目标测试真实滚动意图、取消和作用域清理，不启动产品界面。 */
function createMotion(reducedMotion = false) {
  let timeMs = 0
  let nextFrameId = 0
  const frames = new Map<number, FrameRequestCallback>()
  const preference = new MotionPreference()
  preference.matches = reducedMotion
  const animation = { cancel: vi.fn(), onfinish: null as (() => void) | null }
  const keyboardTarget = new EventTarget()
  const content = { animate: vi.fn(() => animation), getRootNode: () => keyboardTarget }
  const container = new ScrollContainer()
  const containerRef = shallowRef<HTMLElement | null>(container as unknown as HTMLElement)
  vi.stubGlobal('window', {
    matchMedia: () => preference,
    performance: { now: () => timeMs },
    requestAnimationFrame: (callback: FrameRequestCallback) => {
      const id = ++nextFrameId
      frames.set(id, callback)
      return id
    },
    cancelAnimationFrame: (id: number) => {
      frames.delete(id)
    },
  })
  const scope = effectScope()
  const motion = scope.run(() =>
    useAnimatedScrollToTop({
      container: containerRef,
      content: content as unknown as HTMLElement,
    }),
  )!
  const frame = (nextTimeMs: number): void => {
    timeMs = nextTimeMs
    const callbacks = [...frames.values()]
    frames.clear()
    for (const callback of callbacks) callback(timeMs)
  }
  return {
    ...motion,
    container,
    containerRef,
    content,
    animation,
    preference,
    keyboardTarget,
    frames,
    frame,
    stop: () => scope.stop(),
  }
}

afterEach(() => vi.unstubAllGlobals())

describe('useAnimatedScrollToTop', () => {
  it('starts slowly, accelerates to zero, then settles only the content without negative scroll positions', () => {
    const motion = createMotion()
    motion.start()
    expect(motion.container.scrollTop).toBe(1000)
    motion.frame(100)
    const firstDistance = 1000 - motion.container.scrollTop
    motion.frame(200)
    const secondDistance = 1000 - firstDistance - motion.container.scrollTop
    expect(firstDistance).toBeGreaterThan(0)
    expect(secondDistance).toBeGreaterThan(firstDistance)
    motion.frame(1000)
    expect(motion.container.scrollTop).toBe(0)
    expect(motion.frames.size).toBe(0)
    expect(
      motion.container.scrollTo.mock.calls.every(
        ([options]) => options.top! >= 0 && options.behavior === 'instant',
      ),
    ).toBe(true)
    expect(motion.content.animate).toHaveBeenCalledOnce()
    const [keyframes] = motion.content.animate.mock.calls[0]! as unknown as [Keyframe[]]
    expect(keyframes[0]!.transform).toBe('translateY(0)')
    expect(keyframes[1]!.transform).toBe('translateY(4px)')
    expect(keyframes[2]!.transform).toBe('translateY(0)')
    motion.animation.onfinish?.()
    motion.stop()
    expect(motion.animation.cancel).not.toHaveBeenCalled()
  })

  it.each(['wheel', 'touchstart', 'pointerdown'])(
    'lets %s stop the animation at the current position',
    (event) => {
      const motion = createMotion()
      motion.start()
      motion.frame(100)
      const position = motion.container.scrollTop
      motion.container.dispatchEvent(new Event(event))
      motion.frame(1000)
      expect(motion.container.scrollTop).toBe(position)
      expect(motion.frames.size).toBe(0)
      expect(motion.content.animate).not.toHaveBeenCalled()
      motion.stop()
    },
  )

  it('lets keyboard scrolling interrupt and a new click replace the old animation', () => {
    const motion = createMotion()
    motion.start()
    motion.frame(100)
    motion.start()
    expect(motion.frames.size).toBe(1)
    motion.keyboardTarget.dispatchEvent(Object.assign(new Event('keydown'), { key: 'PageDown' }))
    expect(motion.frames.size).toBe(0)
    motion.start()
    motion.frame(1000)
    expect(motion.container.scrollTop).toBe(0)
    motion.stop()
    expect(motion.animation.cancel).toHaveBeenCalledOnce()
  })

  it.each(['scope', 'container', 'detached'] as const)(
    'stops writes when the %s disappears',
    (reason) => {
      const motion = createMotion()
      motion.start()
      motion.frame(100)
      const position = motion.container.scrollTop
      if (reason === 'scope') motion.stop()
      else if (reason === 'container') motion.containerRef.value = null
      else motion.container.isConnected = false
      motion.frame(1000)
      expect(motion.container.scrollTop).toBe(position)
      expect(motion.content.animate).not.toHaveBeenCalled()
      expect(motion.frames.size).toBe(0)
      motion.stop()
    },
  )

  it('jumps directly with reduced motion, including a preference change during scrolling', () => {
    const motion = createMotion(true)
    motion.start()
    expect(motion.container.scrollTop).toBe(0)
    expect(motion.frames.size).toBe(0)
    expect(motion.content.animate).not.toHaveBeenCalled()
    motion.preference.matches = false
    motion.container.scrollTop = 1000
    motion.start()
    motion.frame(100)
    motion.preference.matches = true
    motion.preference.dispatchEvent(new Event('change'))
    motion.frame(1000)
    expect(motion.container.scrollTop).toBe(0)
    expect(motion.frames.size).toBe(0)
    expect(motion.content.animate).not.toHaveBeenCalled()
    motion.stop()
  })
})
