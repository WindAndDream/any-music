import {
  nextTick,
  onActivated,
  onDeactivated,
  onScopeDispose,
  readonly,
  shallowRef,
  toValue,
  watch,
} from 'vue'
import type { MaybeRefOrGetter } from 'vue'

interface UseQueueViewToolbarOptions {
  marker: MaybeRefOrGetter<HTMLElement | null>
  arrangement: MaybeRefOrGetter<HTMLElement | null>
}

/** CSS 负责吸顶；只在跨过顶部边界时测量分段控件，以一次水平 FLIP 表达移到左侧。 */
export function useQueueViewToolbar(options: UseQueueViewToolbarOptions) {
  const isPinned = shallowRef(false)
  const isActive = shallowRef(true)
  let observer: IntersectionObserver | undefined
  let animation: Animation | undefined
  let generation = 0
  let observerGeneration = 0

  function cancelAnimation(): void {
    animation?.cancel()
    animation = undefined
  }

  async function updatePinned(pinned: boolean): Promise<void> {
    if (pinned === isPinned.value) return
    const element = toValue(options.arrangement)
    const previousLeft = element?.getBoundingClientRect().left
    cancelAnimation()
    isPinned.value = pinned
    const currentGeneration = ++generation
    await nextTick()
    if (
      currentGeneration !== generation ||
      !isActive.value ||
      !element?.isConnected ||
      previousLeft === undefined ||
      !element.animate ||
      window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches
    )
      return
    const offset = previousLeft - element.getBoundingClientRect().left
    if (Math.abs(offset) < 1) return
    const durationToken = getComputedStyle(element).getPropertyValue('--am-motion-normal').trim()
    const duration = Number.parseFloat(durationToken) * (durationToken.endsWith('ms') ? 1 : 1000)
    animation = element.animate(
      [{ transform: `translateX(${offset}px)` }, { transform: 'translateX(0)' }],
      {
        duration: Number.isFinite(duration) ? duration : 220,
        easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
      },
    )
  }

  function release(): void {
    generation += 1
    observerGeneration += 1
    observer?.disconnect()
    observer = undefined
    cancelAnimation()
  }

  watch(
    [() => toValue(options.marker), isActive],
    ([marker, active]) => {
      release()
      if (!marker || !active || typeof IntersectionObserver === 'undefined') return
      const root = marker.closest<HTMLElement>('.music-app-shell__content')
      const currentObserverGeneration = observerGeneration
      observer = new IntersectionObserver(
        ([entry]) => {
          if (!entry || currentObserverGeneration !== observerGeneration) return
          // 未滚入视口的标记不能误判为吸顶；只接受从滚动容器上缘离开的标记。
          void updatePinned(
            !entry.isIntersecting && entry.boundingClientRect.top < (entry.rootBounds?.top ?? 0),
          )
        },
        { root, threshold: 0 },
      )
      observer.observe(marker)
    },
    { immediate: true, flush: 'post' },
  )
  onActivated(() => {
    isActive.value = true
  })
  onDeactivated(() => {
    isActive.value = false
    release()
  })
  onScopeDispose(release)
  return { isPinned: readonly(isPinned) }
}
