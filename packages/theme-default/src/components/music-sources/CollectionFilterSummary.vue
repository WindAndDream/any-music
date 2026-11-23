<script setup lang="ts" generic="T extends string">
import AppIcon from '@any-music/ui/components/AppIcon.vue'
import MusicListEmptyState from '@any-music/ui/components/music-sources/MusicListEmptyState.vue'
import { computed, useId } from 'vue'

/** Theme-owned filter summary; callers supply labels and retain all draft semantics. */
const props = defineProps<{
  groups: readonly { dimension: T; labels: readonly string[]; title: string }[]
}>()
const emit = defineEmits<{
  edit: [dimension: T, index: number]
  remove: [dimension: T, index: number]
}>()
const summaryId = useId()
const hasConditions = computed(() => props.groups.some((group) => group.labels.length > 0))
</script>

<template>
  <section class="catalog-filter-summary" aria-label="筛选条件">
    <MusicListEmptyState
      v-if="!hasConditions"
      class="catalog-filter-summary__empty-state"
      icon="filter"
      title="还没有筛选条件"
    />

    <template v-else>
      <section
        v-for="group in groups"
        :key="group.dimension"
        class="catalog-filter-summary__group"
        :aria-labelledby="`${summaryId}-${group.dimension}`"
      >
        <header class="catalog-filter-summary__group-heading">
          <strong :id="`${summaryId}-${group.dimension}`">{{ group.title }}</strong>
          <small v-if="group.labels.length > 0" class="catalog-filter-summary__group-count">
            {{ group.labels.length }} 项
          </small>
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
    </template>
  </section>
</template>

<style scoped>
.catalog-filter-summary {
  display: flex;
  min-block-size: 100%;
  min-inline-size: 0;
  flex-direction: column;
}

.catalog-filter-summary > .catalog-filter-summary__empty-state {
  min-block-size: 0;
  border: 0;
}

.catalog-filter-summary__group-empty {
  margin: 0;
  color: var(--am-color-text-secondary);
  font-size: var(--am-font-size-xs);
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
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--am-space-2);
}

.catalog-filter-summary__group-heading strong {
  font-size: var(--am-font-size-md);
  letter-spacing: -0.01em;
  line-height: 1.35;
}

.catalog-filter-summary__group-count {
  padding: 2px var(--am-space-2);
  border-radius: var(--am-radius-control);
  background: var(--am-color-primary-container);
  color: var(--am-color-text);
  font-size: var(--am-font-size-xs);
  font-weight: 650;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
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

.catalog-filter-summary__remove:hover,
.catalog-filter-summary__remove:focus-visible,
.catalog-filter-summary__remove:active {
  border-color: var(--am-color-danger-container);
  background: var(--am-color-danger-container);
  color: var(--am-color-danger);
}

.catalog-filter-summary button:focus-visible {
  outline: var(--am-focus-ring);
  outline-offset: -2px;
}
</style>
