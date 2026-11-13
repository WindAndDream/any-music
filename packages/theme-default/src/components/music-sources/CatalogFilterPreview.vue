<script setup lang="ts">
/** 概览和维度编辑共用匹配数展示；数量由外层使用正式歌曲筛选规则计算。 */
withDefaults(
  defineProps<{
    resultCount: number
    totalCount: number
    unit?: string
  }>(),
  { unit: '首' },
)
</script>

<template>
  <div class="catalog-filter-summary__preview" aria-live="polite" aria-atomic="true">
    <span>筛选预览</span>
    <strong>{{ resultCount }} / {{ totalCount }} {{ unit }}</strong>
  </div>
</template>

<style scoped>
.catalog-filter-summary__preview {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: flex-end;
  gap: var(--am-space-2);
  min-inline-size: 0;
  text-align: end;
}

.catalog-filter-summary__preview > span {
  color: var(--am-color-text-secondary);
  font-size: var(--am-font-size-xs);
}

.catalog-filter-summary__preview > strong {
  font-size: var(--am-font-size-md);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
</style>
