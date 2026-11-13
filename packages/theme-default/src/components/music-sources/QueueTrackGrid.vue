<script setup lang="ts">
import TrackCardGrid from '@any-music/ui/components/music-sources/TrackCardGrid.vue'
import { computed, defineAsyncComponent } from 'vue'

import type { QueueTrackGridEmits, QueueTrackGridProps } from './queue-track-grid-contracts'
import QueueTrackGridItem from './QueueTrackGridItem.vue'

/** The closed canary keeps the virtualizer outside the normal execution path. */
const VirtualQueueTrackGrid = defineAsyncComponent(() => import('./VirtualQueueTrackGrid.vue'))
const props = withDefaults(defineProps<QueueTrackGridProps>(), { animate: true })
const itemKeys = computed(() => props.tracks.map(({ id }) => id))
const emit = defineEmits<QueueTrackGridEmits>()
</script>

<template>
  <VirtualQueueTrackGrid
    v-if="props.virtual"
    v-bind="props"
    @select="emit('select', $event)"
    @play="emit('play', $event)"
    @favorite="emit('favorite', $event)"
    @download="emit('download', $event)"
    @show-actions="emit('showActions', $event)"
    @drag-start="(event, id) => emit('dragStart', event, id)"
    @shift="(id, direction) => emit('shift', id, direction)"
    @drag-cancel="emit('dragCancel')"
  />
  <TrackCardGrid
    v-else
    :display-mode="displayMode"
    :mobile-columns="mobileColumns"
    :item-keys="itemKeys"
    :animate="props.animate"
  >
    <QueueTrackGridItem
      v-for="track in tracks"
      :key="track.id"
      :track="track"
      :grid="props"
      @select="emit('select', $event)"
      @play="emit('play', $event)"
      @favorite="emit('favorite', $event)"
      @download="emit('download', $event)"
      @show-actions="emit('showActions', $event)"
      @drag-start="(event, id) => emit('dragStart', event, id)"
      @shift="(id, direction) => emit('shift', id, direction)"
      @drag-cancel="emit('dragCancel')"
    />
  </TrackCardGrid>
</template>
