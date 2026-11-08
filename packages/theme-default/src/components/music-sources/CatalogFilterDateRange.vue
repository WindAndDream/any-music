<script setup lang="ts">
import AppIcon from '@any-music/ui/components/AppIcon.vue'

/** 日期摘要仅上抛端点切换；当前草稿显式启用按钮，历史默认只读，避免恢复按钮内嵌套交互。 */
const props = withDefaults(
  defineProps<{
    from: string
    to: string
    prominent?: boolean
    showLabels?: boolean
    activeStage?: 'start' | 'end'
    interactive?: boolean
  }>(),
  { prominent: false, showLabels: true, activeStage: undefined, interactive: false },
)
const emit = defineEmits<{ selectStage: [stage: 'start' | 'end'] }>()

function selectStage(stage: 'start' | 'end'): void {
  if (props.interactive) emit('selectStage', stage)
}
</script>

<template>
  <span class="catalog-date-range" :class="{ 'catalog-date-range--prominent': props.prominent }">
    <component
      :is="props.interactive ? 'button' : 'span'"
      class="catalog-date-range__endpoint"
      :class="{ 'is-active': props.activeStage === 'start' }"
      :type="props.interactive ? 'button' : undefined"
      :aria-label="props.interactive ? '设置起始日期' : undefined"
      :aria-pressed="props.interactive ? props.activeStage === 'start' : undefined"
      @click="selectStage('start')"
    >
      <span v-if="props.showLabels" class="catalog-date-range__label"
        >起始
        <span
          v-if="props.prominent && props.activeStage === 'start'"
          class="catalog-date-range__status"
          >正在设置</span
        ></span
      >
      <span class="catalog-date-range__value"
        ><time v-if="props.from" :datetime="props.from">{{ props.from }}</time>
        <span v-else class="catalog-date-range__placeholder">不限</span></span
      >
    </component>
    <AppIcon class="catalog-date-range__arrow" name="arrow-forward" :size="16" />
    <component
      :is="props.interactive ? 'button' : 'span'"
      class="catalog-date-range__endpoint"
      :class="{ 'is-active': props.activeStage === 'end' }"
      :type="props.interactive ? 'button' : undefined"
      :aria-label="props.interactive ? '设置结束日期' : undefined"
      :aria-pressed="props.interactive ? props.activeStage === 'end' : undefined"
      @click="selectStage('end')"
    >
      <span v-if="props.showLabels" class="catalog-date-range__label"
        >结束
        <span
          v-if="props.prominent && props.activeStage === 'end'"
          class="catalog-date-range__status"
          >正在设置</span
        ></span
      >
      <span class="catalog-date-range__value">
        <time v-if="props.to" :datetime="props.to">{{ props.to }}</time>
        <span v-else class="catalog-date-range__placeholder">{{
          props.activeStage ? '待选择' : '不限'
        }}</span>
      </span>
    </component>
  </span>
</template>

<style scoped>
.catalog-date-range {
  container: am-filter-date-range / inline-size;
  display: grid;
  /* 端点在常规宽度下各占一行；窄容器允许标签折行，日期数字始终保持完整。 */
  grid-template-columns: minmax(0, max-content) auto minmax(0, max-content);
  justify-content: start;
  min-inline-size: 0;
  align-items: center;
  gap: var(--am-space-2);
}
.catalog-date-range__endpoint {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  min-inline-size: 0;
  gap: var(--am-space-1) var(--am-space-2);
  margin: 0;
}
.catalog-date-range__label {
  color: var(--am-color-text-secondary);
  font-size: var(--am-font-size-xs);
}
.catalog-date-range__value {
  margin: 0;
  color: var(--am-color-text);
  font-size: var(--am-font-size-sm);
  font-weight: 650;
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.025em;
  white-space: nowrap;
}
.catalog-date-range__arrow {
  flex-shrink: 0;
  color: var(--am-color-text-secondary);
}
.catalog-date-range__endpoint.is-active .catalog-date-range__label,
.catalog-date-range__endpoint.is-active .catalog-date-range__value {
  color: var(--am-color-primary);
}
.catalog-date-range__endpoint .catalog-date-range__placeholder {
  color: var(--am-color-text-secondary);
  font-weight: 400;
}
/* 当前输入采用两条端点行，避免窄右栏挤小日期；历史仍沿用横向摘要。 */
.catalog-date-range--prominent {
  grid-template-columns: minmax(0, 1fr);
  justify-content: stretch;
}
.catalog-date-range--prominent .catalog-date-range__endpoint {
  justify-content: space-between;
  align-items: center;
  gap: var(--am-space-2) var(--am-space-3);
  min-block-size: 56px;
  padding: var(--am-space-2) var(--am-space-3);
  border: 1px solid var(--am-color-border);
  border-radius: var(--am-radius-control);
  background: var(--am-color-surface);
}
.catalog-date-range--prominent .catalog-date-range__label {
  display: grid;
  gap: var(--am-space-1);
  font-size: var(--am-font-size-sm);
  font-weight: 600;
}
.catalog-date-range__status {
  font-size: var(--am-font-size-xs);
  font-weight: 400;
}
.catalog-date-range--prominent .catalog-date-range__value {
  font-size: var(--am-font-size-lg);
  font-weight: 700;
}
/* 文本状态和细边界共同指示正在编辑的端点，避免仅靠蓝色区分阶段。 */
.catalog-date-range--prominent .catalog-date-range__endpoint.is-active {
  border-color: var(--am-color-primary);
  background: var(--am-color-primary-soft);
}
.catalog-date-range--prominent .catalog-date-range__arrow {
  display: none;
}
/* 使用原生按钮支持 Enter/Space；焦点环画在端点行内侧，避免被滚动容器裁切。 */
button.catalog-date-range__endpoint {
  color: inherit;
  cursor: pointer;
  font: inherit;
  text-align: start;
}
.catalog-date-range--prominent button.catalog-date-range__endpoint:hover {
  border-color: var(--am-color-primary);
  background: var(--am-color-primary-soft);
}
button.catalog-date-range__endpoint:focus-visible {
  outline: var(--am-focus-ring);
  outline-offset: -2px;
}
@container am-filter-date-range (max-width: 280px) {
  .catalog-date-range:not(.catalog-date-range--prominent) .catalog-date-range__endpoint {
    column-gap: var(--am-space-1);
  }
  .catalog-date-range:not(.catalog-date-range--prominent) .catalog-date-range__value {
    font-size: var(--am-font-size-xs);
  }
}
</style>
