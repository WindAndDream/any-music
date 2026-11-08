import { onScopeDispose, toValue, watch } from 'vue'
import type { MaybeRefOrGetter } from 'vue'

interface UseAnimatedScrollToTopOptions {
  container: MaybeRefOrGetter<HTMLElement | null>
  /** 回顶后的微小回拉只作用于内容，不能移动宿主网页、导航或播放器。 */
  content: MaybeRefOrGetter<HTMLElement | null>
}

/** 有界回顶动效：慢起步、加速回顶、轻回拉；用户滚动和上下文切换可以立即取消。 */
export function useAnimatedScrollToTop(options: UseAnimatedScrollToTopOptions) {
  let frameId: number | undefined
  let settling: Animation | undefined
  let removeListeners: (() => void) | undefined
  let generation = 0

  function releaseListeners(): void {
    removeListeners?.()
    removeListeners = undefined
  }

  function cancel(): void {
    generation += 1
    if (frameId !== undefined) window.cancelAnimationFrame(frameId)
    frameId = undefined
    if (settling) {
      settling.onfinish = null
      settling.cancel()
      settling = undefined
    }
    releaseListeners()
  }

  function start(): void {
    cancel()
    const container = toValue(options.container)
    if (!container) return
    const initialTop = Math.max(0, container.scrollTop)
    if (initialTop <= 1) {
      container.scrollTo({ top: 0, behavior: 'instant' })
      return
    }
    const motionPreference = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    if (motionPreference?.matches || !window.requestAnimationFrame) {
      container.scrollTo({ top: 0, behavior: 'instant' })
      return
    }

    const currentGeneration = generation
    const startedAtMs = window.performance.now()
    const durationMs = Math.min(560, 340 + Math.sqrt(initialTop) * 4)
    // 回顶按钮位于滚动区外；监听同一个 Shadow Root，键盘操作才能中断由该按钮启动的动画。
    const keyboardTarget = toValue(options.content)?.getRootNode?.() ?? container
    const handleKeydown = (event: Event): void => {
      if (
        ['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(
          (event as KeyboardEvent).key,
        )
      )
        cancel()
    }
    const handleMotionChange = (): void => {
      if (!motionPreference?.matches) return
      cancel()
      container.scrollTo({ top: 0, behavior: 'instant' })
    }
    const interruptions = ['wheel', 'touchstart', 'pointerdown'] as const
    for (const event of interruptions) container.addEventListener(event, cancel, { passive: true })
    keyboardTarget.addEventListener('keydown', handleKeydown)
    motionPreference?.addEventListener('change', handleMotionChange)
    removeListeners = () => {
      for (const event of interruptions) container.removeEventListener(event, cancel)
      keyboardTarget.removeEventListener('keydown', handleKeydown)
      motionPreference?.removeEventListener('change', handleMotionChange)
    }

    const step = (timeMs: number): void => {
      if (currentGeneration !== generation) return
      frameId = undefined
      if (!container.isConnected) {
        cancel()
        return
      }
      const progress = Math.min(1, Math.max(0, (timeMs - startedAtMs) / durationMs))
      // 原生 smooth 无法指定曲线；逐帧即时写入位置，避免两套滚动动画相互追赶。
      container.scrollTo({ top: initialTop * (1 - progress * progress), behavior: 'instant' })
      if (progress < 1) {
        frameId = window.requestAnimationFrame(step)
        return
      }
      const content = toValue(options.content)
      if (content?.animate) {
        // scrollTop 不能小于零，用 4px 内容位移表达抵达后的轻回拉。
        settling = content.animate(
          [
            { transform: 'translateY(0)' },
            { transform: 'translateY(4px)', offset: 0.45 },
            { transform: 'translateY(0)' },
          ],
          { duration: 170, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' },
        )
        settling.onfinish = () => {
          if (currentGeneration !== generation) return
          settling = undefined
          releaseListeners()
        }
      } else releaseListeners()
    }
    frameId = window.requestAnimationFrame(step)
  }

  watch(() => [toValue(options.container), toValue(options.content)], cancel, { flush: 'sync' })
  onScopeDispose(cancel)
  return { start, cancel }
}
