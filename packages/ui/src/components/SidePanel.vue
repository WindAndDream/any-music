<script setup lang="ts">
import { nextTick, shallowRef, useId, useTemplateRef, watch } from 'vue'

import { useBackNavigationScope } from '../composables/use-back-navigation'
import { useOverlayKeyboard } from '../composables/use-overlay-keyboard'
import AppIcon from './AppIcon.vue'

interface Props {
  open: boolean
  /** 自动随勾选展开时保留列表焦点，让键盘继续选择下一项。 */
  autoFocus?: boolean
  title: string
  description?: string
  closeLabel?: string
  /** 确认框或选择弹窗接管交互时，只暂停面板本身，歌曲列表由上层模态状态管理。 */
  suspended?: boolean
  /** 列表操作器把关闭和全选排在上方，下排动作使用完整宽度。 */
  stackedActions?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  autoFocus: true,
  description: undefined,
  closeLabel: '关闭',
  suspended: false,
  stackedActions: false,
})

const emit = defineEmits<{
  close: []
}>()
useBackNavigationScope({
  active: () => props.open && !props.suspended,
  layer: 'panel',
  handle: () => emit('close'),
})

defineSlots<{
  default?: () => unknown
  footer?: () => unknown
}>()

const closeButton = useTemplateRef<HTMLButtonElement>('closeButton')
const previousFocus = shallowRef<HTMLElement>()
const accessibleId = useId()
const titleId = `${accessibleId}-title`
const descriptionId = `${accessibleId}-description`
let shouldRestoreFocus = false

watch(
  () => props.open,
  async (isOpen, wasOpen) => {
    if (!isOpen) {
      if (wasOpen) shouldRestoreFocus = true
      return
    }
    shouldRestoreFocus = false
    if (!props.autoFocus) {
      previousFocus.value = undefined
      return
    }
    previousFocus.value = getDeepActiveElement()
    await nextTick()
    closeButton.value?.focus({ preventScroll: true })
  },
)

function getDeepActiveElement(): HTMLElement | undefined {
  let activeElement: Element | null = document.activeElement
  while (activeElement instanceof HTMLElement && activeElement.shadowRoot?.activeElement) {
    activeElement = activeElement.shadowRoot.activeElement
  }
  return activeElement instanceof HTMLElement ? activeElement : undefined
}

function handleAfterLeave(): void {
  if (!shouldRestoreFocus) return
  shouldRestoreFocus = false
  if (previousFocus.value?.isConnected) previousFocus.value.focus({ preventScroll: true })
  previousFocus.value = undefined
}

useOverlayKeyboard({
  active: () => props.open && !props.suspended,
  layer: 'panel',
  onEscape: () => emit('close'),
})
</script>

<template>
  <Transition name="am-side-panel" @after-leave="handleAfterLeave">
    <!-- 底部操作条不遮挡歌曲列表，选择仍可在上方卡片内继续进行。 -->
    <div v-if="props.open" class="side-panel">
      <aside
        class="side-panel__surface"
        :class="{ 'side-panel__surface--stacked-actions': props.stackedActions }"
        :inert="props.suspended ? true : undefined"
        :aria-hidden="props.suspended ? 'true' : undefined"
        :aria-labelledby="titleId"
        :aria-describedby="props.description ? descriptionId : undefined"
      >
        <header class="side-panel__header">
          <div>
            <h2 :id="titleId">{{ props.title }}</h2>
            <p v-if="props.description" :id="descriptionId">{{ props.description }}</p>
          </div>
          <button
            ref="closeButton"
            type="button"
            :aria-label="props.closeLabel"
            @click="emit('close')"
          >
            <AppIcon name="close" />
          </button>
        </header>
        <div class="side-panel__content">
          <slot />
        </div>
        <footer v-if="$slots.footer" class="side-panel__footer">
          <slot name="footer" />
        </footer>
      </aside>
    </div>
  </Transition>
</template>

<style scoped>
.side-panel {
  position: absolute;
  inset: 0;
  overflow: hidden;
  pointer-events: none;
}

.side-panel__surface {
  container: am-side-panel / inline-size;
  position: absolute;
  inset-block-end: 0;
  inset-inline: 0;
  display: grid;
  block-size: 100%;
  grid-template-columns: 44px minmax(0, 1fr);
  grid-template-areas: 'header content';
  column-gap: var(--am-space-3);
  padding-inline: var(--am-space-5);
  overflow: hidden;
  border-block-start: 1px solid var(--am-color-border);
  background: var(--am-color-surface);
  box-shadow: var(--am-shadow-navigation);
  color: var(--am-color-text);
  pointer-events: auto;
}

.side-panel__header {
  grid-area: header;
  display: grid;
  place-items: center;
}

/* 标题继续命名区域；有限高度留给选择和三个批量动作。 */
.side-panel__header > div {
  position: absolute;
  inline-size: 1px;
  block-size: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}

.side-panel__header button {
  display: grid;
  inline-size: 44px;
  block-size: 44px;
  place-items: center;
  padding: 0;
  border: 0;
  border-radius: var(--am-radius-control);
  background: var(--am-color-hover);
  color: var(--am-color-text);
  cursor: pointer;
  transition: background-color var(--am-motion-fast) var(--am-ease-standard);
}

.side-panel__header button:is(:hover, :focus-visible) {
  background: var(--am-color-primary-container);
}

.side-panel__content {
  grid-area: content;
  min-block-size: 0;
  min-inline-size: 0;
  display: grid;
  align-items: center;
  overflow: hidden;
  padding-block: var(--am-space-2);
}

.side-panel__footer {
  display: none;
}

.am-side-panel-enter-active,
.am-side-panel-leave-active {
  /* Vue 按根节点过渡判定离场结束，必须等内部滑动及底部空间一起收回后再卸载。 */
  transition: opacity var(--am-motion-slow) var(--am-ease-standard);
}

.am-side-panel-enter-active .side-panel__surface,
.am-side-panel-leave-active .side-panel__surface {
  transition: transform var(--am-motion-slow) var(--am-ease-emphasized);
}

.am-side-panel-enter-from,
.am-side-panel-leave-to {
  opacity: 0;
}

.am-side-panel-enter-from .side-panel__surface,
.am-side-panel-leave-to .side-panel__surface {
  transform: translateY(100%);
}

@media (max-width: 768px) {
  /* 居中的关闭按钮跨过两排动作，两排统一避让其 44px 热区和 8px 间距。 */
  .side-panel {
    --am-operator-close-inset-start: 52px;
  }

  .side-panel__surface {
    display: block;
    padding-inline: 0;
  }

  .side-panel__header {
    position: absolute;
    z-index: 1;
    inset-block-start: 50%;
    inset-inline-start: var(--am-space-3);
    transform: translateY(-50%);
  }

  .side-panel__content {
    block-size: 100%;
    /* 固定高度的动作组与关闭按钮共用垂直中心，额外播放器高度均分为上下留白。 */
    align-content: center;
    padding: var(--am-space-2) var(--am-space-3);
    padding-inline-start: calc(var(--am-space-3) + var(--am-operator-close-inset-start));
  }
}

.side-panel__surface--stacked-actions {
  display: block;
}

.side-panel__surface--stacked-actions .side-panel__header {
  position: absolute;
  z-index: 1;
  /* 两排 44px 加 8px 间距在面板中居中，关闭按钮与第一排精确对齐。 */
  inset-block-start: calc(50% - 48px);
  inset-inline-start: var(--am-space-5);
  transform: none;
}

.side-panel__surface--stacked-actions .side-panel__content {
  block-size: 100%;
  align-content: center;
  padding-block: var(--am-space-2);
  padding-inline-start: 0;
}

@media (max-width: 768px) {
  .side-panel__surface--stacked-actions .side-panel__header {
    inset-inline-start: var(--am-space-3);
  }

  .side-panel__surface--stacked-actions .side-panel__content {
    padding-inline: var(--am-space-3);
  }
}

@media (prefers-reduced-motion: reduce) {
  .side-panel__header button {
    transition: none;
  }

  .am-side-panel-enter-active,
  .am-side-panel-leave-active,
  .am-side-panel-enter-active .side-panel__surface,
  .am-side-panel-leave-active .side-panel__surface {
    transition-duration: 1ms;
  }
}
</style>
