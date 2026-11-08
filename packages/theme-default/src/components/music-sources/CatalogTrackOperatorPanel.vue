<script setup lang="ts">
import type { Track } from '@any-music/core'
import AppIcon from '@any-music/ui/components/AppIcon.vue'
import ContributionActions from '@any-music/ui/components/plugins/ContributionActions.vue'
import { shallowRef } from 'vue'

import { useClassicOverlays } from '../../composables/use-classic-overlays'
import CatalogOperatorPanel from './CatalogOperatorPanel.vue'

/** 底部操作条只发出批量意图；选择集合、确认流程和资料库写入仍由歌曲页容器拥有。 */
const props = withDefaults(
  defineProps<{
    context?: 'tracks' | 'queue' | 'favorites'
    selectedTracks?: readonly Track[]
    selectedCount: number
    visibleCount: number
    areAllVisibleSelected: boolean
    areSomeVisibleSelected: boolean
    areAllSelectedFavorited?: boolean
    areAllSelectedQueued?: boolean
    downloadBusy: boolean
    hasSelectedCustomNames?: boolean
    canAddToPlaylist?: boolean
    countUnit?: string
  }>(),
  {
    context: 'tracks',
    areAllSelectedFavorited: false,
    areAllSelectedQueued: false,
    hasSelectedCustomNames: false,
    canAddToPlaylist: true,
  },
)

const emit = defineEmits<{
  toggleAllVisible: []
  addToPlaylist: []
  addSelectedToQueue: []
  downloadSelected: []
  addSelectedToFavorites: []
  restoreNames: []
  removeSelected: []
}>()
defineSlots<{ extensions?: (context: { selectedCount: number }) => unknown }>()
const tagDialogOpen = shallowRef(false)
const overlays = useClassicOverlays(() => tagDialogOpen.value)
</script>

<template>
  <CatalogOperatorPanel
    :selected-count="props.selectedCount"
    :visible-count="props.visibleCount"
    :all-selected="props.areAllVisibleSelected"
    :some-selected="props.areSomeVisibleSelected"
    :select-all-label="`全选当前 ${props.visibleCount} ${props.countUnit === '条' ? '条匹配播放记录' : '首匹配歌曲'}`"
    :count-unit="props.countUnit"
    @toggle-all="emit('toggleAllVisible')"
  >
    <button
      class="catalog-actions__playlist"
      type="button"
      aria-label="将已选歌曲加入歌单"
      :disabled="props.selectedCount === 0 || !props.canAddToPlaylist"
      @click="emit('addToPlaylist')"
    >
      <AppIcon name="playlist" :size="18" />
      <span>加入歌单</span>
      <small>加入歌单</small>
    </button>
    <button
      v-if="props.context !== 'tracks'"
      class="catalog-actions__remove"
      type="button"
      :aria-label="props.context === 'favorites' ? '将已选歌曲移出我的喜欢' : '将已选歌曲移出待听'"
      :disabled="props.selectedCount === 0"
      @click="emit('removeSelected')"
    >
      <AppIcon name="trash" :size="18" />
      <span>{{ props.context === 'favorites' ? '移出喜欢' : '移出待听' }}</span>
      <small>{{ props.context === 'favorites' ? '移出喜欢' : '移出待听' }}</small>
    </button>
    <button
      type="button"
      :aria-label="props.downloadBusy ? '下载处理中…' : '下载已选歌曲'"
      :disabled="props.selectedCount === 0 || props.downloadBusy"
      @click="emit('downloadSelected')"
    >
      <AppIcon name="download" :size="18" />
      <span>{{ props.downloadBusy ? '下载处理中…' : '下载已选' }}</span>
      <small>{{ props.downloadBusy ? '处理中…' : '下载' }}</small>
    </button>
    <button
      v-if="!props.areAllSelectedQueued"
      type="button"
      aria-label="按勾选顺序添加已选歌曲到待听"
      :disabled="props.selectedCount === 0"
      @click="emit('addSelectedToQueue')"
    >
      <AppIcon name="queue" :size="18" />
      <span>添加待听</span>
      <small>添加待听</small>
    </button>
    <button
      v-if="!props.areAllSelectedFavorited"
      type="button"
      aria-label="将已选歌曲添加到我的喜欢"
      :disabled="props.selectedCount === 0"
      @click="emit('addSelectedToFavorites')"
    >
      <AppIcon name="heart" :size="18" />
      <span>添加喜欢</span>
      <small>添加喜欢</small>
    </button>
    <button
      v-if="props.hasSelectedCustomNames"
      type="button"
      aria-label="恢复已选歌曲的原名"
      @click="emit('restoreNames')"
    >
      <AppIcon name="refresh" :size="18" />
      <span>恢复原名</span>
      <small>恢复原名</small>
    </button>
    <ContributionActions
      point="trackList.operator.actions"
      :context="{
        selectionCount: props.selectedTracks?.length ?? props.selectedCount,
        selectedTracks: props.selectedTracks,
      }"
      :disabled="props.selectedCount === 0"
      :overlay-target="overlays?.modalTarget.value"
      @dialog-open-change="tagDialogOpen = $event"
    />
    <slot name="extensions" :selected-count="props.selectedCount" />
  </CatalogOperatorPanel>
</template>
