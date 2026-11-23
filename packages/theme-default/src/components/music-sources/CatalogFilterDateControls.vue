<script setup lang="ts">
import { useTemplateRef } from 'vue'

/** 日期阶段与加入动作的受控操作栏。 */
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
const startButton = useTemplateRef<HTMLButtonElement>('startButton')

function focusStart(): void {
  startButton.value?.focus({ preventScroll: true })
}

defineExpose({ focusStart })
</script>

<template>
  <div
    class="catalog-date-controls"
    :class="{ 'catalog-date-controls--with-action': props.hasEndDate }"
  >
    <div
      class="catalog-date-controls__endpoints"
      :style="{ '--am-state-tab-index': props.stage === 'end' ? 1 : 0 }"
      role="group"
      aria-label="日期端点"
    >
      <button
        ref="startButton"
        type="button"
        :aria-pressed="props.stage === 'start'"
        @click="emit('selectStage', 'start')"
      >
        起始时间
      </button>
      <button
        type="button"
        :aria-pressed="props.stage === 'end'"
        @click="emit('selectStage', 'end')"
      >
        结束时间
      </button>
    </div>
    <div class="catalog-date-controls__action" :inert="!props.hasEndDate">
      <Transition name="catalog-date-action">
        <button
          v-if="props.hasEndDate"
          class="catalog-date-controls__add"
          type="button"
          :disabled="!props.canAddRange"
          @click="emit('addRange')"
        >
          {{ props.isEditing ? '更新时间段' : '加入时间段' }}
        </button>
      </Transition>
    </div>
  </div>
</template>

<style scoped lang="scss">
@use '../../styles/collection-chrome';

.catalog-date-controls {
  display: grid;
  container-type: inline-size;
  /* 保留两列，让操作按钮进出时起止按钮的分栏可以连续插值。 */
  grid-template-columns: minmax(0, 1fr) minmax(0, 0fr);
  align-items: center;
  column-gap: 0;
  min-inline-size: 0;
  transition:
    grid-template-columns var(--am-motion-normal) var(--am-ease-standard),
    column-gap var(--am-motion-normal) var(--am-ease-standard);
}
.catalog-date-controls--with-action {
  grid-template-columns: minmax(0, 2fr) minmax(0, 1fr);
  column-gap: var(--am-space-2);
}
.catalog-date-controls__endpoints {
  @include collection-chrome.inset-state-tabs;
  inline-size: auto;
  grid-template-columns: repeat(2, minmax(0, 1fr));

  > button {
    min-inline-size: 0;
    padding-inline: var(--am-space-1);
  }
}
.catalog-date-controls__action {
  min-inline-size: 0;
  overflow: hidden;
}
.catalog-date-controls__add {
  min-inline-size: 0;
  inline-size: 100%;
  min-block-size: 44px;
  overflow: hidden;
  padding: var(--am-space-2) var(--am-space-1);
  border: 1px solid var(--am-color-primary);
  border-radius: var(--am-radius-control);
  background: var(--am-color-primary);
  color: var(--am-color-on-primary);
  cursor: pointer;
  font: inherit;
  font-size: clamp(0.6875rem, 4.7cqi, var(--am-font-size-sm));
  font-weight: 700;
  white-space: nowrap;
}
.catalog-date-controls__add:disabled {
  opacity: 0.45;
  cursor: default;
}
.catalog-date-controls__add:focus-visible {
  outline: var(--am-focus-ring);
  outline-color: var(--am-color-on-primary);
  outline-offset: -2px;
}
.catalog-date-action-enter-active,
.catalog-date-action-leave-active {
  transition: opacity var(--am-motion-normal) var(--am-ease-standard);
}
.catalog-date-action-enter-from,
.catalog-date-action-leave-to {
  opacity: 0;
}
@media (prefers-reduced-motion: reduce) {
  .catalog-date-controls,
  .catalog-date-action-enter-active,
  .catalog-date-action-leave-active {
    transition: none;
  }
}
</style>
