<script setup lang="ts">
import type { MusicPlaylist } from '@any-music/core'

import ClassicPlaylistTile from './ClassicPlaylistTile.vue'

defineProps<{
  playlist: MusicPlaylist
  coverUrl?: string
  tags?: readonly string[]
  selected: boolean
  disabled?: boolean
}>()
defineEmits<{ select: [id: string] }>()
</script>

<template>
  <div class="list__cell">
    <ClassicPlaylistTile
      :playlist="playlist"
      :index="0"
      :cover-url="coverUrl"
      :tags="tags"
      :selected="selected"
      :disabled="disabled"
      selectable
      selection-only
      @select="$emit('select', $event)"
    />
  </div>
</template>

<style scoped>
.list__cell {
  container: am-track-card / inline-size;
  display: grid;
  min-inline-size: 0;
}
</style>
