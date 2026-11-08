import { toValue, watch } from 'vue'
import type { MaybeRefOrGetter, WatchSource } from 'vue'

interface IntrinsicWrapOptions {
  container: MaybeRefOrGetter<HTMLElement | null>
  enabled: MaybeRefOrGetter<boolean>
  content: WatchSource<unknown>
}

/**
 * Keep intrinsic item widths, clipping the last item into the remaining space of each flex row.
 * Children use border-box, non-growing flex items with
 * inline-size: var(--am-intrinsic-wrap-size, max-content).
 */
export function useIntrinsicWrap(options: IntrinsicWrapOptions): void {
  watch(
    [() => toValue(options.container), () => toValue(options.enabled), options.content],
    ([target, enabled], _previous, onCleanup) => {
      const view = target?.ownerDocument?.defaultView
      if (!target || !enabled || !view) return
      let active = true
      let measuredWidth = 0
      let items: HTMLElement[] = []
      const clearSizes = (): void => {
        for (const item of items) item.style.removeProperty('--am-intrinsic-wrap-size')
      }
      const measure = (): void => {
        if (!active) return
        measuredWidth = target.clientWidth
        const style = view.getComputedStyle(target)
        const width =
          measuredWidth -
          (parseFloat(style.paddingLeft) || 0) -
          (parseFloat(style.paddingRight) || 0)
        if (width <= 0) return
        const gap = parseFloat(style.columnGap) || 0
        items = Array.from(target.children) as HTMLElement[]
        // Clear all allocations before reading, so a previously clipped label can grow again.
        // Batch reads separately from writes; observing only width avoids height feedback loops.
        clearSizes()
        const widths = items.map((item) => item.getBoundingClientRect().width)
        let remaining = width
        for (const [index, intrinsic] of widths.entries()) {
          // A sliver too small for a control starts the next row instead of becoming unclickable.
          if (remaining < Math.min(intrinsic, 44)) remaining = width
          const size = Math.min(intrinsic, remaining)
          items[index]!.style.setProperty('--am-intrinsic-wrap-size', `${size}px`)
          remaining -= size + gap
        }
      }
      measure()
      let observer: ResizeObserver | undefined
      if (typeof ResizeObserver !== 'undefined') {
        observer = new ResizeObserver(() => {
          if (target.clientWidth !== measuredWidth) measure()
        })
        observer.observe(target)
      } else {
        view.addEventListener('resize', measure)
      }
      const fonts = target.ownerDocument.fonts
      fonts?.addEventListener('loadingdone', measure)
      onCleanup(() => {
        active = false
        observer?.disconnect()
        view.removeEventListener('resize', measure)
        fonts?.removeEventListener('loadingdone', measure)
        clearSizes()
      })
    },
    { immediate: true, flush: 'post' },
  )
}
