import { nextTick, toValue, watch } from 'vue'
import type { MaybeRefOrGetter } from 'vue'

/** 发现板块共享壳层滚动区；离开前记录，返回且 DOM 恢复后再还原本次会话的位置。 */
export function useCatalogScrollRestoration(options: {
  active: MaybeRefOrGetter<boolean>
  container: () => HTMLElement | null
}): void {
  let scrollTop = 0
  watch(
    () => toValue(options.active),
    (isActive, _previous, onCleanup) => {
      if (!isActive) {
        scrollTop = options.container()?.scrollTop ?? scrollTop
        return
      }
      let cancelled = false
      onCleanup(() => {
        cancelled = true
      })
      void nextTick(() => {
        if (!cancelled && toValue(options.active))
          options.container()?.scrollTo({ top: scrollTop, behavior: 'instant' })
      })
    },
  )
}
