<script setup lang="ts">
import { CoverPlaylistCard } from '@any-music/card-styles/vue'
import type { MusicPlaylist } from '@any-music/core'
import { computed } from 'vue'
import type { CSSProperties } from 'vue'

const props = defineProps<{
  playlist: MusicPlaylist
  index: number
  coverUrl?: string
  tags?: readonly string[]
  dragging?: boolean
  selectable?: boolean
  selected?: boolean
  selectionOnly?: boolean
  disabled?: boolean
  getReorderStyle?: (kind: 'track', id: string) => CSSProperties | undefined
}>()
const reorderStyle = computed(() => props.getReorderStyle?.('track', props.playlist.id))
const emit = defineEmits<{
  open: [id: string]
  details: [id: string]
  select: [id: string]
  press: [event: PointerEvent, id: string]
  shift: [id: string, direction: -1 | 1]
  cancelDrag: []
}>()
</script>
<template>
  <article
    class="playlist-tile"
    :class="{
      'playlist-tile--dragging': dragging,
      'playlist-tile--moving': reorderStyle || dragging,
      'playlist-tile--selected': selected,
    }"
    data-am-grid-motion
    :style="reorderStyle"
    :inert="disabled ? true : undefined"
    @click="!disabled && (selectable ? emit('select', playlist.id) : emit('open', playlist.id))"
  >
    <CoverPlaylistCard
      :id="playlist.id"
      :name="playlist.name"
      :tags="tags"
      :cover-url="coverUrl"
      :count="playlist.trackIds.length"
      :index="index"
      :selected="selected"
      :selectable="selectable"
      :selection-only="selectionOnly"
      :disabled="disabled"
      @open="selectable ? emit('select', playlist.id) : emit('open', playlist.id)"
      @actions="emit('details', playlist.id)"
      @select="emit('select', playlist.id)"
      @press="emit('press', $event, playlist.id)"
      @shift="emit('shift', playlist.id, $event)"
      @cancel-drag="emit('cancelDrag')"
    />
  </article>
</template>
<style scoped>
.playlist-tile {
  position: relative;
  display: grid;
  min-inline-size: 0;
  box-sizing: border-box;
  padding: var(--am-space-3);
  border: 1px solid var(--am-color-border);
  border-radius: var(--am-radius-card);
  background: var(--am-color-surface);
  color: var(--am-color-text);
  cursor: pointer;
  transition:
    border-color var(--am-motion-fast),
    transform var(--am-motion-normal) var(--am-ease-emphasized);
}
.playlist-tile:has(:focus-visible),
.playlist-tile--selected {
  border-color: var(--am-color-primary);
}
.playlist-tile--dragging {
  opacity: 0.96;
  box-shadow: var(--am-shadow-card);
  outline: 1px solid var(--am-color-primary);
  transition: none;
  pointer-events: none;
  user-select: none;
}
.playlist-tile--moving {
  will-change: transform;
}
@media (hover: hover) and (pointer: fine) {
  .playlist-tile:hover:not(.playlist-tile--selected) {
    border-color: var(--am-color-border-strong);
  }
}
@media (prefers-reduced-motion: reduce) {
  .playlist-tile {
    transition: none;
  }
}
</style>
