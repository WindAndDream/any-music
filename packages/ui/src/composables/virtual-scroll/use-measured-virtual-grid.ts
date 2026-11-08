import { useVirtualizer } from '@tanstack/vue-virtual'
import { computed, shallowRef, toValue, watch } from 'vue'
import type { MaybeRefOrGetter } from 'vue'

import type { FixedVirtualListItem } from './use-fixed-virtual-list'
import type { MeasuredVirtualListOptions } from './use-measured-virtual-list'
import { useVirtualItemMeasurements } from './use-virtual-item-measurements'
import { useVirtualScrollContext } from './use-virtual-scroll-context'
import { createVirtualRetainedRange } from './virtual-retained-range'
import { createVirtualItemIndex, createVirtualRowGeometry } from './virtual-row-geometry'

export interface MeasuredVirtualGridOptions<T> extends MeasuredVirtualListOptions<T> {
  /** Resolved CSS Grid track count, including unused tracks in the final partial row. */
  columns: MaybeRefOrGetter<number>
  columnGap?: MaybeRefOrGetter<number>
  /** Bounded interaction leases at occurrence indexes; retaining a cell retains its logical row. */
  retainedIndexes?: MaybeRefOrGetter<readonly number[]>
}

export interface MeasuredVirtualGridItem<T> extends FixedVirtualListItem<T> {
  rowIndex: number
  columnIndex: number
  /** Logical inline coordinates; consumers use inset-inline-start for RTL support. */
  inlineStart: number
  inlineSize: number
}

function nonnegative(value: number, name: string) {
  if (!Number.isFinite(value) || value < 0) throw new RangeError(`Invalid ${name}`)
  return value
}

function sameRows(
  previous: ReturnType<typeof createVirtualRowGeometry>,
  next: ReturnType<typeof createVirtualRowGeometry>,
) {
  if (previous === next) return true
  if (
    previous.count !== next.count ||
    previous.columns !== next.columns ||
    previous.totalSize !== next.totalSize
  )
    return false
  for (let index = 0; index < next.rowCount; index++) {
    const before = previous.getRow(index)!
    const after = next.getRow(index)!
    if (before.start !== after.start || before.size !== after.size) return false
  }
  return true
}

/**
 * Row-major measured grid. Cells keep one flat keyed parent across responsive regrouping;
 * row heights use natural cell maxima, never masonry lanes or a prescribed card height.
 */
export function useMeasuredVirtualGrid<T>(options: MeasuredVirtualGridOptions<T>) {
  const source = computed(() => toValue(options.items))
  const index = computed(() => createVirtualItemIndex(source.value, options.getItemKey))
  // Ordered identities revise motion/drag geometry independently of measurement validity.
  const groupingRevision = shallowRef(0)
  watch(
    index,
    (next, previous) => {
      if (
        next.keys.length !== previous.keys.length ||
        next.keys.some((key, position) => key !== previous.keys[position])
      )
        groupingRevision.value++
    },
    { flush: 'sync' },
  )
  const count = computed(() => source.value.length)
  const columns = computed(() => {
    const value = toValue(options.columns)
    if (!Number.isSafeInteger(value) || value < 1) throw new RangeError('Invalid column count')
    return value
  })
  const estimatedItemSize = computed(() => {
    const value = nonnegative(toValue(options.estimatedItemSize), 'estimated item size')
    if (!value) throw new RangeError('Invalid estimated item size')
    return value
  })
  const columnGap = computed(() => nonnegative(toValue(options.columnGap) ?? 0, 'column gap'))
  const gap = computed(() => nonnegative(toValue(options.gap) ?? 0, 'row gap'))
  const paddingStart = computed(() =>
    nonnegative(toValue(options.paddingStart) ?? 0, 'start padding'),
  )
  const paddingEnd = computed(() => nonnegative(toValue(options.paddingEnd) ?? 0, 'end padding'))
  const overscan = computed(() => {
    const value = toValue(options.overscan) ?? 2
    if (!Number.isSafeInteger(value) || value < 0) throw new RangeError('Invalid overscan')
    return value
  })
  // Natural units stretch to their row maximum. Only a changed set of row siblings
  // invalidates that measurement; dropping every cached height on a reorder collapses
  // the scroll extent and lets the browser clamp scrollTop before landing can rebase.
  const rowMembership = computed(() => {
    const keys = index.value.keys
    const columnCount = columns.value
    const memberships: string[] = []
    for (let start = 0; start < keys.length; start += columnCount)
      memberships.push(
        JSON.stringify(
          keys
            .slice(start, start + columnCount)
            .map((key) => JSON.stringify(key))
            .toSorted(),
        ),
      )
    return memberships
  })
  const context = useVirtualScrollContext(options)
  const measurements = useVirtualItemMeasurements({
    context,
    layoutGeneration: () =>
      JSON.stringify([toValue(options.layoutGeneration), columns.value, columnGap.value]),
    cacheLimit: options.cacheLimit,
    getContentGeneration: (key) => {
      const position = index.value.indexOf(key)
      if (position === undefined) return undefined
      const content = options.getContentGeneration(source.value[position]!, position)
      // A canonical JSON-array prefix preserves typed membership without serializing
      // potentially large caller content again on every bounded-cache lookup.
      return `${rowMembership.value[Math.floor(position / columns.value)]}|${typeof content}:${content}`
    },
  })
  // Compare bounded row deviations before constructing the complete immutable geometry.
  // Ingress/eviction at the estimate and changes below an existing maximum are not reflows.
  const measuredRows = computed<ReadonlyMap<number, number>>((previous) => {
    const identity = index.value
    const columnCount = columns.value
    const itemCount = count.value
    const estimate = estimatedItemSize.value
    const cells = new Map<number, { count: number; maximum: number }>()
    for (const [key, height] of measurements.heights.value) {
      // Estimate-sized cells cannot raise a row or prove that every cell is smaller.
      // Omit them just like unknown cells; only a fully measured smaller row may shrink.
      if (height === estimate) continue
      const position = identity.indexOf(key)
      if (position === undefined) continue
      const rowIndex = Math.floor(position / columnCount)
      const row = cells.get(rowIndex) ?? { count: 0, maximum: 0 }
      row.count++
      row.maximum = Math.max(row.maximum, height)
      cells.set(rowIndex, row)
    }
    const sizes = new Map<number, number>()
    for (const [rowIndex, row] of cells) {
      const cellCount = Math.min(columnCount, itemCount - rowIndex * columnCount)
      const size = row.count === cellCount ? row.maximum : Math.max(row.maximum, estimate)
      if (size !== estimate) sizes.set(rowIndex, size)
    }
    if (
      previous &&
      previous.size === sizes.size &&
      [...sizes].every(([rowIndex, size]) => previous.get(rowIndex) === size)
    )
      return previous
    return sizes
  })
  const rows = computed<ReturnType<typeof createVirtualRowGeometry>>((previous) => {
    const sizes = measuredRows.value
    const estimate = estimatedItemSize.value
    const next = createVirtualRowGeometry({
      count: count.value,
      columns: columns.value,
      rowGap: gap.value,
      paddingStart: paddingStart.value,
      paddingEnd: paddingEnd.value,
      getRowSize: (rowIndex) => sizes.get(rowIndex) ?? estimate,
    })
    // New mounted cells (and bounded cache eviction) often confirm the existing estimate.
    // Keep semantic geometry stable in that case: measuring a new window is not a reflow.
    // This comparison runs only with a measurement/layout change, never on pointer/scroll.
    if (previous && sameRows(previous, next)) return previous
    return next
  })
  const totalSize = computed(() => rows.value.totalSize)
  const inlineSize = computed(() =>
    Math.max(
      0,
      (context.metrics.value.listWidth - (columns.value - 1) * columnGap.value) / columns.value,
    ),
  )
  /** Opaque spatial revision; equal metadata/cache updates must not invalidate a drag. */
  const layoutRevision = computed(() => {
    void rows.value
    void inlineSize.value
    void columnGap.value
    void groupingRevision.value
    return Object.freeze({})
  })
  // CSS already moves same-row cells continuously while their container width animates.
  // Re-running FLIP for that width alone adds two mounted-box reads and interrupts motion
  // on every resize frame. Keep drag invalidation above width-sensitive, but only hand
  // regrouping and independent natural-height changes to FLIP. Width-driven height
  // changes already follow CSS layout; restarting FLIP for each resize frame stutters.
  interface MotionRevision {
    rows: ReturnType<typeof createVirtualRowGeometry>
    columnGap: number
    grouping: number
  }
  const motionState = computed<
    MotionRevision & {
      reflow: number
      width: number
      layout: readonly number[]
      revision: MotionRevision
    }
  >((previous) => {
    const inlineGap = columnGap.value
    const grouping = groupingRevision.value
    const reflow = measurements.reflowRevision.value
    const width = context.metrics.value.listWidth
    const layout = [gap.value, paddingStart.value, paddingEnd.value, estimatedItemSize.value]
    const layoutChanged =
      !previous || layout.some((value, dimension) => value !== previous.layout[dimension])
    if (
      previous &&
      measurements.isWidthMeasurementPending.value &&
      previous.rows.columns === columns.value &&
      previous.columnGap === inlineGap &&
      previous.grouping === grouping &&
      !layoutChanged
    )
      return previous
    const next = rows.value
    const changed =
      !previous ||
      previous.columnGap !== inlineGap ||
      previous.grouping !== grouping ||
      previous.rows.columns !== next.columns ||
      ((layoutChanged || (previous.reflow !== reflow && previous.width === width)) &&
        !sameRows(previous.rows, next))
    const revision = changed
      ? Object.freeze({ rows: next, columnGap: inlineGap, grouping })
      : previous.revision
    // Keep the comparison baseline current even when ingress/eviction changes row heights.
    // It still revises complete rendering/anchor/drag geometry, but must not read FLIP boxes
    // or animate the old/new window. Only a real mounted reflow (or regrouping) issues a token.
    return { rows: next, columnGap: inlineGap, grouping, reflow, width, layout, revision }
  })
  const motionRevision = computed(() => motionState.value.revision)
  // Capture immutable snapshots: anchor restoration must be able to compare old/new geometry.
  const geometry = computed(() => {
    const rowGeometry = rows.value
    const identity = index.value
    const items = source.value
    const width = inlineSize.value
    const inlineGap = columnGap.value
    function getItem(position: number): MeasuredVirtualGridItem<T> | undefined {
      const cell = rowGeometry.getItemPosition(position)
      if (!cell) return undefined
      const row = rowGeometry.getRow(cell.rowIndex)!
      return {
        key: identity.keys[position]!,
        index: position,
        item: items[position]!,
        start: row.start,
        end: row.end,
        size: row.size,
        ...cell,
        inlineStart: cell.columnIndex * (width + inlineGap),
        inlineSize: width,
      }
    }
    return {
      count: items.length,
      totalSize: rowGeometry.totalSize,
      getItem,
      indexOf: identity.indexOf,
      findItemAtOffset: (offset: number) => {
        const row = rowGeometry.findRowAtOffset(offset)
        return row ? getItem(row.startIndex) : undefined
      },
    }
  })
  const ready = computed(() => context.metrics.value.ready)
  const listOffset = computed(() => context.metrics.value.listOffset)
  const rowOptions = computed(() => {
    const snapshot = rows.value
    return {
      count: snapshot.rowCount,
      getItemKey: (position: number) => position,
      estimateSize: (position: number) => snapshot.getRow(position)!.size,
    }
  })
  const rangeExtractor = computed(() =>
    createVirtualRetainedRange(toValue(options.retainedIndexes) ?? [], count.value, columns.value),
  )
  const virtualizer = useVirtualizer<HTMLElement, HTMLElement>(
    computed(() => ({
      ...rowOptions.value,
      enabled: ready.value && count.value > 0,
      getScrollElement: () => context.scrollElement.value,
      initialOffset: () => context.metrics.value.scrollOffset,
      scrollMargin: listOffset.value,
      gap: gap.value,
      paddingStart: paddingStart.value,
      paddingEnd: paddingEnd.value,
      overscan: overscan.value,
      rangeExtractor: rangeExtractor.value,
      observeElementRect: (_instance, notify) =>
        watch(
          [() => context.metrics.value.viewportWidth, () => context.metrics.value.viewportHeight],
          ([width, height]) => notify({ width, height }),
          { immediate: true, flush: 'sync' },
        ),
      observeElementOffset: (_instance, notify) =>
        watch(
          () => context.metrics.value.scrollOffset,
          (offset) => notify(offset, false),
          { immediate: true, flush: 'sync' },
        ),
      scrollToFn: (offset, { adjustments = 0 }, instance) => {
        const root = instance.scrollElement
        if (
          root &&
          root === context.scrollElement.value &&
          ready.value &&
          root.scrollTop !== offset + adjustments
        )
          root.scrollTop = offset + adjustments
      },
    })),
  )
  // One bounded natural-height authority. Reset the engine's memoized row sizes when any
  // actual geometry changes; scrolling alone does not rebuild rows or rescan all items.
  watch(rows, () => virtualizer.value.measure(), { flush: 'sync' })
  const virtualItems = computed<readonly MeasuredVirtualGridItem<T>[]>(() => {
    void totalSize.value
    if (!ready.value) return []
    return virtualizer.value.getVirtualItems().flatMap((item) => {
      const row = rows.value.getRow(item.index)!
      return Array.from({ length: row.endIndex - row.startIndex }, (_, offset) =>
        geometry.value.getItem(row.startIndex + offset)!,
      )
    })
  })
  const renderLayout = computed(() => {
    const mountedRows = [...new Set(virtualItems.value.map((item) => item.rowIndex))]
    const tracks: string[] = []
    const gridRows = new Map<number, number>()
    let previousEnd = paddingStart.value
    let previousIndex = -1
    for (const rowIndex of mountedRows) {
      const row = rows.value.getRow(rowIndex)!
      if (rowIndex > previousIndex + 1) {
        const start = previousIndex < 0 ? paddingStart.value : previousEnd + gap.value
        tracks.push(`${row.start - gap.value - start}px`)
      }
      tracks.push('auto')
      gridRows.set(rowIndex, tracks.length)
      previousIndex = rowIndex
      previousEnd = row.end
    }
    if (mountedRows.length && previousIndex < rows.value.rowCount - 1)
      tracks.push(`${totalSize.value - paddingEnd.value - previousEnd - gap.value}px`)
    // Empty/hidden windows keep their single spacer extent; no per-logical-row CSS output.
    if (!tracks.length && rows.value.rowCount)
      tracks.push(`${totalSize.value - paddingStart.value - paddingEnd.value}px`)
    return {
      templateRows: tracks.join(' ') || 'none',
      gridRows,
      paddingStart: paddingStart.value,
      paddingEnd: paddingEnd.value,
    }
  })
  return {
    context,
    count,
    columns,
    totalSize,
    virtualItems,
    measurements,
    geometry,
    layoutRevision,
    motionRevision,
    renderLayout,
  }
}
