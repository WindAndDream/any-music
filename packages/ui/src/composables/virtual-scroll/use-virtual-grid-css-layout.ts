import { computed, shallowRef, toValue, watch } from 'vue'
import type { MaybeRefOrGetter } from 'vue'

export interface VirtualGridCssLayout {
  columns: number
  columnGap: number
  rowGap: number
}

function readGap(value: string) {
  if (value === 'normal') return 0
  if (!/^\d+(?:\.\d+)?px$/.test(value)) throw new RangeError('Invalid resolved grid gap')
  return Number.parseFloat(value)
}

/** Read browser-resolved tracks: CSS remains the authority for density and media boundaries. */
export function readVirtualGridCssLayout(
  style: Pick<CSSStyleDeclaration, 'gridTemplateColumns' | 'columnGap' | 'rowGap'> &
    Partial<Pick<CSSStyleDeclaration, 'gridAutoColumns'>>,
): VirtualGridCssLayout | undefined {
  if (!style.gridTemplateColumns.trim() || style.gridTemplateColumns === 'none') return undefined
  const tracks = style.gridTemplateColumns.trim().split(/\s+/)
  if (!tracks.length || !tracks.every((track) => /^\d+(?:\.\d+)?px$/.test(track)))
    throw new RangeError('Virtual grid requires resolved pixel tracks')
  let columns = tracks.length
  // Our positive explicit tracks use auto-fill/minmax. During shrink, old positive cell
  // placements temporarily create trailing implicit columns; resolved CSS includes those
  // too. The controlled surface fixes implicit tracks at exactly 0px so they cannot feed
  // their stale count back into placement (or acquire fractional intrinsic widths).
  if (style.gridAutoColumns === '0px')
    while (columns && Number.parseFloat(tracks[columns - 1]!) === 0) columns--
  if (!columns) return undefined
  return {
    columns,
    columnGap: readGap(style.columnGap),
    rowGap: readGap(style.rowGap),
  }
}

/** One view resize listener covers viewport media changes even when the scroll root stays fixed. */
export function useVirtualGridCssLayout(options: {
  element: MaybeRefOrGetter<HTMLElement | null>
  width: MaybeRefOrGetter<number>
  layoutGeneration?: MaybeRefOrGetter<string | number>
}) {
  const layout = shallowRef<VirtualGridCssLayout>({ columns: 1, columnGap: 0, rowGap: 0 })
  let refresh: (() => void) | undefined
  watch(
    () => toValue(options.element),
    (element, _previous, onCleanup) => {
      refresh = undefined
      if (!element) return
      const view = element.ownerDocument.defaultView
      if (!view) return
      let active = true
      const read = () => {
        if (
          !active ||
          !element.isConnected ||
          toValue(options.element) !== element ||
          toValue(options.width) <= 0
        )
          return
        if (element.getBoundingClientRect().width <= 0) return
        const next = readVirtualGridCssLayout(view.getComputedStyle(element))
        if (!next) return
        const current = layout.value
        if (
          current.columns !== next.columns ||
          current.columnGap !== next.columnGap ||
          current.rowGap !== next.rowGap
        )
          layout.value = next
      }
      refresh = read
      view.addEventListener('resize', read)
      onCleanup(() => {
        active = false
        view.removeEventListener('resize', read)
        refresh = undefined
      })
    },
    { immediate: true, flush: 'post' },
  )
  // Container animation changes width every frame, not the listener's owning element.
  // Keep one subscription and batch width/density reads after the corresponding DOM patch.
  watch(
    [
      () => toValue(options.element),
      () => toValue(options.width),
      () => toValue(options.layoutGeneration),
    ],
    () => refresh?.(),
    { immediate: true, flush: 'post' },
  )
  return { layout: computed(() => layout.value), refresh: () => refresh?.() }
}
