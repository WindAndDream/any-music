<script setup lang="ts">
defineProps<{
  concurrency: number
  downloadedCount: number
  compact?: boolean
}>()
</script>

<template>
  <span class="download-summary" :class="{ 'download-summary--compact': compact }">
    <span class="download-summary__item" :aria-label="`下载并发 ${concurrency}`"
      ><strong>{{ concurrency }}</strong> 并发</span
    >
    <span class="download-summary__separator" aria-hidden="true">·</span>
    <span class="download-summary__item" :aria-label="`${downloadedCount} 已下载`"
      ><strong>{{ downloadedCount }}</strong> 已下载</span
    >
  </span>
</template>

<style scoped>
.download-summary {
  display: inline-flex;
  flex-wrap: wrap;
  align-items: baseline;
  column-gap: var(--am-space-2);
  row-gap: var(--am-space-1);
  padding: var(--am-space-1) var(--am-space-2);
  border-radius: var(--am-radius-control);
  background: var(--am-color-primary-container);
  color: var(--am-color-primary);
  font-size: var(--am-font-size-sm);
  font-weight: 650;
  font-variant-numeric: tabular-nums;
}
.download-summary__item {
  display: inline-flex;
  align-items: baseline;
  gap: var(--am-space-1);
  white-space: nowrap;
}
.download-summary__item strong {
  font-size: var(--am-font-size-lg);
  font-weight: 750;
}
.download-summary__separator {
  opacity: 0.5;
}
.download-summary--compact {
  justify-content: flex-end;
  column-gap: var(--am-space-1);
  font-size: var(--am-font-size-xs);
}
.download-summary--compact .download-summary__item strong {
  font-size: var(--am-font-size-sm);
}
</style>
