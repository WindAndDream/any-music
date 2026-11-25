<script setup lang="ts">
import type { Track } from '@any-music/core'
import VirtualTrackCardGrid from '@any-music/ui/components/virtual-scroll/VirtualTrackCardGrid.vue'
import { usePresentationContinuity } from '@any-music/ui/library'
import { computed, onScopeDispose, useTemplateRef, watch } from 'vue'

import {
  createClassicTrackGridGeometry,
  type ClassicMeasuredTrackGrid,
  type ClassicVirtualTrackGridAdapter,
} from '../../composables/classic-virtual-track-grid'
import { useClassicOverlays } from '../../composables/use-classic-overlays'
import type { QueueTrackGridEmits, QueueTrackGridProps } from './queue-track-grid-contracts'
import QueueTrackGridItem from './QueueTrackGridItem.vue'

/** Classic collection candidates adapt real rows without owning collection state. */
const props = defineProps<QueueTrackGridProps>()
const emit = defineEmits<QueueTrackGridEmits>()
const grid = useTemplateRef<ClassicMeasuredTrackGrid<Track>>('grid')
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
  createGeometry: createClassicTrackGridGeometry(
    () => grid.value,
    () => props.virtual?.scrollElement,
    () => JSON.stringify([props.virtual?.layoutGeneration, props.displayMode, props.mobileColumns]),
  ),
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
