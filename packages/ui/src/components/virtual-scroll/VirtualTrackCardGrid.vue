<script setup lang="ts" generic="T">
import { computed, effectScope, shallowRef, useTemplateRef, watch } from 'vue'
import type { CSSProperties } from 'vue'

import { useMeasuredVirtualGrid } from '../../composables/virtual-scroll/use-measured-virtual-grid'
import type { MeasuredVirtualGridItem } from '../../composables/virtual-scroll/use-measured-virtual-grid'
import { useVirtualGridCssLayout } from '../../composables/virtual-scroll/use-virtual-grid-css-layout'
import { useVirtualGridMoveTransition } from '../../composables/virtual-scroll/use-virtual-grid-move-transition'
import type { VirtualItemGeneration } from '../../composables/virtual-scroll/use-virtual-item-measurements'
import { useVirtualItemRetention } from '../../composables/virtual-scroll/use-virtual-item-retention'
import { useVirtualScrollAnchor } from '../../composables/virtual-scroll/use-virtual-scroll-anchor'
import type { VirtualItemKey } from '../../composables/virtual-scroll/virtual-row-geometry'
import type {
  CatalogTrackDisplayMode,
  MobileTrackColumns,
} from '../music-sources/catalog-track-display-mode'
import VirtualGridCell from './VirtualGridCell.vue'

/** Controlled rendering only; complete data, sessions and the existing scroll root stay outside. */
const props = withDefaults(
  defineProps<{
    items: readonly T[]
    getItemKey: (item: T, index: number) => VirtualItemKey
    getContentGeneration: (item: T, index: number) => VirtualItemGeneration
    estimatedItemSize: number
    scrollElement: HTMLElement | null
    displayMode: CatalogTrackDisplayMode
    mobileColumns: MobileTrackColumns
    /** Collection cards retain their own CSS column widths, gaps and container breakpoint. */
    layout?: 'track' | 'collection'
    layoutGeneration?: VirtualItemGeneration
    overscan?: number
    cacheLimit?: number
    enabled?: boolean
    animate?: boolean
    offsetElements?: readonly Element[]
    retainedIndexes?: readonly number[]
    /** Opt in to bounded focus/composition/navigation/reorder leases on mounted stable cells. */
    interaction?: boolean
    /** Semantic compensation is explicit so intentional navigation/reset remains caller-owned. */
    anchor?: boolean
    anchorResetKey?: unknown
    /** Stable slots own placement/capture; only their inner natural content receives motion. */
    reorder?: {
      attributePrefix: string
      kind: string
      getItemId: (row: MeasuredVirtualGridItem<T>) => string
      getItemStyle: (id: string) => CSSProperties | undefined
    }
  }>(),
  { enabled: true, animate: true },
)
defineSlots<{ default(props: { row: MeasuredVirtualGridItem<T> }): unknown }>()
const itemsElement = useTemplateRef<HTMLElement>('gridElement')
// Width is published by the shared context; no additional resize observer is installed here.
const width = shallowRef(0)
const interactionIndexes = shallowRef<readonly number[]>([])
const css = useVirtualGridCssLayout({
  element: itemsElement,
  width,
  layoutGeneration: () =>
    JSON.stringify([props.layout, props.displayMode, props.mobileColumns, props.layoutGeneration]),
})
const result = useMeasuredVirtualGrid({
  items: () => props.items,
  getItemKey: (item, index) => props.getItemKey(item, index),
  getContentGeneration: (item, index) => props.getContentGeneration(item, index),
  estimatedItemSize: () => props.estimatedItemSize,
  listElement: itemsElement,
  scrollElement: () => props.scrollElement,
  enabled: () => props.enabled ?? true,
  offsetElements: () => props.offsetElements ?? [],
  columns: () => css.layout.value.columns,
  gap: () => css.layout.value.rowGap,
  columnGap: () => css.layout.value.columnGap,
  layoutGeneration: () =>
    JSON.stringify([props.layout, props.displayMode, props.mobileColumns, props.layoutGeneration]),
  overscan: () => props.overscan ?? 2,
  cacheLimit: props.cacheLimit,
  retainedIndexes: () => [...(props.retainedIndexes ?? []), ...interactionIndexes.value],
})
const anchor = useVirtualScrollAnchor({
  context: result.context,
  geometry: result.geometry,
  enabled: () => props.anchor ?? false,
  resetKey: () => props.anchorResetKey,
})
const retention = shallowRef<ReturnType<typeof useVirtualItemRetention>>()
const interactionGeneration = shallowRef(0)
watch(
  [() => result.context.scrollElement.value, () => result.context.metrics.value.ready],
  () => {
    // Retention invalidates registrations with the old context. A synchronous root/visibility
    // change can preserve keyed cells, so those cells must register again after the handoff.
    interactionGeneration.value++
  },
  { flush: 'sync' },
)
watch(
  () => props.interaction ?? false,
  (enabled, _previous, onCleanup) => {
    if (!enabled) return
    // The default rendering-only path owns no additional interaction listeners or leases.
    const scope = effectScope()
    scope.run(() => {
      const interaction = useVirtualItemRetention({
        context: result.context,
        geometry: result.geometry,
        beforeScroll: anchor.cancel,
        suspendReorder: anchor.suspend,
      })
      retention.value = interaction
      watch(
        interaction.retainedIndexes,
        (indexes) => {
          interactionIndexes.value = indexes
        },
        { immediate: true, flush: 'sync' },
      )
    })
    onCleanup(() => {
      scope.stop()
      retention.value = undefined
      interactionIndexes.value = []
    })
  },
  { immediate: true, flush: 'sync' },
)
const motion = useVirtualGridMoveTransition({
  element: itemsElement,
  // Capture before the density/mobile attributes reflow CSS. Resolved column/measurement
  // revisions arrive after that patch and continue any interrupted visual movement.
  revision: computed(() => ({
    geometry: result.motionRevision.value,
    displayMode: props.displayMode,
    mobileColumns: props.mobileColumns,
    layoutGeneration: props.layoutGeneration,
    layout: props.layout,
  })),
  enabled: () => props.animate && result.context.metrics.value.ready,
})
// Kept separate from CSS reading so geometry publishes before layout-dependent natural reads.
watch(
  () => result.context.metrics.value.listWidth,
  (value) => {
    width.value = value
  },
  { immediate: true, flush: 'sync' },
)
function getCellReorder(row: MeasuredVirtualGridItem<T>) {
  const reorder = props.reorder
  if (!reorder) return undefined
  const id = reorder.getItemId(row)
  return {
    attributePrefix: reorder.attributePrefix,
    kind: reorder.kind,
    id,
    style: reorder.getItemStyle(id),
  }
}

defineExpose({ result, element: itemsElement, refreshLayout: css.refresh, retention, anchor })
</script>

<template>
  <div class="list virtual-track-list" :data-grid-layout="layout ?? 'track'">
    <div
      ref="gridElement"
      class="list__items virtual-track-list__items"
      role="list"
      :data-display-mode="displayMode"
      :data-mobile-columns="mobileColumns"
      :data-grid-layout="layout ?? 'track'"
      :style="{
        blockSize: `${result.totalSize.value}px`,
        gridTemplateRows: result.renderLayout.value.templateRows,
      }"
    >
      <VirtualGridCell
        v-for="row in result.virtualItems.value"
        :key="row.key"
        :row="row"
        :grid-row="result.renderLayout.value.gridRows.get(row.rowIndex)!"
        :count="result.count.value"
        :observe="result.measurements.observeItem"
        :register-motion="motion.registerItem"
        :register-interaction="retention?.registerItem"
        :interaction-generation="interactionGeneration"
        :reorder="getCellReorder(row)"
      >
        <template #default><slot :row="row" /></template>
      </VirtualGridCell>
    </div>
  </div>
</template>

<style scoped>
.virtual-track-list {
  container: am-track-list / inline-size;
  min-inline-size: 0;
  min-block-size: 0;
  padding: 0;
}
.virtual-track-list__items {
  position: relative;
  display: grid;
  align-content: start;
  --am-track-card-min-width: 296px;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, var(--am-track-card-min-width)), 1fr));
  grid-auto-columns: 0px;
  gap: var(--am-space-3);
}
.virtual-track-list__items[data-display-mode='comfortable'] {
  --am-track-card-min-width: 420px;
  --am-track-card-artwork-max-height: 240px;
}
.virtual-track-list__items[data-display-mode='compact'] {
  --am-track-card-min-width: 224px;
}
.virtual-track-list[data-grid-layout='collection'] {
  container: none;
}
.virtual-track-list__items[data-grid-layout='collection'] {
  grid-template-columns: repeat(
    auto-fill,
    minmax(min(100%, var(--am-collection-card-width, 320px)), 1fr)
  );
  align-items: stretch;
  gap: var(--am-space-4);
}
/* Mounted cells must expose their actual natural content, including overscan cells. */
.virtual-track-list__items :deep(*) {
  content-visibility: visible;
  contain-intrinsic-block-size: none;
}
/* Keep the visible card's original layout/paint boundary without size containment.
   Removing content-visibility:auto must not change descendant raster alignment. */
@supports (content-visibility: auto) {
  .virtual-track-list .virtual-track-list__items :deep(.track-card) {
    contain: layout style paint;
    contain-intrinsic-block-size: none;
  }
}
@media (max-width: 600px) {
  .virtual-track-list__items[data-grid-layout='track'][data-mobile-columns='1'] {
    grid-template-columns: minmax(0, 1fr);
  }
  .virtual-track-list__items[data-grid-layout='track'][data-mobile-columns='2'] {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--am-space-2);
  }
}
</style>
