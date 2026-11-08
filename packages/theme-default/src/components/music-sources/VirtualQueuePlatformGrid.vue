<script setup lang="ts">
import VirtualTrackCardGrid from '@any-music/ui/components/virtual-scroll/VirtualTrackCardGrid.vue'
import { usePresentationContinuity } from '@any-music/ui/library'
import { createVirtualGridReorderGeometry } from '@any-music/ui/virtual-scroll'
import type {
  useMeasuredVirtualGrid,
  useVirtualItemRetention,
  useVirtualScrollAnchor,
} from '@any-music/ui/virtual-scroll'
import { onScopeDispose, useTemplateRef, watch } from 'vue'

import type { ClassicVirtualTrackGridAdapter } from '../../composables/classic-virtual-favorites-canary'
import type {
  QueuePlatformGridEmits,
  QueuePlatformGridGroup,
  QueuePlatformGridProps,
} from './queue-platform-grid-contracts'
import QueuePlatformGridItem from './QueuePlatformGridItem.vue'

interface GridPresentation {
  element: HTMLElement | null
  result: ReturnType<typeof useMeasuredVirtualGrid<QueuePlatformGridGroup>>
  retention?: ReturnType<typeof useVirtualItemRetention>
  anchor: ReturnType<typeof useVirtualScrollAnchor>
}

/** Classic overview candidates preserve real cards and the existing collection scroll root. */
const props = defineProps<QueuePlatformGridProps>()
const emit = defineEmits<QueuePlatformGridEmits>()
const grid = useTemplateRef<GridPresentation>('grid')
function contentGeneration(group: QueuePlatformGridGroup) {
  // Only platform-card content affects its natural height; songs remain controller inputs.
  return JSON.stringify([
    group.name,
    group.tracks.length,
    group.totalCount,
    group.isCustom,
    props.filtered,
    props.selectable,
  ])
}
const continuity = usePresentationContinuity({
  element: () => grid.value?.element ?? null,
  region: () => props.continuityKey ?? null,
  register: false,
  scrollElement: () => props.virtual?.scrollElement ?? null,
  geometry: () => {
    const result = grid.value?.result
    return result
      ? { ...result.geometry.value, listOffset: result.context.metrics.value.listOffset }
      : undefined
  },
  refresh: () => grid.value?.result.context.refresh(),
  beforeRestore() {
    grid.value?.retention?.cancelNavigation()
    // Semantic restoration owns scroll through every render/measurement batch.
    return grid.value?.anchor.suspend()
  },
  retain: (key) => grid.value?.retention?.retain(key, 'navigation'),
  revision: () => props.virtual?.resetKey,
})
const adapter: ClassicVirtualTrackGridAdapter = {
  continuity,
  captureOverview(id) {
    const snapshot = continuity.capture()
    return snapshot
      ? { ...snapshot, focus: { itemKey: id, controlKey: `platform:${id}:open` } }
      : undefined
  },
  restoreOverview: continuity.restore,
  createGeometry(input) {
    const current = grid.value
    const element = current?.element
    if (input.kind !== 'platform' || !current || !element) return
    const { result } = current
    if (!result.context.metrics.value.ready) return
    const source = [...element.children].find(
      (cell) => (cell as HTMLElement).dataset.queueDropId === input.sourceId,
    ) as HTMLElement | undefined
    if (!source) return
    const rect = element.getBoundingClientRect()
    const columns = result.columns.value
    const width = result.context.metrics.value.listWidth
    const listOffset = result.context.metrics.value.listOffset
    const generation = props.virtual?.layoutGeneration
    const mode = props.displayMode
    const mobileColumns = props.mobileColumns
    const scrollRoot = props.virtual?.scrollElement
    const hasCurrentOrigin = () =>
      Boolean(
        scrollRoot &&
        Math.abs(
          element.getBoundingClientRect().top -
            scrollRoot.getBoundingClientRect().top -
            scrollRoot.clientTop +
            scrollRoot.scrollTop -
            listOffset,
        ) <= 1,
      )
    const direction =
      element.ownerDocument.defaultView?.getComputedStyle(element).direction === 'rtl'
        ? 'rtl'
        : 'ltr'
    return createVirtualGridReorderGeometry(input, {
      geometry: result.geometry.value,
      getGeometry: () => result.geometry.value,
      getGeometryRevision: () => result.layoutRevision.value,
      columns,
      direction,
      listWidth: width,
      origin: { left: rect.left - input.bounds.left, top: rect.top - input.bounds.top },
      sourceElement: source,
      mountedIds: () => result.virtualItems.value.map((row) => String(row.key)),
      getMountedElement: (id) =>
        [...element.children].find((cell) => (cell as HTMLElement).dataset.queueDropId === id) as
          | HTMLElement
          | undefined,
      getRevision: () => result.virtualItems.value,
      isValid: () =>
        grid.value === current &&
        element.isConnected &&
        props.virtual?.scrollElement === scrollRoot &&
        result.context.metrics.value.ready &&
        result.columns.value === columns &&
        result.context.metrics.value.listWidth === width &&
        Math.abs(result.context.metrics.value.listOffset - listOffset) <= 1 &&
        hasCurrentOrigin() &&
        (element.ownerDocument.defaultView?.getComputedStyle(element).direction === 'rtl'
          ? 'rtl'
          : 'ltr') === direction &&
        props.virtual?.layoutGeneration === generation &&
        props.displayMode === mode &&
        props.mobileColumns === mobileColumns,
    })
  },
  retainItem: (kind, id) =>
    kind === 'platform' ? grid.value?.retention?.retain(id, 'reorder') : undefined,
  focusItem: (kind, id, signal) =>
    kind === 'platform'
      ? (grid.value?.retention?.focusItem(id, {
          signal,
          target: (element) => element.querySelector<HTMLElement>('[data-queue-handle]'),
        }) ?? Promise.resolve(false))
      : Promise.resolve(false),
  focusEntry: (id, signal) =>
    grid.value?.retention?.focusItem(id, {
      signal,
      target: (element) => element.querySelector<HTMLElement>('[data-collection-entry]'),
    }) ?? Promise.resolve(false),
  cancelNavigation() {
    grid.value?.anchor.cancel()
    grid.value?.retention?.cancelNavigation()
  },
}
watch(
  () => props.virtual?.register,
  (register, _previous, onCleanup) => {
    if (register) onCleanup(register(adapter))
  },
  { immediate: true, flush: 'sync' },
)
onScopeDispose(adapter.cancelNavigation)
</script>

<template>
  <VirtualTrackCardGrid
    ref="grid"
    class="virtual-queue-platform-grid"
    :data-display-mode="displayMode"
    :data-mobile-columns="mobileColumns"
    :items="groups"
    :get-item-key="(group) => group.id"
    :get-content-generation="contentGeneration"
    :estimated-item-size="196"
    :scroll-element="props.virtual?.scrollElement ?? null"
    :display-mode="displayMode"
    :mobile-columns="mobileColumns"
    :layout-generation="props.virtual?.layoutGeneration"
    :anchor-reset-key="props.virtual?.resetKey"
    :animate="props.animate !== false && !draggedId"
    :reorder="{
      attributePrefix: 'queue',
      kind: 'platform',
      getItemId: (row) => row.item.id,
      getItemStyle: getReorderStyle,
    }"
    layout="collection"
    interaction
    anchor
  >
    <template #default="{ row }">
      <QueuePlatformGridItem
        :group="row.item"
        :grid="props"
        virtual-placement
        @open="emit('open', $event)"
        @select="emit('select', $event)"
        @drag-start="(event, id) => emit('dragStart', event, id)"
        @shift="(id, direction) => emit('shift', id, direction)"
        @drag-cancel="emit('dragCancel')"
      />
    </template>
  </VirtualTrackCardGrid>
</template>

<style scoped>
.virtual-queue-platform-grid {
  --am-collection-card-width: 320px;
}
.virtual-queue-platform-grid[data-display-mode='comfortable'] {
  --am-collection-card-width: 480px;
}
.virtual-queue-platform-grid[data-display-mode='compact'] {
  --am-collection-card-width: 240px;
}
/* The original overview responds to its collection container, not the browser viewport. */
@container am-listen-queue (max-width: 600px) {
  .virtual-queue-platform-grid :deep([data-grid-layout='collection']) {
    gap: var(--am-space-2);
    grid-template-columns: minmax(0, 1fr);
  }
  .virtual-queue-platform-grid[data-mobile-columns='2'] :deep([data-grid-layout='collection']) {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
