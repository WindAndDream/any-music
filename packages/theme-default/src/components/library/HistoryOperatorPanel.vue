<script setup lang="ts">
import AppIcon from '@any-music/ui/components/AppIcon.vue'
import type { PlaybackHistoryTimeRange } from '@any-music/ui/library'
import { useActionFeedback } from '@any-music/ui/library'
import { useConfirmAction } from '@any-music/ui/library'
import { FILTERS_RESET_MESSAGE } from '@any-music/ui/library'
import { computed } from 'vue'

import { usePresentationActivity } from '../../composables/use-presentation-activity'

const props = defineProps<{
  platforms: readonly { id: string; label: string }[]
  resultCount: number
  totalCount: number
}>()

const emit = defineEmits<{
  clearHistory: []
}>()

const query = defineModel<string>('query', { required: true })
const platformId = defineModel<string>('platformId', { required: true })
const timeRange = defineModel<PlaybackHistoryTimeRange>('timeRange', { required: true })
const confirm = useConfirmAction()
const activity = usePresentationActivity()
const showFeedback = useActionFeedback()
const hasFilters = computed(
  () => Boolean(query.value.trim()) || platformId.value !== 'all' || timeRange.value !== 'all',
)

function resetFilters(): void {
  query.value = ''
  platformId.value = 'all'
  timeRange.value = 'all'
  showFeedback({ status: 'success', message: FILTERS_RESET_MESSAGE })
}

async function requestClearHistory(): Promise<void> {
  const isCurrent = activity.checkpoint()
  const confirmed = await confirm({
    title: '清空播放历史',
    message: '清空后无法撤销，但不会删除收藏、歌单或下载记录。',
    confirmLabel: '清空历史',
    tone: 'danger',
  })
  if (!confirmed || !isCurrent()) return
  emit('clearHistory')
}
</script>

<template>
  <form class="history-operator" @submit.prevent>
    <div class="history-operator__summary" aria-live="polite">
      <span><AppIcon name="history" />播放历史</span>
      <strong>{{ props.resultCount }} / {{ props.totalCount }}</strong>
    </div>

    <label class="history-operator__field history-operator__field--wide">
      <span>按名称或作者筛选</span>
      <input
        v-model="query"
        type="search"
        name="playback-history-query"
        autocomplete="off"
        placeholder="例如：歌曲或作者…"
      />
    </label>
    <label class="history-operator__field">
      <span>音乐平台</span>
      <select v-model="platformId" name="playback-history-platform">
        <option value="all">全部平台</option>
        <option v-for="platform in props.platforms" :key="platform.id" :value="platform.id">
          {{ platform.label }}
        </option>
      </select>
    </label>
    <label class="history-operator__field">
      <span>播放时间</span>
      <select v-model="timeRange" name="playback-history-time-range">
        <option value="all">全部时间</option>
        <option value="today">今天</option>
        <option value="week">最近 7 天</option>
        <option value="month">最近 30 天</option>
      </select>
    </label>

    <div class="history-operator__actions">
      <button type="button" :disabled="!hasFilters" @click="resetFilters">重置筛选</button>
      <button
        class="history-operator__danger"
        type="button"
        :disabled="props.totalCount === 0"
        @click="requestClearHistory"
      >
        清空全部历史
      </button>
    </div>
  </form>
</template>

<style scoped>
.history-operator {
  container: am-history-operator / inline-size;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--am-space-4);
}

.history-operator__summary,
.history-operator__actions {
  grid-column: 1 / -1;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--am-space-3);
}

.history-operator__summary {
  padding: var(--am-space-3) var(--am-space-4);
  border-radius: var(--am-radius-lg);
  background: var(--am-color-info-container);
  color: var(--am-color-info);
}

.history-operator__summary span {
  display: flex;
  align-items: center;
  gap: var(--am-space-2);
}

.history-operator__field {
  display: grid;
  gap: var(--am-space-2);
  color: var(--am-color-text-secondary);
  font-size: var(--am-font-size-xs);
}

.history-operator__field--wide {
  grid-column: 1 / -1;
}

.history-operator input,
.history-operator select {
  min-block-size: var(--am-size-control);
  padding-inline: var(--am-space-3);
  border: 1px solid var(--am-color-border-strong);
  border-radius: var(--am-radius-md);
  background: var(--am-color-surface);
  color: var(--am-color-text);
}

.history-operator__actions button {
  min-block-size: var(--am-size-control);
  padding-inline: var(--am-space-4);
  border: 1px solid var(--am-color-border);
  border-radius: var(--am-radius-md);
  background: var(--am-color-surface-subtle);
  color: var(--am-color-text);
  cursor: pointer;
}

.history-operator__actions .history-operator__danger {
  margin-inline-start: auto;
  border-color: transparent;
  background: var(--am-color-danger-container);
  color: var(--am-color-danger);
}

@container am-history-operator (max-width: 512px) {
  .history-operator {
    grid-template-columns: 1fr;
  }

  .history-operator__field--wide,
  .history-operator__summary,
  .history-operator__actions {
    grid-column: 1;
  }

  .history-operator__actions {
    align-items: stretch;
    flex-direction: column;
  }

  .history-operator__actions .history-operator__danger {
    margin-inline-start: 0;
  }
}
</style>
