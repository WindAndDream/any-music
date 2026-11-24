import { inject, toValue, watch } from 'vue'
import type { InjectionKey, MaybeRefOrGetter, Ref } from 'vue'

import { isFocusUnavailable } from './focus-availability'
import { createGridMoveAnimations } from './grid-move-animations'
import { readVirtualGridCssLayout } from './virtual-scroll/use-virtual-grid-css-layout'
import { observeVirtualElement } from './virtual-scroll/virtual-scroll-resize-observer'

export const collapsingSidebarSideKey: InjectionKey<Readonly<Ref<'left' | 'right' | undefined>>> =
  Symbol('collapsing sidebar side')

interface SidebarCollapseGridMotionOptions {
  element: MaybeRefOrGetter<HTMLElement | null>
  scrollElement?: MaybeRefOrGetter<HTMLElement | null>
  getLayout?: () => { width: number; columns: number; columnGap: number }
}

function measureGridLayout(grid: HTMLElement, viewport: HTMLElement, view: Window) {
  const gridBounds = grid.getBoundingClientRect()
  const viewportBounds = viewport.getBoundingClientRect()
  return {
    ...readVirtualGridCssLayout(view.getComputedStyle(grid)),
    width: gridBounds.width,
    inset: {
      left: gridBounds.left - viewportBounds.left,
      right: gridBounds.right - viewportBounds.right,
    },
  }
}

/** Hold the original column positions through the first wide layout of a sidebar collapse. */
export function useSidebarCollapseGridMotion(options: SidebarCollapseGridMotionOptions) {
  const collapsingSide = inject(collapsingSidebarSideKey, undefined)
  if (!collapsingSide) return
  const animations = createGridMoveAnimations()

  watch(
    [collapsingSide, () => toValue(options.element)],
    ([side, grid], _previous, onCleanup) => {
      if (!side || !grid?.isConnected || isFocusUnavailable(grid)) return
      const view = grid.ownerDocument.defaultView
      if (!view) return
      const viewport =
        toValue(options.scrollElement) ??
        grid.closest<HTMLElement>('[data-am-scroll-key="workspace"]')
      if (!viewport || grid.hasAttribute('data-am-grid-dragging')) return

      const cached = options.getLayout?.()
      const measured = cached ? undefined : measureGridLayout(grid, viewport, view)
      const previous = cached ?? measured
      if (!previous) return
      const { width, columns, columnGap } = previous
      if (width <= 0 || !columns || columnGap === undefined) return
      const stop = observeVirtualElement(grid, ([entry]) => {
        if (!entry || !grid.isConnected || grid.hasAttribute('data-am-grid-dragging')) return
        const after = grid.getBoundingClientRect()
        if (after.width <= width + 0.5) return
        stop?.()
        const style = view.getComputedStyle(grid)
        const layout = readVirtualGridCssLayout(style)
        // A column change already has its own keyed movement animation.
        if (layout?.columns !== columns) return

        const railAtLeft = (side === 'left') !== (style.direction === 'rtl')
        const edge = railAtLeft ? 'left' : 'right'
        const stride = (after.width + layout.columnGap) / columns
        const strideChange = stride - (width + columnGap) / columns
        const trim = Math.max(0, strideChange + columnGap - layout.columnGap)
        const viewportBounds = viewport.getBoundingClientRect()
        const inset = after[edge] - viewportBounds[edge]
        const insetChange = inset - (measured?.inset[edge] ?? inset)
        const cells = grid.children
        // Rows follow DOM order. Find the visible range without walking offscreen cells.
        let start = 0
        let end = cells.length
        while (start < end) {
          const middle = Math.floor((start + end) / 2)
          if (cells[middle]!.getBoundingClientRect().bottom <= viewportBounds.top)
            start = middle + 1
          else end = middle
        }
        const moves: { cell: HTMLElement; x: number }[] = []
        for (let index = start; index < cells.length; index++) {
          const cell = cells[index] as HTMLElement
          const rect = cell.getBoundingClientRect()
          if (rect.top >= viewportBounds.bottom) break
          if (cell.hasAttribute('data-am-grid-moving') || cell.hasAttribute('data-am-grid-landing'))
            return
          // Equal CSS tracks give us the previous start from the column and its old stride.
          const column = Math.round(Math.abs(rect[edge] - after[edge]) / stride)
          const x = column * strideChange * (railAtLeft ? -1 : 1) - insetChange
          if (Math.abs(x) > 0.5 || trim > 0.5) moves.push({ cell, x })
        }
        if (!moves.length) return
        const token = style.getPropertyValue('--am-motion-normal').trim()
        const duration = Number.parseFloat(token) * (token.endsWith('ms') ? 1 : 1000)
        const easing = style.getPropertyValue('--am-ease-emphasized').trim() || 'ease'
        // Clip the extra width until adjacent cards have made room. Translate stays
        // independent of the transform surfaces used by drag and keyed movement.
        for (const { cell } of moves) animations.retain(cell)
        for (const { cell, x } of moves) {
          animations.animate(
            cell,
            cell,
            [
              {
                translate: `${x}px`,
                clipPath: railAtLeft ? `inset(0 ${trim}px 0 0)` : `inset(0 0 0 ${trim}px)`,
              },
              { translate: '0px', clipPath: 'inset(0)' },
            ],
            { duration: Number.isFinite(duration) ? duration : 220, easing },
          )
        }
      })
      onCleanup(() => {
        stop?.()
        animations.cancel()
      })
    },
    { flush: 'sync' },
  )
}
