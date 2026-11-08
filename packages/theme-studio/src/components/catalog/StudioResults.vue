<script setup lang="ts">
import { useEditingSession, useScrollPageLoader } from '@any-music/ui/catalog'
import TrackCardGrid from '@any-music/ui/components/music-sources/TrackCardGrid.vue'
import type { UiThemeFeatureMap, UiThemeHostSlots } from '@any-music/ui/theme'
import { useTemplateRef } from 'vue'

import StudioBatchActions from '../library/StudioBatchActions.vue'
import StudioDisplayControls from '../library/StudioDisplayControls.vue'
import StudioFilters from '../library/StudioFilters.vue'
import StudioStyledTrack from '../library/StudioStyledTrack.vue'
import StudioTrackRow from './StudioTrackRow.vue'
import { useStudioCatalog } from './use-studio-catalog'

const props = defineProps<{ feature: UiThemeFeatureMap['catalog'] }>()
defineSlots<UiThemeHostSlots>()
const {
  state,
  drawer,
  selectedIds,
  invalidIds,
  favoriteIds,
  queuedIds,
  allSelected,
  canLoadMore,
  toggle,
  toggleAll,
  openFilters,
  loadMore,
} = useStudioCatalog(props)
const listElement = useTemplateRef<HTMLElement>('listElement')
useScrollPageLoader({
  editing: useEditingSession(`pagination:${drawer.value?.id ?? 'empty'}`),
  listElement,
  hasMore: () => canLoadMore.value,
  loading: () => Boolean(drawer.value?.isLoading),
  pageNumber: () => drawer.value?.loadedPageCount ?? 0,
  visibleCount: () => state.value.tracks.length,
  loadedCount: () => drawer.value?.tracks.length ?? 0,
  loadNext: loadMore,
})
</script>

<template>
  <section class="studio-results" aria-label="歌曲结果" :aria-busy="drawer?.isLoading">
    <template v-if="drawer">
      <header class="studio-results__heading">
        <div>
          <p class="studio-eyebrow">{{ drawer.pluginName }}</p>
          <h2>{{ drawer.title }}</h2>
          <p>{{ drawer.input }}</p>
          <slot name="request-account" :drawer-id="drawer.id" />
          <p v-if="drawer.account" role="status">
            账号状态：{{ drawer.accountStatus ?? '状态未知' }}
          </p>
        </div>
        <button type="button" @click="feature.actions.closeDrawer">返回音乐列表</button>
      </header>
      <p v-if="drawer.errorMessage || drawer.invalidReason" role="alert">
        {{ drawer.errorMessage || drawer.invalidReason }}
      </p>
      <p v-if="!drawer.isSourceEnabled" role="status">音乐源不可用，已加载的歌曲仍可浏览。</p>
      <div class="studio-actions" role="group" aria-label="歌曲批量操作">
        <label class="studio-selection"
          ><input
            type="checkbox"
            aria-label="全选可见歌曲"
            :checked="allSelected"
            @change="toggleAll"
          />全选</label
        >
        <span>已选择 {{ state.selectedTrackIds.length }} 首</span>
        <StudioDisplayControls
          :state="state"
          :actions="feature.actions"
          :disabled="feature.availability.status !== 'available'"
        /><button type="button" @click="openFilters">筛选器</button>
      </div>
      <fieldset :disabled="feature.availability.status !== 'available'">
        <StudioFilters
          :state="state"
          :actions="feature.actions"
          :scope="`catalog:tracks:${drawer.id}`"
        />
        <StudioBatchActions
          :availability="feature.availability"
          :state="state"
          :actions="feature.actions"
          :scope="`catalog:tracks:${drawer.id}`"
        />
        <button type="button" @click="feature.actions.requestCreatePlaylist">创建歌单</button>
        <button
          type="button"
          :disabled="!state.selectedTrackIds.length"
          @click="feature.actions.restoreTrackNames(state.selectedTrackIds)"
        >
          恢复已选歌曲原名
        </button>
      </fieldset>
      <div
        ref="listElement"
        class="studio-table-scroll"
        role="region"
        aria-label="歌曲列表"
        tabindex="0"
        data-am-scroll-key="catalog:tracks"
      >
        <TrackCardGrid
          v-if="state.itemStyle && state.itemStyle !== 'default'"
          :display-mode="state.displayMode"
          :mobile-columns="state.mobileColumns"
        >
          <div v-for="track in state.tracks" :key="track.id" class="studio-minimal-cell">
            <StudioStyledTrack
              :item-style="state.itemStyle"
              :track="track"
              :custom-tags="state.customTagsByTrackId.get(track.id)"
              :title="state.customNamesByTrackId.get(track.id) ?? track.title"
              :invalid="invalidIds.has(track.id)"
              :selected="selectedIds.has(track.id)"
              selectable
              @select="toggle(track.id)"
              @play="
                feature.actions.play(
                  track.id,
                  state.tracks.map((item) => item.id),
                )
              "
              @actions="feature.actions.showTrackActions(track.id)"
            />
          </div>
        </TrackCardGrid>
        <table v-else class="studio-track-table">
          <caption>
            {{
              state.tracks.length
            }}
            首已加载歌曲
          </caption>
          <thead>
            <tr>
              <th scope="col">选择</th>
              <th scope="col">音乐 / 作者</th>
              <th scope="col">时长</th>
              <th scope="col">操作</th>
            </tr>
          </thead>
          <tbody>
            <StudioTrackRow
              v-for="(track, index) in state.tracks"
              :key="track.id"
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
              @play="
                feature.actions.play(
                  track.id,
                  state.tracks.map((item) => item.id),
                )
              "
              @favorite="feature.actions.toggleFavorite(track.id)"
              @queue="feature.actions.toggleQueue(track.id)"
              @download="feature.actions.download([track.id])"
              @actions="feature.actions.showTrackActions(track.id)"
            />
          </tbody>
        </table>
      </div>
      <p v-if="!state.tracks.length && !drawer.isLoading" role="status">暂无匹配歌曲。</p>
      <footer class="studio-results__footer">
        <span>已加载 {{ drawer.loadedPageCount }} 页</span>
        <span v-if="drawer.isLoading" role="status">正在加载…</span>
        <span v-else-if="!drawer.hasMore">已加载全部歌曲</span>
      </footer>
    </template>
    <p v-else role="status">从左侧音乐列表选择要浏览的结果。</p>
  </section>
</template>

<style scoped>
.studio-minimal-cell {
  min-inline-size: 0;
  container: am-track-card / inline-size;
}
</style>
