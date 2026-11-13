import { computed, shallowRef, toValue, watch } from 'vue'
import type { MaybeRefOrGetter } from 'vue'

// Matches the collection container breakpoint where arrangement tabs fill their row.
const COMPACT_CONTROLS_WIDTH = 760

/** The bottom launcher is teleported, so share the list's measured width with both pickers. */
export function useClassicCompactControls(
  element: MaybeRefOrGetter<HTMLElement | null>,
  mobile: MaybeRefOrGetter<boolean>,
) {
  const width = shallowRef<number>()
  watch(
    () => toValue(element),
    (target, _previous, onCleanup) => {
      width.value = undefined
      if (!target) return
      let active = true
      const measure = (value = target.clientWidth) => {
        if (active && value > 0) width.value = value
      }
      measure()
      if (typeof ResizeObserver !== 'undefined') {
        const observer = new ResizeObserver((entries) => {
          const size = entries.find((entry) => entry.target === target)
          if (size) measure(size.contentRect.width)
        })
        observer.observe(target)
        onCleanup(() => {
          active = false
          observer.disconnect()
        })
      } else if (typeof window !== 'undefined') {
        const resize = () => measure()
        window.addEventListener('resize', resize)
        onCleanup(() => {
          active = false
          window.removeEventListener('resize', resize)
        })
      }
    },
    { immediate: true, flush: 'post' },
  )
  return computed(
    () => toValue(mobile) || (width.value !== undefined && width.value <= COMPACT_CONTROLS_WIDTH),
  )
}
