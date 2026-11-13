<script setup lang="ts">
import type { FavoritePanelProps, FavoritePanelEmits } from '@any-music/ui/theme'
import { computed } from 'vue'

import QueuePanel from '../music-sources/QueuePanel.vue'

// 只适配喜欢的事实数据与业务事件；布局、筛选、平台导航和排序共用待听的集合界面。
const props = defineProps<FavoritePanelProps>()
defineOptions({ inheritAttrs: false })
const emit = defineEmits<FavoritePanelEmits>()
const collectionProps = computed(() => {
  const { records: _records, ...options } = props
  return options
})
const favorites = computed(() =>
  props.records.filter((record) => record.favoritedAtMs !== undefined),
)
const items = computed(() => favorites.value.map((record) => record.track))
const favoriteTrackIds = computed(() => new Set(items.value.map((track) => track.id)))
const favoritedAtMsByTrackId = computed(
  () => new Map(favorites.value.map((record) => [record.track.id, record.favoritedAtMs!])),
)
</script>

<template>
  <QueuePanel
    v-bind="collectionProps"
    context="favorites"
    :items="items"
    :added-at-ms-by-track-id="favoritedAtMsByTrackId"
    :favorite-track-ids="favoriteTrackIds"
    @play-collection="(track, tracks) => emit('play', track, tracks)"
    @favorite="emit('unfavorite', $event.id)"
    @remove-many="emit('unfavoriteMany', $event)"
    @update:arrangement-mode="emit('update:arrangementMode', $event)"
    @pin="(id, ids) => emit('pin', id, ids)"
    @move="(id, target, ids) => emit('move', id, target, ids)"
    @move-platform="(id, target, ids) => emit('movePlatform', id, target, ids)"
    @download="emit('download', $event)"
    @queue="emit('queue', $event)"
    @queue-many="emit('queueMany', $event)"
    @request-create-playlist="emit('requestCreatePlaylist')"
    @add-to-playlist="(id, tracks) => emit('addToPlaylist', id, tracks)"
    @compose="emit('compose', $event)"
    @add-tag="(track, tag) => emit('addTag', track, tag)"
    @remove-tag="(track, tag) => emit('removeTag', track, tag)"
    @rename="(track, name) => emit('rename', track, name)"
    @summary-change="emit('summaryChange', $event)"
    @operator-available-change="emit('operatorAvailableChange', $event)"
    @close-filter="emit('closeFilter')"
    @close-operator="emit('closeOperator')"
    @modal-open-change="emit('modalOpenChange', $event)"
    @select-all-change="emit('selectAllChange', $event)"
    @update-display-mode="emit('updateDisplayMode', $event)"
    @update-mobile-columns="emit('updateMobileColumns', $event)"
  />
</template>
