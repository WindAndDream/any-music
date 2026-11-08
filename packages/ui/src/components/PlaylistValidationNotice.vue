<script setup lang="ts">
import { computed, shallowRef, watch } from 'vue'

import type { UiPlaylistValidation } from '../theme'
import AppDialog from './AppDialog.vue'
import AppIcon from './AppIcon.vue'

/** Controlled playlist feedback, with the same compact summary/details pattern as Discover. */
const props = defineProps<{ validation?: UiPlaylistValidation }>()
defineEmits<{ retry: [] }>()
const detailsOpen = shallowRef(false)
const issues = computed(() => props.validation?.issues ?? [])
const failedCount = computed(() => new Set(issues.value.map(({ trackId }) => trackId)).size)
const codes = computed(() =>
  [...new Set(issues.value.map(({ error }) => error.statusCode))].join(' · '),
)
function reason(code: string) {
  if (['network-error', 'request-timeout', 'request-aborted'].includes(code)) return '网络错误'
  if (code === 'not-found') return '歌曲不存在或已下架'
  if (code === 'access-denied') return '无权访问'
  if (code === 'not-authenticated' || code === 'account-unavailable') return '账号不可用'
  if (code === 'verification-required') return '需要平台验证'
  if (code === 'rate-limited') return '请求过于频繁'
  if (code === 'media-unavailable') return '歌曲或音乐源暂不可用'
  if (code === 'source-not-found') return '歌曲配方依赖缺失'
  return '歌曲检查失败'
}
watch(
  () => props.validation?.status,
  (status) => {
    if (status === 'idle') detailsOpen.value = false
  },
)
</script>

<template>
  <div v-if="issues.length" class="playlist-validation" role="alert">
    <button
      type="button"
      aria-haspopup="dialog"
      title="点击查看错误详情"
      @click="detailsOpen = true"
    >
      <AppIcon name="warning" :size="16" />
      <span
        >{{ failedCount }} 首歌曲未通过检查 · {{ codes }} ·
        {{ reason(issues[0]!.error.code) }}</span
      >
    </button>
    <button type="button" :disabled="validation?.status === 'checking'" @click="$emit('retry')">
      重新检查
    </button>
  </div>
  <AppDialog
    :open="detailsOpen && issues.length > 0"
    title="歌单歌曲检查"
    size="compact"
    @close="detailsOpen = false"
  >
    <ul class="playlist-validation__details">
      <li v-for="(issue, index) in issues" :key="`${issue.trackId}:${index}`">
        <strong>{{ issue.title }}</strong>
        <span>{{ issue.error.statusCode }} · {{ reason(issue.error.code) }}</span>
        <p>{{ issue.error.message }}</p>
      </li>
    </ul>
  </AppDialog>
</template>

<style scoped>
.playlist-validation {
  display: flex;
  align-items: center;
  gap: var(--am-space-2);
  padding: var(--am-space-2) var(--am-space-3);
  border: 1px solid var(--am-color-danger);
  border-radius: var(--am-radius-control);
  background: var(--am-color-danger-container);
  color: var(--am-color-danger);
}
.playlist-validation button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--am-space-2);
  min-block-size: 44px;
  min-inline-size: 0;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: var(--am-font-size-sm);
  cursor: pointer;
}
.playlist-validation button:first-child {
  flex: 1;
  justify-content: start;
  text-align: start;
}
.playlist-validation button:last-child {
  flex-shrink: 0;
}
.playlist-validation button > .app-icon {
  flex-shrink: 0;
}
.playlist-validation button:focus-visible {
  outline: var(--am-focus-ring);
  outline-offset: -2px;
}
.playlist-validation button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.playlist-validation__details {
  display: grid;
  gap: var(--am-space-4);
  margin: 0;
  padding: 0;
  list-style: none;
}
.playlist-validation__details li {
  display: grid;
  gap: var(--am-space-2);
  overflow-wrap: anywhere;
}
.playlist-validation__details span {
  color: var(--am-color-danger);
}
.playlist-validation__details p {
  margin: 0;
}
</style>
