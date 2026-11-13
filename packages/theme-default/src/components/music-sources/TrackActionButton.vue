<script setup lang="ts">
import type { AppIconName } from '@any-music/ui/catalog'
import AppIcon from '@any-music/ui/components/AppIcon.vue'

/** 两种歌曲操作弹窗共用紧凑动作；原生属性与监听器透传到按钮，保留禁用和焦点语义。 */
withDefaults(
  defineProps<{
    icon: AppIconName
    label: string
    disabled?: boolean
    pressed?: boolean
    inline?: boolean
    danger?: boolean
  }>(),
  { disabled: false, pressed: undefined, inline: false, danger: false },
)
</script>

<template>
  <button
    class="track-action-button"
    :class="{ 'track-action-button--inline': inline, 'track-action-button--danger': danger }"
    :data-icon="icon"
    type="button"
    :disabled="disabled"
    :aria-pressed="pressed"
  >
    <AppIcon :name="icon" :size="20" />
    <span>{{ label }}</span>
  </button>
</template>

<style scoped>
.track-action-button {
  --am-action-icon-hover: translateY(-2px);
  display: flex;
  min-inline-size: 0;
  min-block-size: 68px;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--am-space-2);
  padding: var(--am-space-2) var(--am-space-1);
  border: 1px solid var(--am-color-border);
  border-radius: var(--am-radius-control);
  background: var(--am-color-surface);
  color: var(--am-color-text);
  cursor: pointer;
  font: 650 var(--am-font-size-xs) var(--am-font-family);
  transition:
    background-color var(--am-motion-fast) var(--am-ease-standard),
    border-color var(--am-motion-fast) var(--am-ease-standard);
  touch-action: manipulation;
}
.track-action-button--inline {
  min-block-size: 44px;
  flex-direction: row;
  padding-inline: var(--am-space-2);
}
.track-action-button span {
  min-inline-size: 0;
  overflow-wrap: anywhere;
}
.track-action-button[aria-pressed='true'] {
  border-color: var(--am-color-primary);
  background: var(--am-color-primary-container);
  color: var(--am-color-primary);
}
.track-action-button:is(:hover, :focus-visible):not(:disabled) {
  border-color: var(--am-color-border-strong);
  background: var(--am-color-surface-hover);
}
.track-action-button--danger {
  color: var(--am-color-danger);
}
.track-action-button--danger:is(:hover, :focus-visible):not(:disabled) {
  background: var(--am-color-danger-container);
}
.track-action-button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.track-action-button:focus-visible {
  /* 弹窗切页会裁切离场内容，内部焦点环保持四边可见。 */
  outline: var(--am-focus-ring);
  outline-offset: -3px;
}
.track-action-button .app-icon {
  flex: 0 0 auto;
  transition: transform var(--am-motion-fast) var(--am-ease-emphasized);
}
.track-action-button[data-icon='play'] {
  --am-action-icon-hover: translateX(2px) scale(1.08);
}
.track-action-button[data-icon='heart'] {
  --am-action-icon-hover: scale(1.15) rotate(-6deg);
}
.track-action-button[data-icon='download'],
.track-action-button[data-icon='arrow-down'] {
  --am-action-icon-hover: translateY(3px);
}
.track-action-button[data-icon='arrow-up'] {
  --am-action-icon-hover: translateY(-3px);
}
.track-action-button[data-icon='queue'],
.track-action-button[data-icon='trash'] {
  --am-action-icon-hover: rotate(-8deg);
}
@media (prefers-reduced-motion: no-preference) {
  .track-action-button:is(:hover, :focus-visible):not(:disabled) .app-icon {
    transform: var(--am-action-icon-hover);
  }
}
@media (prefers-reduced-motion: reduce) {
  .track-action-button,
  .track-action-button .app-icon {
    transition: none;
  }
}
</style>
