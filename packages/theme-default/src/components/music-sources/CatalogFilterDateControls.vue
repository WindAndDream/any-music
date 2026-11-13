<script setup lang="ts">
/** 日期阶段与加入动作的受控操作栏；使用显式原生按钮让 scoped 样式和按下语义一致。 */
const props = withDefaults(
  defineProps<{
    stage: 'start' | 'end'
    /** 设置结束或载入已有结束日期后才显示提交操作，切回起始时保留。 */
    hasEndDate: boolean
    canAddRange: boolean
    isEditing?: boolean
  }>(),
  { isEditing: false },
)
const emit = defineEmits<{ selectStage: [stage: 'start' | 'end']; addRange: [] }>()
</script>

<template>
  <div class="catalog-date-controls" role="group" aria-label="日期端点与时间段操作">
    <button
      class="catalog-date-controls__stage"
      type="button"
      aria-label="设置起始日期"
      :aria-pressed="props.stage === 'start'"
      @click="emit('selectStage', 'start')"
    >
      设置起始
    </button>
    <button
      class="catalog-date-controls__stage"
      type="button"
      aria-label="设置结束日期"
      :aria-pressed="props.stage === 'end'"
      @click="emit('selectStage', 'end')"
    >
      设置结束
    </button>
    <button
      v-if="props.hasEndDate"
      class="catalog-date-controls__add"
      type="button"
      :disabled="!props.canAddRange"
      @click="emit('addRange')"
    >
      {{ props.isEditing ? '更新时间段' : '加入时间段' }}
    </button>
  </div>
</template>

<style scoped>
.catalog-date-controls {
  display: flex;
  align-items: center;
  gap: var(--am-space-1);
  min-inline-size: 0;
}
.catalog-date-controls button {
  min-inline-size: 0;
  min-block-size: 44px;
  padding: var(--am-space-2);
  border: 1px solid var(--am-color-border);
  border-radius: var(--am-radius-control);
  background: var(--am-color-surface);
  color: var(--am-color-text-secondary);
  cursor: pointer;
  font: inherit;
  font-size: var(--am-font-size-sm);
  white-space: nowrap;
}
.catalog-date-controls__stage:hover,
.catalog-date-controls__stage[aria-pressed='true'] {
  border-color: var(--am-color-primary);
  background: var(--am-color-primary-soft);
  color: var(--am-color-primary);
}
.catalog-date-controls__stage[aria-pressed='true'] {
  font-weight: 700;
}
/* 阶段入口保持靠左；加入操作出现后贴齐右边缘，不推移前两个按钮。 */
.catalog-date-controls .catalog-date-controls__add {
  margin-inline-start: auto;
  border-color: var(--am-color-primary);
  background: var(--am-color-primary);
  color: var(--am-color-on-primary);
  font-weight: 700;
}
.catalog-date-controls__add:disabled {
  opacity: 0.45;
  cursor: default;
}
.catalog-date-controls button:focus-visible {
  outline: var(--am-focus-ring);
  outline-offset: -2px;
}
</style>
