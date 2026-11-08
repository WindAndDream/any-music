<script setup lang="ts">
import AppDialog from '@any-music/ui/components/AppDialog.vue'
import { createPlaylistOverviewFilters, formatPlaylistTrackCountRange } from '@any-music/ui/library'
import type { PlaylistOverviewFilters } from '@any-music/ui/library'

const props = defineProps<{
  draft: PlaylistOverviewFilters | null
  resultCount: number
  totalCount: number
  disabled: boolean
}>()
const emit = defineEmits<{ 'update:draft': [value: PlaylistOverviewFilters | null]; apply: [] }>()
function keyword(event: Event) {
  if (props.draft)
    emit('update:draft', { ...props.draft, keyword: (event.target as HTMLInputElement).value })
}
function count(event: Event) {
  if (!props.draft) return
  const value = (event.target as HTMLSelectElement).value
  emit('update:draft', {
    ...props.draft,
    trackCountRanges:
      value === 'empty' ? [{ maxCount: 0 }] : value === 'populated' ? [{ minCount: 1 }] : [],
  })
}
function cover(event: Event) {
  if (!props.draft) return
  const value = (event.target as HTMLSelectElement).value
  emit('update:draft', {
    ...props.draft,
    cover: value === 'present' ? ['present'] : value === 'missing' ? ['missing'] : [],
  })
}
function countChoice() {
  const ranges = props.draft?.trackCountRanges ?? []
  if (!ranges.length) return 'all'
  if (ranges.length === 1 && ranges[0]?.maxCount === 0) return 'empty'
  if (ranges.length === 1 && ranges[0]?.minCount === 1 && ranges[0].maxCount === undefined)
    return 'populated'
  return 'custom'
}
</script>
<template>
  <AppDialog
    :open="draft !== null"
    title="歌单筛选器"
    :suspended="disabled"
    @close="emit('update:draft', null)"
  >
    <form v-if="draft" class="studio-playlist-filter" @submit.prevent="!disabled && emit('apply')">
      <label
        >文本搜索<input :value="draft.keyword" placeholder="搜索歌单名称或简介" @input="keyword"
      /></label>
      <label
        >歌曲数量<select :value="countChoice()" @change="count">
          <option value="all">全部歌单</option>
          <option value="empty">空歌单</option>
          <option value="populated">已有歌曲</option>
          <option v-if="countChoice() === 'custom'" value="custom" disabled>
            {{ draft.trackCountRanges.map(formatPlaylistTrackCountRange).join('、') }}
          </option>
        </select></label
      >
      <label
        >封面<select :value="draft.cover.length === 1 ? draft.cover[0] : 'all'" @change="cover">
          <option value="all">全部歌单</option>
          <option value="present">已设置封面</option>
          <option value="missing">未设置封面</option>
        </select></label
      >
      <p role="status">匹配 {{ resultCount }} / {{ totalCount }} 个歌单</p>
      <div class="studio-actions">
        <button type="button" @click="emit('update:draft', createPlaylistOverviewFilters())">
          重置筛选</button
        ><button type="button" @click="emit('update:draft', null)">取消</button
        ><button type="submit" :disabled="disabled">应用筛选</button>
      </div>
    </form>
  </AppDialog>
</template>
<style scoped>
.studio-playlist-filter,
.studio-playlist-filter label {
  display: grid;
  gap: var(--am-space-3);
}
.studio-playlist-filter input,
.studio-playlist-filter select {
  min-inline-size: 0;
  min-block-size: 44px;
  padding-inline: var(--am-space-3);
  border: 1px solid var(--am-color-border-strong);
  border-radius: var(--am-radius-control);
  background: var(--am-color-surface);
  color: var(--am-color-text);
  font: inherit;
}
.studio-playlist-filter :is(input, select):focus-visible {
  outline: var(--am-focus-ring);
  outline-offset: -3px;
}
</style>
