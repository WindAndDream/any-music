<script setup lang="ts" generic="T extends string">
import AppIcon from '@any-music/ui/components/AppIcon.vue'
import { computed, useId } from 'vue'

import CatalogFilterPreview from './CatalogFilterPreview.vue'

/** Theme-owned filter summary; callers supply labels and retain all draft semantics. */
const props = defineProps<{
  groups: readonly { dimension: T; labels: readonly string[]; title: string }[]
  resultCount: number
  totalCount: number
  unit: string
  allLabel: string
  allDescription: string
}>()
const emit = defineEmits<{
  edit: [dimension: T, index: number]
  remove: [dimension: T, index: number]
  clear: []
}>()
const summaryId = useId()
const selectedCount = computed(() =>
  props.groups.reduce((count, group) => count + group.labels.length, 0),
)
</script>

<template>
  <section class="catalog-filter-summary" :aria-labelledby="`${summaryId}-title`">
    <header class="catalog-filter-summary__header">
      <div class="catalog-filter-summary__heading">
        <span>筛选概览</span>
        <h4 :id="`${summaryId}-title`" aria-live="polite">
          {{ selectedCount > 0 ? `已筛选 ${selectedCount} 项` : allLabel }}
        </h4>
      </div>
      <div class="catalog-filter-summary__header-meta">
        <CatalogFilterPreview :result-count="resultCount" :total-count="totalCount" :unit="unit" />
        <div class="catalog-filter-summary__header-actions">
          <small>{{ selectedCount > 0 ? '点击具体条件即可修改' : allDescription }}</small>
          <button v-if="selectedCount > 0" type="button" @click="emit('clear')">清空全部</button>
        </div>
      </div>
    </header>

    <div v-if="selectedCount === 0" class="catalog-filter-summary__empty-state">
      <span aria-hidden="true"><AppIcon name="filter" :size="22" /></span>
      <div>
        <strong>还没有筛选条件</strong>
        <p>从左侧选择一种筛选类型开始；在手机上，入口位于面板底部。</p>
      </div>
    </div>

    <div v-else class="catalog-filter-summary__groups">
      <section
        v-for="group in groups"
        :key="group.dimension"
        class="catalog-filter-summary__group"
        :aria-labelledby="`${summaryId}-${group.dimension}`"
      >
        <header class="catalog-filter-summary__group-heading">
          <div>
            <strong :id="`${summaryId}-${group.dimension}`">{{ group.title }}</strong>
            <small v-if="group.labels.length > 0">{{ group.labels.length }} 项</small>
          </div>
        </header>

        <p v-if="group.labels.length === 0" class="catalog-filter-summary__group-empty">
          此区域尚未设置条件
        </p>
        <div v-else class="catalog-filter-summary__items">
          <div
            v-for="(label, filterIndex) in group.labels"
            :key="`${group.dimension}:${label}:${filterIndex}`"
            class="catalog-filter-summary__item"
          >
            <button
              type="button"
              class="catalog-filter-summary__edit"
              :data-filter-edit="`${group.dimension}:${filterIndex}`"
              :aria-label="`编辑${group.title}条件 ${label}`"
              @click="emit('edit', group.dimension, filterIndex)"
            >
              {{ label }}
            </button>
            <button
              type="button"
              class="catalog-filter-summary__remove"
              :aria-label="`删除${group.title}条件 ${label}`"
              @click="emit('remove', group.dimension, filterIndex)"
            >
              <AppIcon name="close" :size="14" />
            </button>
          </div>
        </div>
      </section>
    </div>
  </section>
</template>

<style scoped>
.catalog-filter-summary {
  display: grid;
  min-inline-size: 0;
  align-content: start;
  gap: var(--am-space-4);
}

.catalog-filter-summary__header {
  display: flex;
  flex-wrap: wrap;
  align-items: start;
  justify-content: space-between;
  gap: var(--am-space-4);
}

.catalog-filter-summary__heading {
  min-inline-size: 0;
}

.catalog-filter-summary__heading > span {
  color: var(--am-color-primary);
  font-size: var(--am-font-size-xs);
  font-weight: 750;
  letter-spacing: 0.08em;
}

.catalog-filter-summary__heading h4 {
  margin: var(--am-space-1) 0 0;
  font-size: var(--am-font-size-xl);
}

.catalog-filter-summary__group-heading small,
.catalog-filter-summary__group-empty {
  color: var(--am-color-text-secondary);
  font-size: var(--am-font-size-xs);
}

.catalog-filter-summary__header-meta {
  display: grid;
  justify-items: end;
  gap: var(--am-space-2);
  max-inline-size: 100%;
  margin-inline-start: auto;
  text-align: end;
}

.catalog-filter-summary__header-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: var(--am-space-3);
}

.catalog-filter-summary__header-actions > small {
  min-inline-size: 0;
  color: var(--am-color-text-secondary);
  font-size: var(--am-font-size-xs);
  overflow-wrap: anywhere;
}

.catalog-filter-summary__header-actions > button {
  /* 概览标题旁保持紧凑视觉高度；触摸热区在下方独立扩展。 */
  position: relative;
  min-block-size: 32px;
  flex: 0 0 auto;
  padding-inline: var(--am-space-3);
  border: 1px solid var(--am-color-border-strong);
  border-radius: var(--am-radius-control);
  background: var(--am-color-surface);
  color: var(--am-color-danger);
  cursor: pointer;
  font: inherit;
  font-size: var(--am-font-size-xs);
  font-weight: 700;
}

@media (pointer: coarse) {
  .catalog-filter-summary__header-actions > button::after {
    content: '';
    position: absolute;
    inset: -6px 0;
  }
}

.catalog-filter-summary__empty-state {
  display: flex;
  align-items: center;
  gap: var(--am-space-3);
  min-block-size: 120px;
  padding: var(--am-space-5);
  border: 1px dashed var(--am-color-border-strong);
  border-radius: var(--am-radius-panel);
  background: var(--am-color-surface-subtle);
}

.catalog-filter-summary__empty-state > span {
  display: grid;
  inline-size: 44px;
  block-size: 44px;
  flex: 0 0 auto;
  place-items: center;
  border-radius: var(--am-radius-sm);
  background: var(--am-color-primary-soft);
  color: var(--am-color-primary);
}

.catalog-filter-summary__empty-state p {
  margin: var(--am-space-1) 0 0;
  color: var(--am-color-text-secondary);
  font-size: var(--am-font-size-sm);
  line-height: 1.6;
}

.catalog-filter-summary__groups {
  display: grid;
  gap: 0;
  border-block: 1px solid var(--am-color-border);
}

.catalog-filter-summary__group {
  display: grid;
  min-inline-size: 0;
  gap: var(--am-space-3);
  padding-block: var(--am-space-4);
}

.catalog-filter-summary__group + .catalog-filter-summary__group {
  border-block-start: 1px solid var(--am-color-border);
}

.catalog-filter-summary__group-heading {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  min-inline-size: 0;
  align-items: center;
  gap: var(--am-space-3);
}

.catalog-filter-summary__group-heading > div {
  display: grid;
  min-inline-size: 0;
  gap: 2px;
}

.catalog-filter-summary__group-heading strong {
  font-size: var(--am-font-size-md);
  letter-spacing: -0.01em;
  line-height: 1.35;
}

.catalog-filter-summary__group-empty {
  margin: 0;
}

.catalog-filter-summary__items {
  display: grid;
  gap: var(--am-space-2);
}

.catalog-filter-summary__item {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  min-inline-size: 0;
  align-items: center;
  gap: var(--am-space-2);
  min-block-size: 42px;
  border-inline-start: 2px solid var(--am-color-primary);
  border-radius: 0 var(--am-radius-control) var(--am-radius-control) 0;
  background: var(--am-color-surface-subtle);
  color: var(--am-color-text);
  font-size: var(--am-font-size-sm);
}

.catalog-filter-summary__remove {
  display: grid;
  inline-size: 40px;
  block-size: 40px;
  place-items: center;
  padding: 0;
  border: 0;
  border-radius: var(--am-radius-control);
  background: transparent;
  color: var(--am-color-text-secondary);
  cursor: pointer;
}

/* 内容按钮占满剩余宽度，保留文本选择并支持触摸、键盘直接进入指定条目。 */
.catalog-filter-summary__edit {
  min-inline-size: 0;
  min-block-size: 44px;
  padding: var(--am-space-2) var(--am-space-3);
  border: 0;
  /* 条件文字的整块热区使用直角矩形反馈，避免短搜索词悬停时呈胶囊形。 */
  border-radius: 0;
  background: transparent;
  color: inherit;
  cursor: pointer;
  text-align: start;
  font: inherit;
  overflow-wrap: anywhere;
}

.catalog-filter-summary__edit:hover {
  background: var(--am-color-primary-soft);
  color: var(--am-color-primary);
}

/* 单项删除与清空全部复用项目危险提示的柔和底色和红色前景。 */
.catalog-filter-summary__remove:hover,
.catalog-filter-summary__remove:focus-visible,
.catalog-filter-summary__remove:active,
.catalog-filter-summary__header-actions > button:hover,
.catalog-filter-summary__header-actions > button:focus-visible,
.catalog-filter-summary__header-actions > button:active {
  border-color: var(--am-color-danger-container);
  background: var(--am-color-danger-container);
  color: var(--am-color-danger);
}

.catalog-filter-summary button:focus-visible {
  outline: var(--am-focus-ring);
  outline-offset: var(--am-focus-offset);
}

@container am-bottom-sheet (max-width: 760px) {
  .catalog-filter-summary__header-actions {
    align-items: flex-end;
    flex-direction: column;
    gap: var(--am-space-1);
    text-align: end;
  }

  .catalog-filter-summary__empty-state {
    padding: var(--am-space-4);
  }
}
</style>
