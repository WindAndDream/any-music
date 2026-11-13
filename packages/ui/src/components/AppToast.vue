<script setup lang="ts">
import { computed, onScopeDispose, watch } from 'vue'

import type { ActionFeedbackTone } from '../product/action-feedback'
import type { AppIconName } from './app-icon'
import AppIcon from './AppIcon.vue'

/** 受控顶部提示；计时由消费方管理，结果提示保留文字与状态图标且不抢焦点。 */
const props = defineProps<{
  message?: string
  tone?: ActionFeedbackTone
  icon?: AppIconName
  noticeId?: number
}>()
const emit = defineEmits<{
  pauseChange: [isPaused: boolean]
}>()
let isHovered = false
let isFocused = false

function setInteraction(kind: 'hover' | 'focus', value: boolean): void {
  if (kind === 'hover') isHovered = value
  else isFocused = value
  emit('pauseChange', isHovered || isFocused)
}

watch(
  () => props.message,
  (message) => {
    if (!message) {
      isHovered = false
      isFocused = false
      emit('pauseChange', false)
    }
  },
)
// A theme replacement must release its pause on the stable host-owned notice timer.
onScopeDispose(() => emit('pauseChange', false))

const toneIcons: Record<ActionFeedbackTone, AppIconName> = {
  success: 'check',
  error: 'warning',
  warning: 'warning',
  info: 'info',
  neutral: 'close',
}
const noticeIcon = computed(() => props.icon ?? (props.tone ? toneIcons[props.tone] : undefined))
</script>

<template>
  <div
    class="app-toast"
    :role="props.tone === 'error' ? 'alert' : 'status'"
    :aria-live="props.tone === 'error' ? 'assertive' : 'polite'"
    aria-atomic="true"
    @mouseenter="setInteraction('hover', true)"
    @mouseleave="setInteraction('hover', false)"
    @focusin="setInteraction('focus', true)"
    @focusout="setInteraction('focus', false)"
  >
    <Transition name="am-toast" mode="out-in">
      <p
        v-if="props.message"
        :key="props.noticeId"
        class="app-toast__message"
        :data-tone="props.tone"
        tabindex="0"
      >
        <AppIcon v-if="noticeIcon" :name="noticeIcon" :size="20" />
        <span>{{ props.message }}</span>
      </p>
    </Transition>
  </div>
</template>

<style scoped>
.app-toast {
  position: absolute;
  z-index: calc(var(--am-z-dialog) + 1);
  inset-block-start: max(var(--am-space-4), env(safe-area-inset-top));
  inset-inline: var(--am-space-4);
  display: flex;
  justify-content: center;
  pointer-events: none;
}
.app-toast__message {
  --am-toast-color: var(--am-color-text);
  --am-toast-background: var(--am-color-surface);
  display: flex;
  align-items: center;
  gap: var(--am-space-3);
  max-inline-size: min(100%, 480px);
  margin: 0;
  padding: var(--am-space-3) var(--am-space-5);
  border: 1px solid var(--am-color-border);
  border-radius: var(--am-radius-overlay);
  background: var(--am-toast-background);
  box-shadow: var(--am-shadow-card);
  /* 状态色与正文色混合，让浅色成功容器中的小字号文字保持足够对比。 */
  color: color-mix(in srgb, var(--am-toast-color) 82%, var(--am-color-text));
  font-size: var(--am-font-size-sm);
  font-weight: 500;
  line-height: 1.5;
  overflow-wrap: anywhere;
  text-align: start;
  pointer-events: auto;
  -webkit-user-select: text;
  user-select: text;
}
.app-toast__message > svg {
  flex-shrink: 0;
}
.app-toast__message > span {
  min-inline-size: 0;
  white-space: pre-wrap;
  cursor: text;
  -webkit-user-select: text;
  user-select: text;
}
.app-toast__message[data-tone] {
  border-color: color-mix(in srgb, var(--am-toast-color) 40%, var(--am-color-border));
}
.app-toast__message[data-tone='success'] {
  --am-toast-color: var(--am-color-success);
  --am-toast-background: var(--am-color-success-container);
}
.app-toast__message[data-tone='info'] {
  --am-toast-color: var(--am-color-info);
  --am-toast-background: var(--am-color-info-container);
}
.app-toast__message[data-tone='warning'] {
  --am-toast-color: var(--am-color-warning);
  --am-toast-background: var(--am-color-warning-container);
}
.app-toast__message[data-tone='error'] {
  --am-toast-color: var(--am-color-danger);
  --am-toast-background: var(--am-color-danger-container);
}
.app-toast__message[data-tone='neutral'] {
  --am-toast-color: var(--am-color-text-secondary);
  --am-toast-background: var(--am-color-surface-subtle);
}
.am-toast-enter-active,
.am-toast-leave-active {
  transition:
    transform 240ms var(--am-ease-emphasized),
    opacity 240ms var(--am-ease-standard);
}
.am-toast-enter-from,
.am-toast-leave-to {
  opacity: 0;
  transform: translateY(calc(-100% - var(--am-space-4)));
}
@media (prefers-reduced-motion: reduce) {
  .am-toast-enter-active,
  .am-toast-leave-active {
    transition: none;
  }
}
</style>
