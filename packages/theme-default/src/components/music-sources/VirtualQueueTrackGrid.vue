<script setup lang="ts">
import type { Track } from '@any-music/core'
import VirtualTrackCardGrid from '@any-music/ui/components/virtual-scroll/VirtualTrackCardGrid.vue'
import { usePresentationContinuity } from '@any-music/ui/library'
import { createVirtualGridReorderGeometry } from '@any-music/ui/virtual-scroll'
import type {
  useMeasuredVirtualGrid,
  useVirtualItemRetention,
  useVirtualScrollAnchor,
} from '@any-music/ui/virtual-scroll'
import { computed, onScopeDispose, useTemplateRef, watch } from 'vue'

import type { ClassicVirtualTrackGridAdapter } from '../../composables/classic-virtual-favorites-canary'
import { useClassicOverlays } from '../../composables/use-classic-overlays'
import type { QueueTrackGridEmits, QueueTrackGridProps } from './queue-track-grid-contracts'
import QueueTrackGridItem from './QueueTrackGridItem.vue'

interface GridPresentation {
  element: HTMLElement | null
  result: ReturnType<typeof useMeasuredVirtualGrid<Track>>
  retention?: ReturnType<typeof useVirtualItemRetention>
  anchor: ReturnType<typeof useVirtualScrollAnchor>
}

/** Classic collection candidates adapt real rows without owning collection state. */
const props = defineProps<QueueTrackGridProps>()
const emit = defineEmits<QueueTrackGridEmits>()
const grid = useTemplateRef<GridPresentation>('grid')
const overlays = useClassicOverlays(() => false)
const estimate = computed(() =>
  props.displayMode === 'comfortable' ? 400 : props.displayMode === 'compact' ? 96 : 144,
)
// Build semantic revisions only when their actual reactive inputs change. Measurement
// batches also check remembered offscreen items; serializing every cached track for each
// batch makes scrolling repeat business-sized work. This O(N) map is separate from the
// bounded height cache, preserves in-place edits and owns no per-item effects/listeners.
const contentGenerations = computed<ReadonlyMap<string, string>>(
  () =>
    new Map(
      props.tracks.map((track) => [
        track.id,
        JSON.stringify([
          track,
          props.customNamesByTrackId?.get(track.id),
          props.customTagsByTrackId?.get(track.id),
          props.platformNames.get(track.source.pluginId),
          props.addedAtMsByTrackId.get(track.id),
          props.dateLabel,
          props.selectable,
        ]),
      ]),
    ),
)
function contentGeneration(track: Track) {
  return contentGenerations.value.get(track.id)!
}
const continuity = usePresentationContinuity({
  register: false,
  element: () => grid.value?.element ?? null,
  region: () => props.continuityKey ?? null,
  scrollElement: () => props.virtual?.scrollElement ?? null,
  geometry: () => {
    const result = grid.value?.result
    return result
      ? { ...result.geometry.value, listOffset: result.context.metrics.value.listOffset }
      : undefined
  },
  refresh: () => grid.value?.result.context.refresh(),
  beforeRestore: () => {
    grid.value?.retention?.cancelNavigation()
    return grid.value?.anchor.suspend()
  },
  retain: (key) => grid.value?.retention?.retain(key, 'navigation'),
  revision: () => props.virtual?.resetKey,
})
const adapter: ClassicVirtualTrackGridAdapter = {
  continuity,
  createGeometry(input) {
    const current = grid.value
    const element = current?.element
    if (input.kind !== 'track' || !current || !element) return
    const { result } = current
    if (!result.context.metrics.value.ready) return
    const source = [...element.children].find(
      (cell) => (cell as HTMLElement).dataset.queueDropId === input.sourceId,
    ) as HTMLElement | undefined
    if (!source) return
    const rect = element.getBoundingClientRect()
    const columns = result.columns.value
    const width = result.context.metrics.value.listWidth
    const originOffset = result.context.metrics.value.listOffset
    const layout = props.virtual?.layoutGeneration
    const displayMode = props.displayMode
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
            originOffset,
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
      listWidth: result.context.metrics.value.listWidth,
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
        Math.abs(result.context.metrics.value.listOffset - originOffset) <= 1 &&
        hasCurrentOrigin() &&
        (element.ownerDocument.defaultView?.getComputedStyle(element).direction === 'rtl'
          ? 'rtl'
          : 'ltr') === direction &&
        props.virtual?.layoutGeneration === layout &&
        props.displayMode === displayMode &&
        props.mobileColumns === mobileColumns,
    })
  },
  retainItem: (kind, id) =>
    kind === 'track' ? grid.value?.retention?.retain(id, 'reorder') : undefined,
  focusItem: (kind, id, signal) =>
    kind === 'track'
      ? (grid.value?.retention?.focusItem(id, {
          signal,
          target: (element) => element.querySelector<HTMLElement>('[data-queue-handle]'),
        }) ?? Promise.resolve(false))
      : Promise.resolve(false),
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
// The opener survives focus moving into the root-owned dialog, including its closing frame.
watch(
  [() => overlays?.trackActionId.value, () => grid.value?.retention],
  ([id, retention], _previous, onCleanup) => {
    const release = id ? retention?.retain(id, 'popover') : undefined
    if (release) onCleanup(release)
  },
  { immediate: true, flush: 'sync' },
)
onScopeDispose(adapter.cancelNavigation)
</script>

<template>
  <VirtualTrackCardGrid
    ref="grid"
    :items="tracks"
    :get-item-key="(track) => track.id"
    :get-content-generation="contentGeneration"
    :estimated-item-size="estimate"
    :scroll-element="props.virtual?.scrollElement ?? null"
    :display-mode="displayMode"
    :mobile-columns="mobileColumns"
    :layout-generation="props.virtual?.layoutGeneration"
    :anchor-reset-key="props.virtual?.resetKey"
    :animate="props.animate !== false && !draggedId"
    :reorder="{
      attributePrefix: 'queue',
      kind: 'track',
      getItemId: (row) => row.item.id,
      getItemStyle: getReorderStyle,
    }"
    interaction
    anchor
  >
    <template #default="{ row }">
      <QueueTrackGridItem
        :track="row.item"
        :grid="props"
        virtual-placement
        @select="emit('select', $event)"
        @play="emit('play', $event)"
        @favorite="emit('favorite', $event)"
        @download="emit('download', $event)"
        @show-actions="emit('showActions', $event)"
        @drag-start="(event, id) => emit('dragStart', event, id)"
        @shift="(id, direction) => emit('shift', id, direction)"
        @drag-cancel="emit('dragCancel')"
      />
    </template>
  </VirtualTrackCardGrid>
</template>
