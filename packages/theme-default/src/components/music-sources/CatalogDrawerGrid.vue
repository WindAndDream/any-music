<script setup lang="ts">
import { useCatalogDrawerReorder } from '@any-music/ui/catalog'
import type { CatalogDrawerView } from '@any-music/ui/catalog'
import VirtualTrackCardGrid from '@any-music/ui/components/virtual-scroll/VirtualTrackCardGrid.vue'
import { createVirtualGridReorderGeometry } from '@any-music/ui/virtual-scroll'
import type {
  useMeasuredVirtualGrid,
  useVirtualItemRetention,
  useVirtualScrollAnchor,
} from '@any-music/ui/virtual-scroll'
import { nextTick, useTemplateRef, watch } from 'vue'

import CatalogDrawerCard from './CatalogDrawerCard.vue'

const props = defineProps<{
  drawers: readonly CatalogDrawerView[]
  scrollElement: HTMLElement | null
  offsetElements: readonly Element[]
  selectedIds: ReadonlySet<string>
  selectable: boolean
  suspended: boolean
  initialScrollTop?: number
  focusDrawerId?: string
  overlayDrawerId?: string
}>()
const emit = defineEmits<{
  view: [id: string]
  showError: [id: string]
  showActions: [id: string]
  select: [id: string]
  move: [id: string, target: string, visibleIds: readonly string[]]
  scrollRestored: []
  focusRestored: []
}>()
const grid = useTemplateRef<{
  element: HTMLElement | null
  result: ReturnType<typeof useMeasuredVirtualGrid<CatalogDrawerView>>
  retention?: ReturnType<typeof useVirtualItemRetention>
  anchor: ReturnType<typeof useVirtualScrollAnchor>
}>('grid')
const cardHandle = (cell: HTMLElement) => cell.querySelector<HTMLElement>('[data-catalog-handle]')

function focusDrawer(id: string, signal: AbortSignal) {
  return (
    grid.value?.retention?.focusItem(id, {
      signal,
      target: cardHandle,
      blockStartInset: () => {
        const sticky = props.offsetElements.find(
          (element) =>
            element.ownerDocument.defaultView?.getComputedStyle(element).position === 'sticky',
        )
        return sticky?.getBoundingClientRect().height ?? 0
      },
    }) ?? Promise.resolve(false)
  )
}

const reorder = useCatalogDrawerReorder({
  drawers: () => props.drawers,
  element: () => grid.value?.element ?? null,
  autoScrollElement: () => props.scrollElement,
  suspended: () => props.suspended,
  move: (id, target, ids) => emit('move', id, target, ids),
  retainItem: (_kind, id) => grid.value?.retention?.retain(id, 'reorder'),
  focusItem: (_kind, id, signal) => focusDrawer(id, signal),
  createGeometry(input) {
    const current = grid.value
    const root = props.scrollElement
    if (!current || !root || !current.result.context.metrics.value.ready) return
    const { container, sourceId } = input
    const { result } = current
    const getMountedElement = (id: string) =>
      [...container.children].find((cell) => (cell as HTMLElement).dataset.catalogDropId === id) as
        | HTMLElement
        | undefined
    const sourceElement = getMountedElement(sourceId)
    if (!sourceElement) return
    const columns = result.columns.value
    const { listWidth, listOffset } = result.context.metrics.value
    const getDirection = () =>
      container.ownerDocument.defaultView?.getComputedStyle(container).direction === 'rtl'
        ? 'rtl'
        : 'ltr'
    const direction = getDirection()
    return createVirtualGridReorderGeometry(input, {
      geometry: result.geometry.value,
      getGeometry: () => result.geometry.value,
      getGeometryRevision: () => result.layoutRevision.value,
      columns,
      direction,
      listWidth,
      origin: { left: 0, top: 0 },
      sourceElement,
      mountedIds: () => result.virtualItems.value.map((row) => String(row.key)),
      getMountedElement,
      getRevision: () => result.virtualItems.value,
      includeOtherGroups: true,
      isValid: () => {
        const metrics = result.context.metrics.value
        return (
          grid.value === current &&
          props.scrollElement === root &&
          container.isConnected &&
          metrics.ready &&
          result.columns.value === columns &&
          metrics.listWidth === listWidth &&
          Math.abs(metrics.listOffset - listOffset) <= 1 &&
          getDirection() === direction
        )
      },
    })
  },
})
watch(() => props.selectable, reorder.cancel)

function contentGeneration(drawer: CatalogDrawerView) {
  return JSON.stringify([
    drawer.title,
    drawer.input,
    drawer.kind,
    drawer.pluginName,
    drawer.createdAtMs,
    drawer.status,
    drawer.isPinned,
    drawer.isSourceEnabled,
    drawer.isLoading,
    drawer.loadedPageCount,
    drawer.tracks.length,
    drawer.errorMessage,
    drawer.invalidReason,
    props.selectable,
  ])
}

const ready = () => grid.value?.result.context.metrics.value.ready
watch(
  [ready, () => props.scrollElement, () => props.initialScrollTop],
  async ([measured, root, top], _previous, onCleanup) => {
    if (!measured || !root || top === undefined) return
    const current = grid.value
    let active = true
    onCleanup(() => (active = false))
    // Wait for Vue to publish the full estimated extent before the browser can clamp scrollTop.
    await nextTick()
    if (!active || !current || grid.value !== current) return
    root.scrollTop = top
    current.result.context.refresh()
    current.anchor.cancel()
    emit('scrollRestored')
  },
  { immediate: true, flush: 'post' },
)
watch(
  [ready, () => props.initialScrollTop, () => props.focusDrawerId, () => props.suspended],
  async ([measured, top, id, suspended], _previous, onCleanup) => {
    if (!measured || top !== undefined || !id || suspended) return
    const controller = new AbortController()
    onCleanup(() => controller.abort())
    await focusDrawer(id, controller.signal)
    if (!controller.signal.aborted) emit('focusRestored')
  },
  { immediate: true, flush: 'post' },
)
watch(
  [() => grid.value?.retention, ready, () => props.overlayDrawerId],
  ([retention, measured, id], _previous, onCleanup) => {
    const release = measured && id ? retention?.retain(id, 'popover') : undefined
    if (release) onCleanup(release)
  },
  { immediate: true, flush: 'post' },
)
</script>

<template>
  <VirtualTrackCardGrid
    ref="grid"
    class="catalog-drawers__grid"
    :items="drawers"
    :get-item-key="(drawer) => drawer.id"
    :get-content-generation="contentGeneration"
    :estimated-item-size="240"
    :scroll-element="scrollElement"
    :offset-elements="offsetElements"
    display-mode="standard"
    :mobile-columns="1"
    layout="collection"
    :animate="!reorder.draggedId.value"
    :reorder="{
      attributePrefix: 'catalog',
      kind: 'drawer',
      getItemId: (row) => row.item.id,
      getItemStyle: (id) => reorder.getItemStyle('drawer', id),
    }"
    interaction
    anchor
  >
    <template #default="{ row }">
      <CatalogDrawerCard
        :drawer="row.item"
        :selected="selectedIds.has(row.item.id)"
        :selectable="selectable"
        :dragging="reorder.draggedId.value === row.item.id"
        @press-start="reorder.startPress"
        @shift="(id, direction) => reorder.shift('drawer', id, direction)"
        @drag-cancel="reorder.cancel"
        @view="emit('view', $event)"
        @show-error="emit('showError', $event)"
        @show-actions="emit('showActions', $event)"
        @select="emit('select', $event)"
      />
    </template>
  </VirtualTrackCardGrid>
</template>

<style scoped>
.catalog-drawers__grid {
  --am-collection-card-width: 300px;
}
.catalog-drawers__grid :deep(.virtual-grid-cell) {
  container-name: am-catalog-card;
}
.catalog-drawers__grid :deep([data-am-grid-dragging]),
.catalog-drawers__grid :deep([data-am-grid-dragging] .catalog-card),
.catalog-drawers__grid :deep([data-am-grid-dragging] .catalog-card *) {
  cursor: move;
  user-select: none;
}
@container am-catalog-list (max-width: 680px) {
  .catalog-drawers__grid :deep(.virtual-track-list__items) {
    gap: var(--am-space-3);
  }
}
</style>
