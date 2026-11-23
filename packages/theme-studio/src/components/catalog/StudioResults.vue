<script setup lang="ts">
import {
  canRefreshCatalogDrawer,
  countCatalogTrackFilters,
  useCatalogViewportOverlay,
} from '@any-music/ui/catalog'
import type { UiThemeFeatureMap, UiThemeHostSlots } from '@any-music/ui/theme'
import { computed, shallowRef } from 'vue'

import StudioBatchActions from '../library/StudioBatchActions.vue'
import StudioDisplayControls from '../library/StudioDisplayControls.vue'
import StudioFilters from '../library/StudioFilters.vue'
import StudioCatalogTracks from './StudioCatalogTracks.vue'
import { useStudioCatalog } from './use-studio-catalog'

defineSlots<UiThemeHostSlots>()
const props = defineProps<{ feature: UiThemeFeatureMap['catalog'] }>()
const { state, drawer, allSelected, toggleAll, openFilters, canLoadMore } = useStudioCatalog(props)
const nativeReady = shallowRef(false)
const reserveViewport = shallowRef(false)
const viewportKey = computed(() => `${drawer.value?.id}:${drawer.value?.refreshRevision ?? 0}`)
const preparedViewport = shallowRef<string>()
const prepareViewport = computed(
  () =>
    drawer.value?.pluginId === 'douyin' &&
    drawer.value.isSourceEnabled &&
    !drawer.value.paginationLocked &&
    countCatalogTrackFilters(state.value.filters).total === 0,
)
const displayOpen = shallowRef(false)
const { openOverlay, registerOverlayOpener } = useCatalogViewportOverlay()
function setNativeReady(ready: boolean) {
  if (ready) reserveViewport.value = true
  nativeReady.value = ready
}
function showTrackActions(id: string): void {
  props.feature.actions.showTrackActions(id)
}
const trackActions = computed(() => ({
  ...props.feature.actions,
  showTrackActions: (id: string) => openOverlay(() => showTrackActions(id)),
}))
function setDisplayOpen(open: boolean): void {
  if (open) openOverlay(() => (displayOpen.value = true))
  else displayOpen.value = false
}
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
        <div class="studio-actions">
          <button type="button" @click="feature.actions.closeDrawer">返回音乐列表</button>
          <button
            type="button"
            :disabled="
              !canRefreshCatalogDrawer(drawer) || feature.availability.status !== 'available'
            "
            @click="feature.actions.refresh(drawer.id)"
          >
            刷新
          </button>
        </div>
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
          :open="displayOpen"
          :state="state"
          :actions="feature.actions"
          :disabled="feature.availability.status !== 'available'"
          @update:open="setDisplayOpen"
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
        :key="viewportKey"
        class="studio-catalog-tracks"
        :class="{ 'studio-catalog-tracks--native': reserveViewport || prepareViewport }"
      >
        <slot
          v-if="!prepareViewport || preparedViewport === viewportKey"
          name="catalog-viewport"
          :drawer="drawer"
          :selectable="true"
          :suspended="displayOpen"
          :set-ready="setNativeReady"
          :register-overlay-opener="registerOverlayOpener"
          :show-track-actions="showTrackActions"
        />
        <StudioCatalogTracks
          v-if="!nativeReady"
          :state="state"
          :actions="trackActions"
          :drawer="drawer"
          :loaded-track-count="drawer.tracks.length"
          :can-load-more="canLoadMore"
          :prepare-viewport="prepareViewport"
          :prefetch="drawer.pluginId === 'douyin'"
          @viewport-ready="preparedViewport = viewportKey"
        />
      </div>
    </template>
    <p v-else role="status">从左侧音乐列表选择要浏览的结果。</p>
  </section>
</template>
