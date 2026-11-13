<script setup lang="ts">
import { useCatalogOperatorScroll } from '@any-music/ui/catalog'
import AppIcon from '@any-music/ui/components/AppIcon.vue'
import { useTemplateRef } from 'vue'

/** 列表状态与操作器共用单行按钮视口；右侧箭头不覆盖按钮热区。 */
const props = withDefaults(
  defineProps<{
    align?: 'center' | 'start' | 'end'
    forwardLabel?: string
    backLabel?: string
  }>(),
  {
    align: 'end',
    forwardLabel: '查看更多操作',
    backLabel: '返回前面的操作',
  },
)
defineSlots<{ default(): unknown }>()
const container = useTemplateRef<HTMLElement>('container')
const viewport = useTemplateRef<HTMLElement>('viewport')
const content = useTemplateRef<HTMLElement>('content')
const scroll = useCatalogOperatorScroll({ container, viewport, content })
</script>

<template>
  <div
    ref="container"
    class="catalog-operator-actions"
    :class="{
      'catalog-operator-actions--overflow': scroll.hasOverflow.value,
      'catalog-operator-actions--start': props.align === 'start',
      'catalog-operator-actions--end': props.align === 'end',
    }"
  >
    <div
      ref="viewport"
      class="catalog-operator-actions__viewport"
      @scroll="scroll.updateScroll"
      @pointerdown="scroll.handlePointerDown"
      @pointermove="scroll.handlePointerMove"
      @pointerup="scroll.handlePointerUp"
      @pointercancel="scroll.handlePointerCancel"
      @lostpointercapture.self="scroll.handlePointerCancel"
      @click.capture="scroll.handleClick"
      @dragstart.prevent
    >
      <div ref="content" class="catalog-operator-actions__content"><slot /></div>
    </div>
    <button
      v-if="scroll.hasOverflow.value"
      class="catalog-operator-actions__arrow"
      type="button"
      :aria-label="scroll.isAtEnd.value ? props.backLabel : props.forwardLabel"
      @click="scroll.advance"
    >
      <AppIcon :name="scroll.isAtEnd.value ? 'arrow-left' : 'arrow-right'" :size="28" />
    </button>
  </div>
</template>

<style scoped>
.catalog-operator-actions {
  display: grid;
  min-inline-size: 0;
  grid-template-columns: minmax(0, 1fr);
  align-items: center;
}

.catalog-operator-actions--overflow {
  grid-template-columns: minmax(0, 1fr) 44px;
  gap: var(--am-space-1);
}

.catalog-operator-actions__viewport {
  min-inline-size: 0;
  overflow-x: auto;
  overflow-y: hidden;
  scrollbar-width: none;
  touch-action: pan-y pinch-zoom;
}

.catalog-operator-actions__viewport::-webkit-scrollbar {
  display: none;
}

.catalog-operator-actions__content {
  position: relative;
  display: flex;
  inline-size: max-content;
  min-inline-size: 100%;
  align-items: center;
  justify-content: center;
  gap: var(--am-space-3);
}

/* 操作器默认整组靠右，实际溢出时再从左侧开始浏览。 */
.catalog-operator-actions--end .catalog-operator-actions__content {
  justify-content: flex-end;
}

.catalog-operator-actions--overflow .catalog-operator-actions__content,
.catalog-operator-actions--start .catalog-operator-actions__content {
  justify-content: flex-start;
}

.catalog-operator-actions--overflow .catalog-operator-actions__viewport {
  cursor: grab;
  user-select: none;
}

.catalog-operator-actions--overflow .catalog-operator-actions__viewport:active {
  cursor: grabbing;
}

.catalog-operator-actions__viewport :deep(button:focus-visible) {
  outline-offset: calc(-1 * var(--am-focus-offset));
}

.catalog-operator-actions__arrow {
  position: relative;
  isolation: isolate;
  display: grid;
  inline-size: 44px;
  block-size: 44px;
  place-items: center;
  padding: 0;
  border: 0;
  border-radius: var(--am-radius-control);
  background: transparent;
  color: var(--am-color-text-secondary);
  cursor: pointer;
  transition:
    background-color var(--am-motion-fast) var(--am-ease-standard),
    color var(--am-motion-fast) var(--am-ease-standard);
}

.catalog-operator-actions__arrow::before {
  position: absolute;
  z-index: -1;
  inset: 0 0 0 -16px;
  background: linear-gradient(
    to right,
    transparent,
    var(--am-operator-actions-background, var(--am-color-surface))
  );
  backdrop-filter: blur(12px);
  mask-image: linear-gradient(to right, transparent, black 55%);
  pointer-events: none;
  content: '';
}

.catalog-operator-actions__arrow:focus-visible {
  background: var(--am-color-surface-hover);
  color: var(--am-color-primary);
  outline: var(--am-focus-ring);
  outline-offset: calc(-1 * var(--am-focus-offset));
}

@media (hover: hover) {
  .catalog-operator-actions__arrow:hover {
    background: var(--am-color-surface-hover);
    color: var(--am-color-primary);
  }
}

@media (prefers-reduced-motion: reduce) {
  .catalog-operator-actions__arrow {
    transition: none;
  }
}
</style>
