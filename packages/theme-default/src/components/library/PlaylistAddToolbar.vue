<script setup lang="ts">
import type { MusicPlaylist } from '@any-music/core'
import { shallowRef } from 'vue'

import CatalogPlaylistPickerDialog from '../music-sources/CatalogPlaylistPickerDialog.vue'

const props = withDefaults(
  defineProps<{
    playlists: readonly MusicPlaylist[]
    selectedCount: number
    areAllVisibleSelected: boolean
    areSomeVisibleSelected: boolean
    visibleCount: number
    /** 歌单内部只复用选择/下载能力，不显示“再次加入歌单”的目标选择器。 */
    canAddToPlaylist?: boolean
    /** 批量取消喜欢是“我的喜欢”的专属动作，其他复用此工具栏的列表保持隐藏。 */
    canUnfavorite?: boolean
    /** 音乐列表与“我的喜欢”复用同一批量下载入口。 */
    canDownload?: boolean
    downloadBusy?: boolean
  }>(),
  {
    // Vue 会把未传入的 Boolean prop 转成 false；这个 opt-out 开关必须显式默认为开启。
    canAddToPlaylist: true,
    canUnfavorite: false,
    canDownload: false,
    downloadBusy: false,
  },
)

const emit = defineEmits<{
  toggleAllVisible: []
  addToPlaylist: [playlistIds: readonly string[]]
  unfavoriteSelected: []
  downloadSelected: []
}>()

const playlistOpen = shallowRef(false)
function selectPlaylists(ids: readonly string[]) {
  if (!props.selectedCount) return
  emit('addToPlaylist', ids)
  playlistOpen.value = false
}
</script>

<template>
  <div class="playlist-add-toolbar">
    <label class="playlist-add-toolbar__select-all">
      <input
        type="checkbox"
        :checked="props.areAllVisibleSelected"
        :indeterminate="props.areSomeVisibleSelected"
        :disabled="props.visibleCount === 0"
        @change="emit('toggleAllVisible')"
      />
      全选匹配歌曲
    </label>
    <div class="playlist-add-toolbar__actions">
      <span class="playlist-add-toolbar__count">已选 {{ props.selectedCount }}</span>
      <button
        v-if="props.canAddToPlaylist !== false"
        class="playlist-add-toolbar__button"
        type="button"
        :disabled="props.selectedCount === 0"
        aria-haspopup="dialog"
        @click="playlistOpen = true"
      >
        加入歌单
      </button>
      <button
        v-if="props.canDownload"
        class="playlist-add-toolbar__button playlist-add-toolbar__button--download"
        type="button"
        :disabled="props.selectedCount === 0 || props.downloadBusy"
        @click="emit('downloadSelected')"
      >
        {{ props.downloadBusy ? '下载处理中…' : '下载已选' }}
      </button>
      <button
        v-if="props.canUnfavorite"
        class="playlist-add-toolbar__button playlist-add-toolbar__button--danger"
        type="button"
        :disabled="props.selectedCount === 0"
        @click="emit('unfavoriteSelected')"
      >
        批量取消喜欢
      </button>
    </div>
    <CatalogPlaylistPickerDialog
      :open="playlistOpen"
      :playlists="props.playlists"
      :selected-count="props.selectedCount"
      @close="playlistOpen = false"
      @select="selectPlaylists"
    />
  </div>
</template>
