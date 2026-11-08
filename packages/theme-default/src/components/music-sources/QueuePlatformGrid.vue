<script setup lang="ts">
import CollectionGrid from '@any-music/ui/components/CollectionGrid.vue'
import { defineAsyncComponent } from 'vue'

import type {
  QueuePlatformGridEmits,
  QueuePlatformGridProps,
} from './queue-platform-grid-contracts'
import QueuePlatformGridItem from './QueuePlatformGridItem.vue'

/** The overview shares its existing card while the unadmitted renderer remains lazy. */
const VirtualQueuePlatformGrid = defineAsyncComponent(
  () => import('./VirtualQueuePlatformGrid.vue'),
)
const props = defineProps<QueuePlatformGridProps>()
const emit = defineEmits<QueuePlatformGridEmits>()
</script>

<template>
  <VirtualQueuePlatformGrid
    v-if="props.virtual"
    v-bind="props"
    @open="emit('open', $event)"
    @select="emit('select', $event)"
    @drag-start="(event, id) => emit('dragStart', event, id)"
    @shift="(id, direction) => emit('shift', id, direction)"
    @drag-cancel="emit('dragCancel')"
  />
  <CollectionGrid
    v-else
    class="listen-queue__groups"
    :data-display-mode="displayMode"
    :data-mobile-columns="mobileColumns"
  >
    <QueuePlatformGridItem
      v-for="group in groups"
      :key="group.id"
      :group="group"
      :grid="props"
      @open="emit('open', $event)"
      @select="emit('select', $event)"
      @drag-start="(event, id) => emit('dragStart', event, id)"
      @shift="(id, direction) => emit('shift', id, direction)"
      @drag-cancel="emit('dragCancel')"
    />
  </CollectionGrid>
</template>
