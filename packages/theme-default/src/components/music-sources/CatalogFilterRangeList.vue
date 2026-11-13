<script setup lang="ts">
import AppIcon from '@any-music/ui/components/AppIcon.vue'
import { useId } from 'vue'

/** 区间内容本身是编辑入口；删除为独立按钮，避免嵌套按钮和点击冒泡误编辑。 */
defineProps<{ title: string; labels: readonly string[]; editingIndex?: number }>()
const emit = defineEmits<{ edit: [index: number]; remove: [index: number] }>()
const headingId = useId()
</script>

<template>
  <section class="catalog-range-list" :aria-labelledby="headingId">
    <h4 :id="headingId">
      {{ title }} <small>{{ labels.length }} 项</small>
    </h4>
    <p v-if="labels.length === 0">暂无已选区间</p>
    <div
      v-for="(label, index) in labels"
      :key="`${index}:${label}`"
      class="catalog-range-list__item"
    >
      <button
        type="button"
        class="catalog-range-list__edit"
        :data-range-edit="index"
        :aria-label="`编辑${label}`"
        :aria-pressed="index === editingIndex"
        @click="emit('edit', index)"
      >
        {{ label }}
      </button>
      <button
        type="button"
        class="catalog-range-list__remove"
        :aria-label="`删除${label}`"
        @click="emit('remove', index)"
      >
        <AppIcon name="close" :size="16" />
      </button>
    </div>
  </section>
</template>

<style scoped>
.catalog-range-list {
  display: grid;
  align-content: start;
  gap: var(--am-space-2);
}
.catalog-range-list h4 {
  display: flex;
  justify-content: space-between;
  gap: var(--am-space-2);
  margin: 0 0 var(--am-space-2);
  font-size: var(--am-font-size-sm);
}
.catalog-range-list small,
.catalog-range-list p {
  margin: 0;
  color: var(--am-color-text-secondary);
  font-size: var(--am-font-size-xs);
  font-weight: 400;
}
.catalog-range-list__item {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  border-inline-start: 2px solid var(--am-color-primary);
  border-radius: 0 var(--am-radius-control) var(--am-radius-control) 0;
  background: var(--am-color-surface-subtle);
}
.catalog-range-list button {
  min-block-size: 44px;
  border: 0;
  border-radius: var(--am-radius-control);
  background: transparent;
  color: var(--am-color-text);
  cursor: pointer;
  font: inherit;
  font-size: var(--am-font-size-sm);
}
.catalog-range-list__edit {
  padding: var(--am-space-2) var(--am-space-3);
  text-align: start;
  overflow-wrap: anywhere;
}
.catalog-range-list__edit[aria-pressed='true'],
.catalog-range-list button:hover {
  background: var(--am-color-primary-soft);
  color: var(--am-color-primary);
}
.catalog-range-list__remove {
  display: grid;
  inline-size: 44px;
  place-items: center;
}
/* 已选区间的删除沿用历史删除的危险色，不与编辑动作共用蓝色反馈。 */
.catalog-range-list .catalog-range-list__remove:hover,
.catalog-range-list .catalog-range-list__remove:focus-visible,
.catalog-range-list .catalog-range-list__remove:active {
  background: var(--am-color-danger-container);
  color: var(--am-color-danger);
}
.catalog-range-list button:focus-visible {
  outline: var(--am-focus-ring);
  outline-offset: -2px;
}
</style>
