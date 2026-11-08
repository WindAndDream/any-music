import { toValue, watch } from 'vue'
import type { MaybeRefOrGetter, WatchSource } from 'vue'

/** Measure actual grid rows so density, artwork and card styles share the same scroll boundary. */
export function useReadonlyTrackViewport(options: {
  element: MaybeRefOrGetter<HTMLElement | null>
  rows: MaybeRefOrGetter<number>
  content: WatchSource<unknown>
}): void {
  watch(
    [() => toValue(options.element), () => toValue(options.rows), options.content],
    ([target, rows], _previous, onCleanup) => {
      const view = target?.ownerDocument?.defaultView
      if (!target || !view) return
      const cells = Array.from(target.querySelectorAll<HTMLElement>('[data-readonly-track-cell]'))
      let active = true
      let previousSize = ''
      const measure = (): void => {
        if (!active) return
        const origin = target.getBoundingClientRect().top - target.scrollTop
        let rowTop = -Infinity
        let rowCount = 0
        let bottom = 0
        for (const cell of cells) {
          const rect = cell.getBoundingClientRect()
          if (rect.height <= 0) continue
          // Fractional pixel differences within one grid row must not count as another row.
          if (rect.top > rowTop + 1) {
            if (++rowCount > rows) break
            rowTop = rect.top
          }
          bottom = Math.max(bottom, rect.bottom - origin)
        }
        const size = bottom > 0 ? `${Math.ceil(bottom)}px` : ''
        if (size === previousSize) return
        previousSize = size
        if (size) target.style.setProperty('--am-readonly-track-viewport-size', size)
        else target.style.removeProperty('--am-readonly-track-viewport-size')
      }
      measure()
      const observer =
        typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(measure)
      observer?.observe(target)
      for (const cell of cells) observer?.observe(cell)
      view.addEventListener('resize', measure)
      onCleanup(() => {
        active = false
        observer?.disconnect()
        view.removeEventListener('resize', measure)
        target.style.removeProperty('--am-readonly-track-viewport-size')
      })
    },
    { immediate: true, flush: 'post' },
  )
}
