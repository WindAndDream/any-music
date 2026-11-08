<script setup lang="ts">
import { nextTick, useTemplateRef, watch } from 'vue'

import { usePlayerControlPager } from '../../composables/player/use-player-control-pager'
import AppIcon from '../AppIcon.vue'

/** 只分页播放控制与设置插槽；桌面不建立布局盒，默认插槽沿用消费端原有布局。 */
const props = defineProps<{
  mobile: boolean
  disabled?: boolean
}>()

defineSlots<{
  default(): unknown
  actions(): unknown
}>()

const playbackPage = useTemplateRef<HTMLElement>('playbackPage')
const actionsPage = useTemplateRef<HTMLElement>('actionsPage')
const forwardButton = useTemplateRef<HTMLButtonElement>('forwardButton')
const backButton = useTemplateRef<HTMLButtonElement>('backButton')
const {
  isActionsVisible,
  showActions,
  showPlayback,
  handlePointerDown,
  handlePointerMove,
  handlePointerUp,
  handlePointerCancel,
  handleClick,
  handleWheel,
} = usePlayerControlPager({ enabled: () => props.mobile, suspended: () => props.disabled })

/** 全屏播放器关闭后，把焦点还给当前可见页，不能落到保留挂载但 inert 的第一页。 */
function focusCurrentPage(): void {
  if (!props.mobile || props.disabled) return
  const target = isActionsVisible.value ? backButton.value : forwardButton.value
  target?.focus({ preventScroll: true })
}
defineExpose({ focusCurrentPage })

watch(isActionsVisible, async (isVisible) => {
  if (props.disabled) return
  const outgoingPage = isVisible ? playbackPage.value : actionsPage.value
  const root = outgoingPage?.getRootNode()
  const active = root instanceof ShadowRoot ? root.activeElement : document.activeElement
  if (!active || !outgoingPage?.contains(active)) return
  // 离场页立即 inert；仅转移已有焦点，不因触摸翻页抢走外层页面的焦点。
  await nextTick()
  if (props.disabled || isActionsVisible.value !== isVisible) return
  const target = props.mobile
    ? isVisible
      ? backButton.value
      : forwardButton.value
    : playbackPage.value?.querySelector<HTMLElement>('button:not([disabled])')
  target?.focus({ preventScroll: true })
})
</script>

<template>
  <div
    class="player-control-pager"
    :class="{
      'player-control-pager--mobile': props.mobile,
      'player-control-pager--actions': isActionsVisible,
    }"
    :inert="props.disabled || undefined"
    @pointerdown="handlePointerDown"
    @pointermove="handlePointerMove"
    @pointerup="handlePointerUp"
    @pointercancel="handlePointerCancel"
    @lostpointercapture.self="handlePointerCancel"
    @click.capture="handleClick"
    @wheel="handleWheel"
    @dragstart.prevent
  >
    <div
      ref="playbackPage"
      class="player-control-pager__playback"
      :aria-hidden="props.disabled || (props.mobile && isActionsVisible) ? 'true' : undefined"
      :inert="props.disabled || (props.mobile && isActionsVisible) || undefined"
    >
      <slot />
      <button
        ref="forwardButton"
        class="player-control-pager__arrow player-control-pager__arrow--forward"
        type="button"
        aria-label="更多播放控制"
        @click="showActions"
      >
        <AppIcon name="arrow-right" :size="28" />
      </button>
    </div>
    <div
      ref="actionsPage"
      class="player-control-pager__actions"
      :aria-hidden="props.disabled || !props.mobile || !isActionsVisible ? 'true' : undefined"
      :inert="props.disabled || !props.mobile || !isActionsVisible || undefined"
    >
      <div class="player-control-pager__action-content"><slot name="actions" /></div>
      <button
        ref="backButton"
        class="player-control-pager__arrow player-control-pager__arrow--back"
        type="button"
        aria-label="返回播放控制"
        @click="showPlayback"
      >
        <AppIcon name="arrow-left" :size="28" />
      </button>
    </div>
  </div>
</template>

<style scoped>
.player-control-pager,
.player-control-pager__playback {
  /* 中性包装层在桌面透传布局，不能把消费端的多个网格项压进单独一列。 */
  display: contents;
}

.player-control-pager__actions,
.player-control-pager__arrow {
  display: none;
}

.player-control-pager--mobile {
  /* 箭头点击区与播放页预留宽度共享尺寸，放大后仍不会压住右侧播放按钮。 */
  --am-player-page-arrow-size: 48px;
  /* 两页保持挂载并占据同一网格，避免 display 切换造成跳变或重建播放控件。 */
  position: relative;
  z-index: 1;
  display: grid;
  min-inline-size: 0;
  min-block-size: var(--am-player-page-arrow-size);
  overflow: clip;
  /* 控制栏自身不滚动，允许消费端同时处理纵向展开，防止浏览器中途取消上拖。 */
  touch-action: none;
  user-select: none;
  cursor: grab;
}

.player-control-pager--mobile:active {
  cursor: grabbing;
}

.player-control-pager--mobile .player-control-pager__playback,
.player-control-pager--mobile .player-control-pager__actions {
  grid-area: 1 / 1;
  min-inline-size: 0;
  align-content: center;
  /* 每页单独裁剪，避免离场箭头向外延伸的磨砂层从视口另一侧露出。 */
  overflow: clip;
  transition: transform var(--am-motion-normal) var(--am-ease-emphasized);
}

.player-control-pager--mobile .player-control-pager__playback {
  position: relative;
  display: block;
  padding-inline-end: var(--am-player-page-arrow-size);
}

.player-control-pager--mobile .player-control-pager__actions {
  display: flex;
  align-items: center;
  gap: var(--am-space-1);
  pointer-events: none;
  transform: translateX(-100%);
}

.player-control-pager--mobile.player-control-pager--actions .player-control-pager__playback {
  pointer-events: none;
  transform: translateX(100%);
}

.player-control-pager--mobile.player-control-pager--actions .player-control-pager__actions {
  pointer-events: auto;
  transform: translateX(0);
}

.player-control-pager__action-content {
  flex: 1 1 auto;
  min-inline-size: 0;
}

.player-control-pager--mobile .player-control-pager__arrow {
  position: relative;
  display: grid;
  inline-size: var(--am-player-page-arrow-size);
  block-size: var(--am-player-page-arrow-size);
  flex: 0 0 auto;
  place-items: center;
  padding: 0;
  border: 0;
  border-radius: var(--am-radius-sm);
  background: transparent;
  color: var(--am-color-text-secondary);
  cursor: pointer;
  isolation: isolate;
  transition: color var(--am-motion-fast) var(--am-ease-standard);
}

.player-control-pager--mobile .player-control-pager__arrow--forward {
  position: absolute;
  inset-inline-end: 0;
  inset-block-start: 50%;
  transform: translateY(-50%);
}

.player-control-pager__arrow::before {
  /* 磨砂铺在箭头周围并向内容渐隐，背景随主题变化，不绘制实色按钮。 */
  position: absolute;
  z-index: -1;
  inset: 0 -12px 0 -20px;
  background: linear-gradient(to right, transparent, var(--am-color-surface));
  backdrop-filter: blur(12px);
  mask-image: linear-gradient(to right, transparent, black 55%);
  pointer-events: none;
  content: '';
}

@supports (background: color-mix(in srgb, white, transparent)) {
  .player-control-pager__arrow::before {
    background: color-mix(in srgb, var(--am-color-surface) 72%, transparent);
  }
}

.player-control-pager__arrow:focus-visible {
  outline: var(--am-focus-ring);
  outline-offset: calc(-1 * var(--am-focus-offset));
}

.player-control-pager--mobile :deep(button:focus-visible) {
  /* 分页视口需要裁剪横向离场内容，焦点环向内绘制以保留完整键盘反馈。 */
  outline-offset: calc(-1 * var(--am-focus-offset));
}

@media (hover: hover) {
  .player-control-pager__arrow:hover {
    color: var(--am-color-primary);
  }
}

@media (prefers-reduced-motion: reduce) {
  .player-control-pager--mobile .player-control-pager__playback,
  .player-control-pager--mobile .player-control-pager__actions,
  .player-control-pager__arrow {
    transition: none;
  }
}
</style>
