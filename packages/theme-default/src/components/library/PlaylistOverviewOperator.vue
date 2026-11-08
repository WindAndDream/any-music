<script setup lang="ts">
import AppIcon from '@any-music/ui/components/AppIcon.vue'
import SidePanel from '@any-music/ui/components/SidePanel.vue'

import CatalogOperatorPanel from '../music-sources/CatalogOperatorPanel.vue'

defineProps<{
  open: boolean
  suspended: boolean
  selectedCount: number
  visibleCount: number
  trackCount: number
  allSelected: boolean
  downloadBusy: boolean
}>()
defineEmits<{ close: []; toggleAll: []; enqueue: []; download: []; remove: [] }>()
</script>
<template>
  <SidePanel
    :open="open"
    title="歌单操作器"
    stacked-actions
    :suspended="suspended"
    @close="$emit('close')"
  >
    <CatalogOperatorPanel
      :selected-count="selectedCount"
      :visible-count="visibleCount"
      :all-selected="allSelected"
      :some-selected="selectedCount > 0 && !allSelected"
      :select-all-label="`全选当前 ${visibleCount} 个匹配歌单`"
      count-unit="个"
      :disabled="suspended"
      @toggle-all="$emit('toggleAll')"
    >
      <button
        type="button"
        aria-label="加入待听"
        :disabled="!trackCount || suspended"
        @click="$emit('enqueue')"
      >
        <AppIcon name="queue" :size="18" /><span>加入待听</span><small>待听</small>
      </button>
      <button
        type="button"
        aria-label="下载歌单歌曲"
        :disabled="!trackCount || suspended || downloadBusy"
        @click="$emit('download')"
      >
        <AppIcon name="download" :size="18" /><span>下载歌曲</span><small>下载</small>
      </button>
      <button
        class="catalog-actions__remove"
        type="button"
        aria-label="删除已选歌单"
        :disabled="!selectedCount || suspended"
        @click="$emit('remove')"
      >
        <AppIcon name="trash" :size="18" /><span>删除歌单</span><small>删除</small>
      </button>
    </CatalogOperatorPanel>
  </SidePanel>
</template>

<style scoped>
/* Explicit labels keep the operator's bold weight when slotted into the scrolling rail. */
button > :is(span, small) {
  font-weight: 700;
}
</style>
