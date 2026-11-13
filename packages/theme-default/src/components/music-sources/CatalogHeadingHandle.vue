<script setup lang="ts">
import type {
  UiCatalogHeadingHandleProps,
  UiCatalogHeadingHandleEmits,
} from '@any-music/ui/catalog'
import { useCatalogHeadingCollapse } from '@any-music/ui/catalog'

/** 底边的单横线不参与按钮排版；手机通过顶部栏非控件区域拖动，保留键盘入口。 */
const props = defineProps<UiCatalogHeadingHandleProps>()
const emit = defineEmits<UiCatalogHeadingHandleEmits>()
const {
  isDragging,
  dragOffset,
  handlePointerDown,
  handlePointerMove,
  handlePointerUp,
  handlePointerCancel,
  handleClick,
  handleKeydown,
} = useCatalogHeadingCollapse({
  collapsed: () => props.collapsed,
  dragOnly: () => props.dragOnly ?? false,
  gestureTarget: () => props.gestureTarget ?? null,
  updateCollapsed: (collapsed) => emit('updateCollapsed', collapsed),
})
</script>

<template>
  <button
    class="catalog-page__collapse-handle"
    :class="{ 'catalog-page__collapse-handle--dragging': isDragging }"
    type="button"
    :aria-expanded="!props.collapsed"
    :aria-controls="props.controls"
    :aria-label="props.collapsed ? '展开列表信息' : '收起列表信息'"
    :title="
      props.dragOnly
        ? props.collapsed
          ? '向下拖动展开列表信息'
          : '向上拖动收起列表信息'
        : props.collapsed
          ? '点击或向下拖动展开列表信息'
          : '点击或向上拖动收起列表信息'
    "
    @pointerdown="handlePointerDown"
    @pointermove="handlePointerMove"
    @pointerup="handlePointerUp"
    @pointercancel="handlePointerCancel"
    @lostpointercapture="handlePointerCancel"
    @click="handleClick"
    @keydown="handleKeydown"
  >
    <span
      class="catalog-page__collapse-mark"
      :style="{ transform: `translateY(${dragOffset}px)` }"
      aria-hidden="true"
    ></span>
  </button>
</template>

<style scoped>
.catalog-page__heading .catalog-page__collapse-handle {
  /* 热区仅覆盖既有底部留白和栏外间距，避免盖住三个操作按钮或歌曲卡片。 */
  position: absolute;
  inset-inline-start: 50%;
  inset-block-end: -12px;
  inline-size: 72px;
  max-inline-size: 100%;
  block-size: 20px;
  min-block-size: 20px;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--am-color-text-secondary);
  cursor: grab;
  touch-action: none;
  user-select: none;
  transform: translateX(-50%);
}
.catalog-page__heading .catalog-page__collapse-handle:hover:not(:disabled) {
  background: transparent;
  color: var(--am-color-primary);
}
.catalog-page__heading .catalog-page__collapse-handle--dragging {
  cursor: grabbing;
}
.catalog-page__collapse-mark {
  position: absolute;
  inset-block-start: 5px;
  inset-inline-start: calc(50% - 16px);
  inline-size: 32px;
  block-size: 3px;
  border-radius: var(--am-radius-pill);
  background: currentColor;
  transition: transform var(--am-motion-fast) var(--am-ease-standard);
}
/* 有紧邻的错误/来源提示时，仅使用栏内留白，底边入口不能覆盖提示的点击区。 */
.catalog-page__heading:has(+ .catalog-drawer__message) .catalog-page__collapse-handle {
  inset-block-end: 0;
  block-size: 8px;
  min-block-size: 8px;
}
.catalog-page__collapse-handle--dragging .catalog-page__collapse-mark {
  transition: none;
}
@media (max-width: 768px) {
  .catalog-page__collapse-mark {
    /* 手机保留顶部栏/底边手势与键盘入口，不增加图形或布局占位。 */
    visibility: hidden;
  }
}
@media (prefers-reduced-motion: reduce) {
  .catalog-page__collapse-mark {
    transition: none;
  }
}
</style>
