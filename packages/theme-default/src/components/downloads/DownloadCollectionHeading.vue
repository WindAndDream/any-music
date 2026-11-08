<script setup lang="ts">
import DownloadSummary from './DownloadSummary.vue'

defineProps<{
  concurrency: number
  downloadedCount: number
  mobileLayout: boolean
}>()
</script>

<template>
  <header v-if="!mobileLayout" class="download-heading">
    <div class="download-heading__title">
      <h2>下载</h2>
      <DownloadSummary :concurrency="concurrency" :downloaded-count="downloadedCount" />
    </div>
    <p>集中管理下载任务，支持暂停、继续与失败重试。</p>
  </header>
</template>

<style scoped>
.download-heading {
  display: grid;
  gap: var(--am-space-2);
  margin-block-end: var(--am-space-3);
}
.download-heading__title {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--am-space-3);
  min-block-size: 44px;
}
.download-heading h2,
.download-heading p {
  margin: 0;
}
.download-heading h2 {
  font-size: var(--am-font-size-md);
}
.download-heading p {
  color: var(--am-color-text-secondary);
  font-size: var(--am-font-size-xs);
  line-height: 1.6;
}
</style>
