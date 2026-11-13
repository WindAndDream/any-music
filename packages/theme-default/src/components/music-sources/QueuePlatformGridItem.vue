<script setup lang="ts">
import { computed } from 'vue'

import type {
  QueuePlatformGridEmits,
  QueuePlatformGridGroup,
  QueuePlatformGridProps,
} from './queue-platform-grid-contracts'
import QueuePlatformGroup from './QueuePlatformGroup.vue'

/** Keep the real platform card and its complete-group selection identical in both renderers. */
const props = defineProps<{
  group: QueuePlatformGridGroup
  grid: Readonly<QueuePlatformGridProps>
  virtualPlacement?: boolean
}>()
const emit = defineEmits<QueuePlatformGridEmits>()
const selected = computed(() =>
  props.group.tracks.every((track) => props.grid.selectedIds.has(track.id)),
)
const indeterminate = computed(
  () => !selected.value && props.group.tracks.some((track) => props.grid.selectedIds.has(track.id)),
)
</script>

<template>
  <QueuePlatformGroup
    :platform-id="group.id"
    :name="group.name"
    :count="group.tracks.length"
    :total-count="group.totalCount"
    :is-custom="group.isCustom"
    :filtered="grid.filtered"
    :selected="selected"
    :indeterminate="indeterminate"
    :selectable="grid.selectable"
    :dragging="grid.draggedId === group.id"
    :reorder-style="virtualPlacement ? undefined : grid.getReorderStyle(group.id)"
    :virtual-placement="virtualPlacement"
    @open="emit('open', group.id)"
    @select="grid.selectable && emit('select', group.id)"
    @drag-start="(event, id) => emit('dragStart', event, id)"
    @shift="(id, direction) => emit('shift', id, direction)"
    @drag-cancel="emit('dragCancel')"
  />
</template>
