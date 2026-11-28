import { readonly, shallowRef, toValue, watch } from 'vue'
import type { MaybeRefOrGetter } from 'vue'

/** 测量真实布局高度供底部预留空间使用；只观察内容本身，避免过渡中的容器触发反馈环。 */
export function useElementBlockSize(element: MaybeRefOrGetter<HTMLElement | null>) {
  const blockSize = shallowRef(0)
  watch(
    () => toValue(element),
    (target, _previous, onCleanup) => {
      blockSize.value = 0
      if (!target) return
      let isActive = true
      const measure = (): void => {
        if (isActive) blockSize.value = target.offsetHeight
      }
      measure()
      let disconnect: (() => void) | undefined
      if (typeof ResizeObserver !== 'undefined') {
        let previousBlockSize: number | undefined
        const observer = new ResizeObserver(([entry]) => {
          const size = entry?.borderBoxSize?.[0]?.blockSize
          // A sidebar toggle only changes the player's inline size on most frames.
          if (size === undefined || size !== previousBlockSize) measure()
          previousBlockSize = size
        })
        observer.observe(target, { box: 'border-box' })
        disconnect = () => observer.disconnect()
      } else if (typeof window !== 'undefined') {
        window.addEventListener('resize', measure)
        disconnect = () => window.removeEventListener('resize', measure)
      }
      onCleanup(() => {
        isActive = false
        disconnect?.()
      })
    },
    { immediate: true, flush: 'post' },
  )

  return readonly(blockSize)
}
