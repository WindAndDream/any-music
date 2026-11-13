<script setup lang="ts">
import type { Track } from '@any-music/core'
import { useScrollPageLoader, useEditingSession } from '@any-music/ui/catalog'
import type { CatalogTrackDisplayMode, MobileTrackColumns } from '@any-music/ui/catalog'
import TrackCardGrid from '@any-music/ui/components/music-sources/TrackCardGrid.vue'
import { computed, useTemplateRef } from 'vue'

import TrackRow from './TrackRow.vue'

// 列表保持纯展示契约，分页、播放与入队均通过显式事件上抛。
const props = defineProps<{
  listingId: string
  tracks: readonly Track[]
  customTagsByTrackId?: ReadonlyMap<string, readonly string[]>
  currentTrackId?: string
  invalidTrackIds: ReadonlySet<string>
  favoriteTrackIds: ReadonlySet<string>
  selectedTrackIds: ReadonlySet<string>
  selectable?: boolean
  displayMode: CatalogTrackDisplayMode
  mobileColumns: MobileTrackColumns
  loading: boolean
  hasMore: boolean
  loadedPageCount: number
  loadedTrackCount: number
  errorMessage: string
  downloadBusy?: boolean
}>()

const emit = defineEmits<{
  play: [track: Track]
  download: [track: Track]
  favorite: [track: Track]
  select: [trackId: string]
  showActions: [track: Track]
  loadMore: []
}>()

const listElement = useTemplateRef<HTMLElement>('listElement')
const itemKeys = computed(() => props.tracks.map(({ id }) => id))
const emptyMessage = computed(() => {
  if (props.loadedTrackCount > 0) return '已加载歌曲中没有匹配项，请调整筛选条件。'
  if (props.hasMore) return '当前页没有可用歌曲，请滚动继续加载。'
  if (props.loadedPageCount === 0) return '尚未加载到歌曲，请查看列表状态或刷新重试。'
  return '当前结果中没有可用歌曲。'
})
useScrollPageLoader({
  editing: useEditingSession(`pagination:${props.listingId}`),
  listElement,
  hasMore: () => props.hasMore,
  loading: () => props.loading,
  pageNumber: () => props.loadedPageCount,
  visibleCount: () => props.tracks.length,
  loadedCount: () => props.loadedTrackCount,
  loadNext: () => emit('loadMore'),
})
</script>

<template>
  <div ref="listElement" class="list" role="region" aria-label="歌曲列表" tabindex="0">
    <p v-if="errorMessage" class="list__message list__message--error">{{ errorMessage }}</p>
    <p v-else-if="tracks.length === 0 && !loading" class="list__message">{{ emptyMessage }}</p>
    <TrackCardGrid
      v-if="tracks.length > 0"
      :display-mode="props.displayMode"
      :mobile-columns="props.mobileColumns"
      :item-keys="itemKeys"
      animate
    >
      <!-- 网格单元是查询容器，歌曲卡片及其按钮只按单元的真实宽度重排。 -->
      <div v-for="track in tracks" :key="track.id" class="list__cell">
        <TrackRow
          :track="track"
          :custom-tags="props.customTagsByTrackId?.get(track.id)"
          :active="track.id === currentTrackId"
          :invalid="invalidTrackIds.has(track.id)"
          :favorite="favoriteTrackIds.has(track.id)"
          :selectable="props.selectable"
          :selected="selectedTrackIds.has(track.id)"
          :download-busy="props.downloadBusy"
          :display-mode="props.displayMode"
          @play="emit('play', $event)"
          @download="emit('download', $event)"
          @favorite="emit('favorite', $event)"
          @select="emit('select', $event)"
          @show-actions="emit('showActions', $event)"
        />
      </div>
    </TrackCardGrid>
    <p v-if="loading" class="list__message" role="status">加载中…</p>
  </div>
</template>

<style scoped>
.list {
  min-inline-size: 0;
}
.list__cell {
  container: am-track-card / inline-size;
  display: grid;
  min-inline-size: 0;
}
.list__more {
  border-radius: var(--am-radius-control);
}
</style>
