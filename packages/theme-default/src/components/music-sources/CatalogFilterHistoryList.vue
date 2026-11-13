<script setup lang="ts">
import { DEFAULT_CATALOG_FILTER_HISTORY_COLLAPSE_AFTER } from '@any-music/ui/catalog'
import type { CatalogFilterHistoryEntry } from '@any-music/ui/catalog'
import { getCatalogTrackFilterLabels } from '@any-music/ui/catalog'
import AppIcon from '@any-music/ui/components/AppIcon.vue'
import { computed, nextTick, shallowRef, useId, useTemplateRef, watch } from 'vue'

import CatalogFilterDateRange from './CatalogFilterDateRange.vue'

/** 历史整组恢复或删除；两个操作并列，区间逐行分隔，标签组按内容宽度流式换行。 */
const props = withDefaults(
  defineProps<{
    entries: readonly CatalogFilterHistoryEntry[]
    title: string
    collapseAfter?: number
    platformNames?: ReadonlyMap<string, string>
  }>(),
  { collapseAfter: DEFAULT_CATALOG_FILTER_HISTORY_COLLAPSE_AFTER },
)
const emit = defineEmits<{
  restore: [entry: CatalogFilterHistoryEntry]
  remove: [entry: CatalogFilterHistoryEntry]
  focusEmpty: []
}>()
const headingId = useId()
const root = useTemplateRef<HTMLElement>('root')
const isExpanded = shallowRef(false)
const isTagHistory = computed(() => props.entries[0]?.dimension === 'tags')
const items = computed(() =>
  props.entries.map((entry) => ({
    entry,
    key: JSON.stringify(entry),
    labels: getCatalogTrackFilterLabels(entry.filters, entry.dimension, props.platformNames),
  })),
)
const collapsedCount = computed(() => Math.max(1, Math.floor(props.collapseAfter)))
const hasOverflow = computed(() => items.value.length > collapsedCount.value)
const visibleItems = computed(() =>
  isExpanded.value ? items.value : items.value.slice(0, collapsedCount.value),
)

// 维度或折叠偏好变化后恢复紧凑展示；展开是本次编辑的临时展示状态。
watch([() => props.title, () => props.collapseAfter], () => {
  isExpanded.value = false
})

/** 等受控列表回流后聚焦相邻删除按钮；最后一组消失时由编辑器接回输入焦点。 */
async function handleRemove(entry: CatalogFilterHistoryEntry, index: number): Promise<void> {
  emit('remove', entry)
  await nextTick()
  const nextIndex = Math.min(index, visibleItems.value.length - 1)
  const adjacent = root.value?.querySelector<HTMLButtonElement>(
    `[data-history-remove="${nextIndex}"]`,
  )
  if (adjacent) adjacent.focus({ preventScroll: true })
  else emit('focusEmpty')
}
</script>

<template>
  <section ref="root" class="catalog-filter-history" :aria-labelledby="headingId">
    <h4 :id="headingId">{{ title }}</h4>
    <p v-if="items.length === 0">暂无历史记录</p>
    <div
      :id="`${headingId}-entries`"
      class="catalog-filter-history__entries"
      :class="{
        'catalog-filter-history__entries--expanded': isExpanded && hasOverflow,
        'catalog-filter-history__entries--tags': isTagHistory,
      }"
    >
      <div
        v-for="(item, itemIndex) in visibleItems"
        :key="item.key"
        class="catalog-filter-history__group"
        :class="{
          'catalog-filter-history__group--ranges':
            item.entry.dimension === 'published' || item.entry.dimension === 'duration',
        }"
      >
        <button
          class="catalog-filter-history__entry"
          :class="{
            'catalog-filter-history__entry--published': item.entry.dimension === 'published',
            'catalog-filter-history__entry--ranges':
              item.entry.dimension === 'published' || item.entry.dimension === 'duration',
            'catalog-filter-history__entry--tags': item.entry.dimension === 'tags',
          }"
          type="button"
          :aria-label="`恢复筛选 ${item.labels.join('；')}`"
          @click="emit('restore', item.entry)"
        >
          <template v-if="item.entry.dimension === 'published'">
            <CatalogFilterDateRange
              v-for="(range, index) in item.entry.filters.publishedRanges"
              :key="index"
              class="catalog-filter-history__range catalog-filter-history__date-range"
              :from="range.from"
              :to="range.to"
              :show-labels="false"
            />
          </template>
          <template v-else>
            <span
              v-for="(label, index) in item.labels"
              :key="index"
              :class="{
                'catalog-filter-history__range': item.entry.dimension === 'duration',
                'catalog-filter-history__tag': item.entry.dimension === 'tags',
              }"
              >{{ label }}</span
            >
          </template>
        </button>
        <button
          class="catalog-filter-history__remove"
          type="button"
          :data-history-remove="itemIndex"
          :aria-label="`删除历史筛选 ${item.labels.join('；')}`"
          title="删除这组历史"
          @click="handleRemove(item.entry, itemIndex)"
        >
          <AppIcon name="trash" :size="16" />
        </button>
      </div>
    </div>
    <button
      v-if="hasOverflow"
      class="catalog-filter-history__toggle"
      type="button"
      :aria-expanded="isExpanded"
      :aria-controls="`${headingId}-entries`"
      @click="isExpanded = !isExpanded"
    >
      {{ isExpanded ? '收起历史' : `展开其余 ${items.length - collapsedCount} 组` }}
    </button>
  </section>
</template>

<style scoped>
.catalog-filter-history {
  display: grid;
  align-content: start;
  gap: var(--am-space-2);
  padding-block-start: var(--am-space-4);
  border-block-start: 1px solid var(--am-color-border);
}
.catalog-filter-history h4 {
  margin: 0 0 var(--am-space-2);
  color: var(--am-color-text-secondary);
  font-size: var(--am-font-size-sm);
}
.catalog-filter-history p {
  margin: 0;
  color: var(--am-color-text-secondary);
  font-size: var(--am-font-size-xs);
}
.catalog-filter-history button {
  display: grid;
  align-content: center;
  gap: var(--am-space-1);
  min-block-size: 44px;
  padding: var(--am-space-2) var(--am-space-3);
  border: 1px solid var(--am-color-border);
  border-radius: var(--am-radius-control);
  background: transparent;
  color: var(--am-color-text);
  cursor: pointer;
  text-align: start;
  font: inherit;
  font-size: var(--am-font-size-sm);
  overflow-wrap: anywhere;
}
/* 删除按钮始终可见且至少 44px，作为恢复按钮的兄弟节点避免嵌套交互和误恢复。 */
.catalog-filter-history__group {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 44px;
  min-inline-size: 0;
  max-inline-size: 100%;
  border: 1px solid var(--am-color-border);
  border-radius: var(--am-radius-control);
  background: var(--am-color-surface);
}
.catalog-filter-history__group--ranges {
  background: var(--am-color-surface-subtle);
}
.catalog-filter-history .catalog-filter-history__entry {
  min-inline-size: 0;
  border: 0;
  border-radius: var(--am-radius-control) 0 0 var(--am-radius-control);
}
.catalog-filter-history .catalog-filter-history__remove {
  place-content: center;
  padding: 0;
  border: 0;
  border-inline-start: 1px solid var(--am-color-border);
  border-radius: 0 var(--am-radius-control) var(--am-radius-control) 0;
  color: var(--am-color-text-secondary);
}
/* 时间与时长共用中性组框和细线节奏，一眼区分独立区间与整组历史。 */
.catalog-filter-history .catalog-filter-history__entry--ranges {
  gap: 0;
  min-inline-size: 0;
  padding: var(--am-space-1) var(--am-space-3);
  background: transparent;
}
.catalog-filter-history__range {
  display: block;
  padding-block: var(--am-space-3);
  font-variant-numeric: tabular-nums;
}
.catalog-filter-history__range + .catalog-filter-history__range {
  border-block-start: 1px solid var(--am-color-border);
}
.catalog-filter-history__date-range {
  display: grid;
}
.catalog-filter-history__entries {
  display: grid;
  min-inline-size: 0;
  gap: var(--am-space-2);
}
/* Flex 换行保留阅读和键盘顺序；每组按内容占宽，长标签在组内换行而不撑开面板。 */
.catalog-filter-history__entries--tags {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  align-content: flex-start;
}
.catalog-filter-history .catalog-filter-history__entry--tags {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--am-space-1);
  max-inline-size: 100%;
  min-inline-size: 0;
  padding: var(--am-space-2);
  /* 组框保留主题表面色（浅色为白色），内层标签用浅底形成区域层次。 */
  background: transparent;
}
.catalog-filter-history__tag {
  min-inline-size: 0;
  padding: var(--am-space-1) var(--am-space-2);
  border: 1px solid var(--am-color-border);
  border-radius: var(--am-radius-detail);
  background: var(--am-color-surface-subtle);
  color: var(--am-color-text);
}
/* 展开后的历史在自身窗口内滚动，移动端仍能快速到达面板底部的确定操作。 */
.catalog-filter-history__entries--expanded {
  max-block-size: min(60dvh, 480px);
  overflow-y: auto;
  overscroll-behavior: contain;
}
.catalog-filter-history .catalog-filter-history__toggle {
  justify-self: start;
  border-color: transparent;
  color: var(--am-color-primary);
  font-weight: 700;
}
.catalog-filter-history button:hover {
  border-color: var(--am-color-primary);
  background: var(--am-color-primary-soft);
}
/* 删除沿用列表危险操作的柔和容器色，与蓝色恢复反馈区分并兼容浅深主题。 */
.catalog-filter-history .catalog-filter-history__remove:hover,
.catalog-filter-history .catalog-filter-history__remove:focus-visible,
.catalog-filter-history .catalog-filter-history__remove:active {
  border-color: var(--am-color-danger-container);
  background: var(--am-color-danger-container);
  color: var(--am-color-danger);
}
.catalog-filter-history button:focus-visible {
  outline: var(--am-focus-ring);
  outline-offset: -2px;
}
@container am-bottom-sheet (min-width: 761px) {
  /* 时间编辑器已有右列滚动窗口，展开历史共用它，避免出现套娃滚动区。 */
  .catalog-filter-history__entries--expanded:has(.catalog-filter-history__entry--published) {
    max-block-size: none;
    overflow-y: visible;
  }
}
</style>
