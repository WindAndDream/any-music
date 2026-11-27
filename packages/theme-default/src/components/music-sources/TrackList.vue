<script setup lang="ts">
import type { Track } from '@any-music/core'
import { useEditingSession, useScrollPageLoader, useTrackNames } from '@any-music/ui/catalog'
import type {
  CatalogTrackDisplayMode,
  MobileTrackColumns,
  TrackGridViewport,
  VirtualPageGeometry,
} from '@any-music/ui/catalog'
import LoadingSpinner from '@any-music/ui/components/LoadingSpinner.vue'
import CatalogTrackGrid from '@any-music/ui/components/music-sources/CatalogTrackGrid.vue'
import type { CollectionItemStyle } from '@any-music/ui/library'
import { computed, toValue, useTemplateRef, watch } from 'vue'

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
  itemStyle?: CollectionItemStyle
  mobileColumns: MobileTrackColumns
  loading: boolean
  hasMore: boolean
  loadedPageCount: number
  loadedTrackCount: number
  errorMessage: string
  downloadBusy?: boolean
  scrollElement?: HTMLElement | null
  viewportSize?: TrackGridViewport
  prefetch?: boolean
  prepareViewport?: boolean
  virtualized?: boolean
}>()

const emit = defineEmits<{
  play: [track: Track]
  download: [track: Track]
  favorite: [track: Track]
  select: [trackId: string]
  showActions: [track: Track]
  loadMore: []
  viewportReady: []
}>()

const listElement = useTemplateRef<HTMLElement>('listElement')
const contentElement = useTemplateRef<HTMLElement>('contentElement')
const grid = useTemplateRef<{ geometry?: VirtualPageGeometry }>('grid')
const geometry = computed(() => grid.value?.geometry)
const { customNamesByTrackId } = useTrackNames()
function contentGeneration(track: Track) {
  return JSON.stringify([
    track,
    customNamesByTrackId.value.get(track.id),
    props.customTagsByTrackId?.get(track.id),
    props.invalidTrackIds.has(track.id),
  ])
}
const emptyMessage = computed(() => {
  if (props.loadedTrackCount > 0) return '已加载歌曲中没有匹配项，请调整筛选条件。'
  if (props.hasMore) return '当前页没有可用歌曲，请滚动继续加载。'
  if (props.loadedPageCount === 0) return '尚未加载到歌曲，请查看列表状态或刷新重试。'
  return '当前结果中没有可用歌曲。'
})
const { preparing, restorePosition } = useScrollPageLoader({
  editing: useEditingSession(`pagination:${props.listingId}`),
  listElement: () => (!props.virtualized || geometry.value ? listElement.value : null),
  scrollElement: () => props.scrollElement,
  virtualList: geometry,
  hasMore: () => props.hasMore,
  loading: () => props.loading,
  pageNumber: () => props.loadedPageCount,
  visibleCount: () => props.tracks.length,
  loadedCount: () => props.loadedTrackCount,
  loadNext: () => emit('loadMore'),
  fillShortList: false,
  prefetch: () => props.prefetch === true,
  restoreScroll: true,
  initialFill: { enabled: () => props.prepareViewport === true, contentElement },
})
const ready = computed(
  () =>
    !preparing.value &&
    (!props.virtualized || toValue(geometry.value?.context.metrics)?.ready === true),
)
watch(
  ready,
  (value) => {
    if (value) emit('viewportReady')
  },
  { immediate: true },
)
defineExpose({ ready, restorePosition })
</script>

<template>
  <div ref="listElement" class="list" role="region" aria-label="歌曲列表" tabindex="0">
    <p v-if="errorMessage" class="list__message list__message--error">{{ errorMessage }}</p>
    <p v-else-if="tracks.length === 0 && !loading && !preparing" class="list__message">
      {{ emptyMessage }}
    </p>
    <div
      v-if="virtualized || tracks.length > 0"
      ref="contentElement"
      :class="{ 'list__tracks--preparing': preparing }"
      :inert="preparing"
    >
      <CatalogTrackGrid
        ref="grid"
        :tracks="tracks"
        :get-content-generation="contentGeneration"
        :display-mode="props.displayMode"
        :mobile-columns="props.mobileColumns"
        :viewport-size="props.viewportSize"
        :scroll-element="scrollElement"
        :layout-generation="itemStyle"
        :virtualized="virtualized"
        :animate="!preparing"
      >
        <template #default="{ track }">
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
            :item-style="props.itemStyle"
            @play="emit('play', $event)"
            @download="emit('download', $event)"
            @favorite="emit('favorite', $event)"
            @select="emit('select', $event)"
            @show-actions="emit('showActions', $event)"
          />
        </template>
      </CatalogTrackGrid>
    </div>
    <p
      v-if="loading || preparing"
      class="list__message"
      :class="{ 'list__loading--preparing': preparing && tracks.length }"
    >
      <LoadingSpinner label="正在加载歌曲" />
    </p>
  </div>
</template>

<style scoped>
.list {
  position: relative;
  min-inline-size: 0;
}
.list__tracks--preparing {
  visibility: hidden;
}
.list__loading--preparing {
  position: absolute;
  inset-block-start: 0;
  inset-inline: 0;
}
.list__more {
  border-radius: var(--am-radius-control);
}
</style>
