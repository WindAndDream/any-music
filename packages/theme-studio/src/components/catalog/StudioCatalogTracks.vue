<script setup lang="ts">
import type { Track } from '@any-music/core'
import type { CatalogDrawerView } from '@any-music/ui'
import { useEditingSession, useScrollPageLoader } from '@any-music/ui/catalog'
import type { TrackGridViewport, VirtualPageGeometry } from '@any-music/ui/catalog'
import LoadingSpinner from '@any-music/ui/components/LoadingSpinner.vue'
import CatalogTrackGrid from '@any-music/ui/components/music-sources/CatalogTrackGrid.vue'
import type { UiThemeFeatureMap } from '@any-music/ui/theme'
import { computed, toValue, useTemplateRef, watch } from 'vue'

import StudioStyledTrack from '../library/StudioStyledTrack.vue'
import StudioCatalogTable from './StudioCatalogTable.vue'
import StudioTrackRow from './StudioTrackRow.vue'

type Catalog = UiThemeFeatureMap['catalog']
const props = defineProps<{
  state: Pick<
    Catalog['state'],
    | 'tracks'
    | 'displayMode'
    | 'mobileColumns'
    | 'itemStyle'
    | 'customTagsByTrackId'
    | 'customNamesByTrackId'
    | 'invalidTrackIds'
    | 'selectedTrackIds'
    | 'favoriteTrackIds'
    | 'queuedTrackIds'
    | 'currentTrackId'
    | 'downloadBusy'
  >
  actions: Pick<
    Catalog['actions'],
    | 'select'
    | 'play'
    | 'showTrackActions'
    | 'toggleFavorite'
    | 'toggleQueue'
    | 'download'
    | 'loadMore'
  >
  drawer: Pick<
    CatalogDrawerView,
    'id' | 'isLoading' | 'loadedPageCount' | 'hasMore' | 'paginationLocked'
  > &
    Partial<Pick<CatalogDrawerView, 'status'>>
  loadedTrackCount: number
  canLoadMore: boolean
  scrollElement?: HTMLElement | null
  viewportSize?: TrackGridViewport
  prefetch?: boolean
  prepareViewport?: boolean
  virtualized?: boolean
}>()
const emit = defineEmits<{ viewportReady: [] }>()
const loading = computed(() => props.drawer.isLoading || props.drawer.status === 'restoring')
const selectedIds = computed(() => new Set(props.state.selectedTrackIds))
const invalidIds = computed(() => new Set(props.state.invalidTrackIds))
const favoriteIds = computed(() => new Set(props.state.favoriteTrackIds))
const queuedIds = computed(() => new Set(props.state.queuedTrackIds))
function play(id: string) {
  return props.actions.play(
    id,
    props.state.tracks.map((track) => track.id),
  )
}
function contentGeneration(track: Track) {
  return JSON.stringify([
    track,
    props.state.customNamesByTrackId.get(track.id),
    props.state.customTagsByTrackId.get(track.id),
    invalidIds.value.has(track.id),
  ])
}
function toggle(id: string) {
  props.actions.select(
    selectedIds.value.has(id)
      ? props.state.selectedTrackIds.filter((entry) => entry !== id)
      : [...props.state.selectedTrackIds, id],
  )
}
const listElement = useTemplateRef<HTMLElement>('listElement')
const surface = useTemplateRef<{ geometry?: VirtualPageGeometry }>('surface')
const geometry = computed(() => surface.value?.geometry)
const { preparing, restorePosition } = useScrollPageLoader({
  editing: useEditingSession(`pagination:${props.drawer.id}`),
  listElement: () => (!props.virtualized || geometry.value ? listElement.value : null),
  scrollElement: () => props.scrollElement,
  virtualList: geometry,
  hasMore: () => props.canLoadMore,
  loading,
  pageNumber: () => props.drawer.loadedPageCount,
  visibleCount: () => props.state.tracks.length,
  loadedCount: () => props.loadedTrackCount,
  loadNext: () => {
    if (props.canLoadMore) void props.actions.loadMore(props.drawer.id)
  },
  fillShortList: false,
  prefetch: () => props.prefetch === true,
  restoreScroll: true,
  initialFill: { enabled: () => props.prepareViewport === true, contentElement: listElement },
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
  <template v-if="drawer">
    <div
      ref="listElement"
      class="studio-table-scroll"
      :class="{ 'studio-table-scroll--preparing': preparing }"
      :inert="preparing"
      role="region"
      aria-label="歌曲列表"
      tabindex="0"
      data-am-scroll-key="catalog:tracks"
    >
      <CatalogTrackGrid
        v-if="state.itemStyle && state.itemStyle !== 'default'"
        ref="surface"
        :tracks="state.tracks"
        :get-content-generation="contentGeneration"
        :display-mode="state.displayMode"
        :mobile-columns="state.mobileColumns"
        :viewport-size="viewportSize"
        :scroll-element="scrollElement"
        :layout-generation="state.itemStyle"
        :virtualized="virtualized"
      >
        <template #default="{ track }">
          <StudioStyledTrack
            :item-style="state.itemStyle"
            :track="track"
            :custom-tags="state.customTagsByTrackId.get(track.id)"
            :title="state.customNamesByTrackId.get(track.id) ?? track.title"
            :invalid="invalidIds.has(track.id)"
            :selected="selectedIds.has(track.id)"
            selectable
            @select="toggle(track.id)"
            @play="play(track.id)"
            @actions="actions.showTrackActions(track.id)"
          />
        </template>
      </CatalogTrackGrid>
      <StudioCatalogTable
        v-else
        ref="surface"
        :tracks="state.tracks"
        :get-content-generation="contentGeneration"
        :scroll-element="scrollElement"
        :virtualized="virtualized"
      >
        <template #head="{ rowIndex }">
          <tr :aria-rowindex="rowIndex">
            <th scope="col">选择</th>
            <th scope="col">音乐 / 作者</th>
            <th scope="col">时长</th>
            <th scope="col">操作</th>
          </tr>
        </template>
        <template #row="{ track, index, rowIndex }">
          <StudioTrackRow
            :aria-rowindex="rowIndex"
            :track="track"
            :index="index"
            :title="state.customNamesByTrackId.get(track.id) ?? track.title"
            :selected="selectedIds.has(track.id)"
            :invalid="invalidIds.has(track.id)"
            :favorite="favoriteIds.has(track.id)"
            :queued="queuedIds.has(track.id)"
            :current="state.currentTrackId === track.id"
            :download-busy="Boolean(state.downloadBusy)"
            @select="toggle(track.id)"
            @play="play(track.id)"
            @favorite="actions.toggleFavorite(track.id)"
            @queue="actions.toggleQueue(track.id)"
            @download="actions.download([track.id])"
            @actions="actions.showTrackActions(track.id)"
          />
        </template>
      </StudioCatalogTable>
    </div>
    <div v-if="preparing" class="studio-catalog-preparation">
      <LoadingSpinner label="正在加载歌曲" />
    </div>
    <p v-else-if="!state.tracks.length && !loading" role="status">暂无匹配歌曲。</p>
    <footer v-if="!preparing" class="studio-results__footer">
      <span>已加载 {{ drawer.loadedPageCount }} 页</span>
      <LoadingSpinner v-if="loading" label="正在加载歌曲" />
      <span v-else-if="!drawer.hasMore && !drawer.paginationLocked">已加载全部歌曲</span>
    </footer>
  </template>
</template>

<style scoped>
.studio-table-scroll--preparing {
  visibility: hidden;
}
.studio-catalog-preparation {
  position: absolute;
  inset-block-start: var(--am-space-4);
  inset-inline: 0;
  text-align: center;
}
</style>
