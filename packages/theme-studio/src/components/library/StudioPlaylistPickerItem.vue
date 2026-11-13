<script setup lang="ts">
import { CoverPlaylistCard } from '@any-music/card-styles/vue'
import type { MusicPlaylist } from '@any-music/core'

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
    <article
      class="studio-card studio-playlist-choice"
      :class="{ 'studio-playlist-choice--selected': selected }"
      :inert="disabled ? true : undefined"
      @click="!disabled && $emit('select', playlist.id)"
    >
      <CoverPlaylistCard
        :id="playlist.id"
        :name="playlist.name"
        :count="playlist.trackIds.length"
        :cover-url="coverUrl"
        :tags="tags"
        :selected="selected"
        :disabled="disabled"
        selectable
        selection-only
        @select="$emit('select', playlist.id)"
      />
    </article>
  </div>
</template>

<style scoped>
.list__cell {
  container: am-track-card / inline-size;
  display: grid;
  min-inline-size: 0;
}
.studio-playlist-choice {
  cursor: pointer;
}
.studio-playlist-choice--selected {
  border-color: var(--am-color-primary);
}
.studio-playlist-choice:focus-within {
  outline: var(--am-focus-ring);
  outline-offset: -3px;
}
</style>
