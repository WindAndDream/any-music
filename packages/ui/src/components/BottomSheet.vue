<script setup lang="ts">
import { nextTick, onMounted, shallowRef, useId, useTemplateRef, watch } from 'vue'

import { useBackNavigationScope } from '../composables/use-back-navigation'
import { useOverlayKeyboard } from '../composables/use-overlay-keyboard'
import AppIcon from './AppIcon.vue'
import { containModalTab, getDeepActiveElement, getModalReturnFocus } from './modal-focus'

interface Props {
  open: boolean
  title: string
  description?: string
  size?: 'compact' | 'content' | 'full' | 'settings'
  closeLabel?: string
  /** Semantic opener fallback when a complete presentation replacement removes the original trigger. */
  returnFocusSelector?: string
  /** 上层模态框接管交互时保留当前面板画面，但暂停焦点圈与关闭快捷键。 */
  suspended?: boolean
  /** Return through nested pages without changing the explicit close action. */
  backAction?: () => void
}

const props = withDefaults(defineProps<Props>(), {
  description: undefined,
  size: 'content',
  closeLabel: '关闭',
  returnFocusSelector: undefined,
  suspended: false,
})

const emit = defineEmits<{
  close: []
}>()
useBackNavigationScope({
  active: () => props.open && !props.suspended,
  layer: 'modal',
  handle: () => (props.backAction ? props.backAction() : emit('close')),
})

defineSlots<{
  default?: () => unknown
  /** 复杂摘要仍复用面板的描述关联，由调用方按可用宽度排列内容。 */
  description?: () => unknown
  footer?: () => unknown
}>()

const panel = useTemplateRef<HTMLElement>('panel')
const closeButton = useTemplateRef<HTMLButtonElement>('closeButton')
const previousFocus = shallowRef<HTMLElement>()
const accessibleId = useId()
const titleId = `${accessibleId}-title`
const descriptionId = `${accessibleId}-description`
let shouldRestoreFocus = false
let returnFocusScope: Document | ShadowRoot | undefined
onMounted(() => {
  returnFocusScope = panel.value?.getRootNode() as Document | ShadowRoot | undefined
  if (!props.open || props.suspended || typeof document === 'undefined') return
  previousFocus.value = getDeepActiveElement()
  closeButton.value?.focus({ preventScroll: true })
})

watch(
  () => props.open,
  async (isOpen) => {
    if (!isOpen) {
      // 离场期间面板仍是最上层交互面；等 Transition 真正移除后再归还焦点。
      shouldRestoreFocus = true
      return
    }
    shouldRestoreFocus = false
    previousFocus.value = getDeepActiveElement()
    await nextTick()
    returnFocusScope = panel.value?.getRootNode() as Document | ShadowRoot | undefined
    if (props.open && !props.suspended) closeButton.value?.focus({ preventScroll: true })
  },
)

function handleAfterLeave(): void {
  if (!shouldRestoreFocus) return
  shouldRestoreFocus = false
  getModalReturnFocus(previousFocus.value, returnFocusScope, props.returnFocusSelector)?.focus({
    preventScroll: true,
  })
  previousFocus.value = undefined
}

useOverlayKeyboard({
  active: () => props.open && !props.suspended,
  layer: 'modal',
  onEscape: () => emit('close'),
  onTab: (event) => containModalTab(event, panel.value),
})
</script>

<template>
  <Transition name="am-bottom-sheet" @after-leave="handleAfterLeave">
    <div
      v-if="props.open"
      class="bottom-sheet"
      role="presentation"
      :inert="props.suspended ? true : undefined"
      :aria-hidden="props.suspended ? 'true' : undefined"
    >
      <button
        class="bottom-sheet__scrim"
        type="button"
        :aria-label="props.closeLabel"
        @click="emit('close')"
      ></button>
      <section
        ref="panel"
        class="bottom-sheet__panel"
        :class="`bottom-sheet__panel--${props.size}`"
        role="dialog"
        :aria-modal="props.suspended ? undefined : 'true'"
        :aria-labelledby="titleId"
        :aria-describedby="props.description || $slots.description ? descriptionId : undefined"
        tabindex="-1"
      >
        <div class="bottom-sheet__handle" aria-hidden="true"></div>
        <header class="bottom-sheet__header">
          <div class="bottom-sheet__heading">
            <h2 :id="titleId">{{ props.title }}</h2>
            <div v-if="$slots.description" :id="descriptionId" class="bottom-sheet__description">
              <slot name="description" />
            </div>
            <p v-else-if="props.description" :id="descriptionId">{{ props.description }}</p>
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
        <div class="bottom-sheet__content">
          <slot />
        </div>
        <footer v-if="$slots.footer" class="bottom-sheet__footer">
          <slot name="footer" />
        </footer>
      </section>
    </div>
  </Transition>
</template>

<style scoped>
.bottom-sheet {
  position: absolute;
  z-index: var(--am-z-dialog);
  inset: 0;
  display: grid;
  align-items: end;
  pointer-events: auto;
  /* 模糊与淡入共用外层；opacity < 1 会隔离子遮罩的背景采样，导致动画结束才出现模糊。 */
  backdrop-filter: blur(2px);
}

.bottom-sheet__scrim {
  position: absolute;
  inset: 0;
  padding: 0;
  border: 0;
  background: var(--am-color-scrim);
}

.bottom-sheet__panel {
  container: am-bottom-sheet / inline-size;
  position: relative;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
  max-block-size: min(88vh, 832px);
  max-block-size: min(88dvh, 832px);
  overflow: hidden;
  border: 1px solid var(--am-color-border);
  border-block-end: 0;
  border-radius: var(--am-radius-overlay) var(--am-radius-overlay) 0 0;
  background: var(--am-color-surface);
  box-shadow: var(--am-shadow-overlay);
  color: var(--am-color-text);
}

.bottom-sheet__panel--compact {
  min-block-size: min(42vh, 352px);
  min-block-size: min(42dvh, 352px);
}

.bottom-sheet__panel--content {
  min-block-size: min(66vh, 608px);
  min-block-size: min(66dvh, 608px);
}

.bottom-sheet__panel--full {
  /* 全屏操作器覆盖整个产品视口，安全区留白交给头部和底部操作栏。 */
  block-size: 100%;
  max-block-size: 100%;
  border: 0;
  border-radius: 0;
}

/* 设置在 PC 使用居中的双栏面板，独立滚动交给分类和详情；手机覆盖产品视口。 */
.bottom-sheet__panel--settings {
  align-self: center;
  justify-self: center;
  inline-size: min(1040px, calc(100% - var(--am-space-8)));
  block-size: min(82vh, 800px);
  block-size: min(82dvh, 800px);
  max-block-size: calc(100% - var(--am-space-8));
  border: 1px solid var(--am-color-border);
  border-radius: var(--am-radius-overlay);
}

.bottom-sheet__panel--settings .bottom-sheet__handle {
  display: none;
}

.bottom-sheet__panel--settings .bottom-sheet__content {
  overflow: hidden;
  padding: 0;
}

@media (max-width: 768px) {
  .bottom-sheet__panel--settings {
    inline-size: 100%;
    block-size: 100%;
    max-block-size: 100%;
    border: 0;
    border-radius: 0;
  }

  .bottom-sheet__panel--settings .bottom-sheet__header {
    align-items: center;
    padding: max(var(--am-space-4), env(safe-area-inset-top)) var(--am-space-4) var(--am-space-4);
  }

  .bottom-sheet__panel--settings .bottom-sheet__header h2 {
    font-size: var(--am-font-size-lg);
  }
}

.bottom-sheet__panel--full .bottom-sheet__header {
  padding-block-start: max(var(--am-space-6), env(safe-area-inset-top));
}

.bottom-sheet__panel--full .bottom-sheet__footer {
  padding-block-end: max(var(--am-space-4), env(safe-area-inset-bottom));
}

.bottom-sheet__handle {
  position: absolute;
  inset-block-start: var(--am-space-2);
  inset-inline-start: 50%;
  inline-size: 48px;
  block-size: 4px;
  border-radius: var(--am-radius-pill);
  background: var(--am-color-border-strong);
  transform: translateX(-50%);
}

.bottom-sheet__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--am-space-4);
  padding: var(--am-space-6) var(--am-space-6) var(--am-space-4);
  border-block-end: 1px solid var(--am-color-border);
}

.bottom-sheet__header h2,
.bottom-sheet__header p {
  margin: 0;
}

.bottom-sheet__heading {
  flex: 1;
  min-inline-size: 0;
}

.bottom-sheet__description {
  margin-block-start: var(--am-space-1);
  color: var(--am-color-text-secondary);
}

.bottom-sheet__header h2 {
  font-size: var(--am-font-size-xl);
  letter-spacing: -0.025em;
}

.bottom-sheet__header p {
  margin-block-start: var(--am-space-1);
  color: var(--am-color-text-secondary);
}

.bottom-sheet__header button {
  flex: 0 0 auto;
  inline-size: var(--am-size-control);
  block-size: var(--am-size-control);
  display: grid;
  place-items: center;
  padding: 0;
  border: 0;
  border-radius: var(--am-radius-control);
  background: var(--am-color-hover);
  color: var(--am-color-text);
  cursor: pointer;
}

.bottom-sheet__content {
  min-block-size: 0;
  overflow: auto;
  padding: var(--am-space-5) var(--am-space-6) var(--am-space-6);
  overscroll-behavior: contain;
}

.bottom-sheet__footer {
  padding: var(--am-space-4) var(--am-space-6);
  border-block-start: 1px solid var(--am-color-border);
  background: var(--am-color-surface);
}

.am-bottom-sheet-enter-active,
.am-bottom-sheet-leave-active {
  transition: opacity var(--am-motion-normal) var(--am-ease-standard);
}

.am-bottom-sheet-enter-active .bottom-sheet__panel,
.am-bottom-sheet-leave-active .bottom-sheet__panel {
  transition: transform var(--am-motion-slow) var(--am-ease-emphasized);
}

.am-bottom-sheet-enter-from,
.am-bottom-sheet-leave-to {
  opacity: 0;
}

.am-bottom-sheet-enter-from .bottom-sheet__panel,
.am-bottom-sheet-leave-to .bottom-sheet__panel {
  transform: translateY(100%);
}

@container am-bottom-sheet (max-width: 512px) {
  .bottom-sheet__header,
  .bottom-sheet__content,
  .bottom-sheet__footer {
    padding-inline: var(--am-space-4);
  }
}

@container am-bottom-sheet (max-width: 760px) {
  /* 移动端保留触摸与鼠标滚动能力，只隐藏会挤占内容宽度的可见滚动条。 */
  .bottom-sheet__content {
    -ms-overflow-style: none;
    scrollbar-width: none;
  }

  .bottom-sheet__content::-webkit-scrollbar {
    display: none;
  }
}

@media (prefers-reduced-motion: reduce) {
  .am-bottom-sheet-enter-active,
  .am-bottom-sheet-leave-active,
  .am-bottom-sheet-enter-active .bottom-sheet__panel,
  .am-bottom-sheet-leave-active .bottom-sheet__panel {
    transition-duration: 1ms;
  }
}
</style>
