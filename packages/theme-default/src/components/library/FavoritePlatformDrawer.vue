<script setup lang="ts">
import type { CustomTrackDefinition, LibraryTrackRecord, Track } from '@any-music/core'
import AppIcon from '@any-music/ui/components/AppIcon.vue'
import type { FavoritePlatformOption } from '@any-music/ui/library'

import FavoriteTrackRow from './FavoriteTrackRow.vue'

const props = defineProps<{
  platform: FavoritePlatformOption
  records: readonly LibraryTrackRecord[]
  currentTrackId?: string
  expanded: boolean
  platformNames: ReadonlyMap<string, string>
  customTrackById: ReadonlyMap<string, CustomTrackDefinition>
  favoriteTrackIds: ReadonlySet<string>
  selectedTrackIds: ReadonlySet<string>
  selectable: boolean
  totalLabel: string
  removableFromPlaylist: boolean
}>()

const emit = defineEmits<{
  toggle: [platformId: string]
  play: [track: Track]
  queue: [track: Track]
  compose: [trackId: string]
  favorite: [track: Track]
  unfavorite: [trackId: string]
  select: [trackId: string]
  removeFromPlaylist: [trackId: string]
}>()
</script>

<template>
  <section class="favorite-drawer">
    <button
      class="favorite-drawer__toggle"
      type="button"
      :aria-expanded="props.expanded"
      :aria-controls="`favorite-drawer-panel-${props.platform.id}`"
      @click="emit('toggle', props.platform.id)"
    >
      <AppIcon :name="props.expanded ? 'arrow-down' : 'arrow-right'" />
      <strong>{{ props.platform.name }}</strong>
      <small>{{ props.records.length }} 首匹配 · {{ props.totalLabel }}</small>
    </button>

    <div
      v-if="props.expanded"
      :id="`favorite-drawer-panel-${props.platform.id}`"
      class="favorite-drawer__panel"
    >
      <p v-if="props.records.length === 0" class="favorites__message">该平台暂无匹配歌曲。</p>
      <template v-else>
        <FavoriteTrackRow
          v-for="record in props.records"
          :key="record.track.id"
          :record="record"
          :platform-name="props.platform.name"
          :platform-names="props.platformNames"
          :custom-definition="props.customTrackById.get(record.track.id)"
          :active="record.track.id === props.currentTrackId"
          :favorite="props.favoriteTrackIds.has(record.track.id)"
          :selectable="props.selectable"
          :selected="props.selectedTrackIds.has(record.track.id)"
          :removable-from-playlist="props.removableFromPlaylist"
          @play="emit('play', $event)"
          @queue="emit('queue', $event)"
          @compose="emit('compose', $event)"
          @favorite="emit('favorite', $event)"
          @unfavorite="emit('unfavorite', $event)"
          @select="emit('select', $event)"
          @remove-from-playlist="emit('removeFromPlaylist', $event)"
        />
      </template>
    </div>
  </section>
</template>
