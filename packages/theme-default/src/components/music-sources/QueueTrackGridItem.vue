<script setup lang="ts">
import type { Track } from '@any-music/core'

import type { QueueTrackGridEmits, QueueTrackGridProps } from './queue-track-grid-contracts'
import QueueTrackRow from './QueueTrackRow.vue'

/** Keep row skin, wording and intents identical across full and windowed rendering. */
const props = defineProps<{
  track: Track
  grid: Readonly<QueueTrackGridProps>
  virtualPlacement?: boolean
}>()
const emit = defineEmits<QueueTrackGridEmits>()
</script>

<template>
  <QueueTrackRow
    :track="track"
    :custom-tags="grid.customTagsByTrackId?.get(track.id)"
    :position="grid.positions.get(track.id) ?? 0"
    :context-label="
      track.source.mediaKind === 'custom'
        ? '本地拼接'
        : (grid.platformNames.get(track.source.pluginId) ?? track.source.pluginId)
    "
    :added-at-ms="grid.addedAtMsByTrackId.get(track.id)"
    :date-label="grid.dateLabel"
    :active="track.id === grid.currentTrackId"
    :selectable="grid.selectable"
    :selected="grid.selectedIds.has(track.id)"
    :dragging="grid.draggedId === track.id"
    :get-reorder-style="grid.getReorderStyle"
    :favorite="grid.favoriteTrackIds.has(track.id)"
    :invalid="grid.invalidTrackIds.has(track.id)"
    :download-busy="grid.downloadBusy"
    :display-mode="grid.displayMode"
    :mobile-columns="grid.mobileColumns"
    :virtual-placement="props.virtualPlacement"
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
