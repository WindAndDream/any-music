<script setup lang="ts">
import { nextTick, onMounted, onScopeDispose, shallowRef, useId, useTemplateRef, watch } from 'vue'

import { useBackNavigationScope } from '../composables/use-back-navigation'
import { useOverlayKeyboard } from '../composables/use-overlay-keyboard'
import AppIcon from './AppIcon.vue'
import { containModalTab, getDeepActiveElement, getModalReturnFocus } from './modal-focus'

defineOptions({ inheritAttrs: false })

interface Props {
  open: boolean
  /** Animate a dialog that is already open when its component first mounts. */
  appear?: boolean
  title: string
  description?: string
  size?: 'compact' | 'wide'
  /** Borderless artwork lightbox retaining modal focus, Escape and system Back. */
  presentation?: 'dialog' | 'image'
  closeLabel?: string
  /** 可选的弹框内初始焦点；未找到目标时仍聚焦关闭按钮。 */
  initialFocusSelector?: string
  /** Semantic opener fallback when a complete presentation replacement removes the original trigger. */
  returnFocusSelector?: string
  /** 更高层弹框打开时保留当前内容，但暂停其模态语义、焦点圈与快捷键。 */
  suspended?: boolean
  /** System Back may return within a dialog while its close button still dismisses it. */
  backAction?: () => void
}

const props = withDefaults(defineProps<Props>(), {
  description: undefined,
  size: 'wide',
  closeLabel: '关闭',
  initialFocusSelector: undefined,
  returnFocusSelector: undefined,
  suspended: false,
  appear: false,
})

const emit = defineEmits<{
  close: []
  afterLeave: []
}>()
useBackNavigationScope({
  active: () => props.open && !props.suspended,
  layer: 'modal',
  handle: () => (props.backAction ? props.backAction() : emit('close')),
})

defineSlots<{
  default?: () => unknown
  footer?: () => unknown
  /** Nested dialogs live above this dialog and outside its suspended/inert content. */
  overlays?: () => unknown
}>()

const panel = useTemplateRef<HTMLElement>('panel')
const closeButton = useTemplateRef<HTMLButtonElement>('closeButton')
const previousFocus = shallowRef<HTMLElement>()
const accessibleId = useId()
const titleId = `${accessibleId}-title`
const descriptionId = `${accessibleId}-description`
let shouldRestoreFocus = false
let leaveRestorePending = false
let returnFocusScope: Document | ShadowRoot | undefined
onMounted(() => {
  returnFocusScope = panel.value?.getRootNode() as Document | ShadowRoot | undefined
  if (!props.open || props.suspended || typeof document === 'undefined') return
  previousFocus.value = getDeepActiveElement()
  focusInitialElement()
})

watch(
  () => props.open,
  async (isOpen, wasOpen) => {
    if (!isOpen) {
      if (wasOpen) shouldRestoreFocus = true
      return
    }
    shouldRestoreFocus = false
    if (!wasOpen) previousFocus.value = getDeepActiveElement()
    if (props.suspended) return
    await nextTick()
    returnFocusScope = panel.value?.getRootNode() as Document | ShadowRoot | undefined
    focusInitialElement()
  },
)

watch(
  () => props.suspended,
  async (isSuspended, wasSuspended) => {
    if (!props.open || isSuspended || !wasSuspended) return
    await nextTick()
    focusInitialElement()
  },
)

function focusInitialElement(): void {
  if (!props.open || props.suspended) return
  const initialElement = props.initialFocusSelector
    ? panel.value?.querySelector<HTMLElement>(props.initialFocusSelector)
    : undefined
  const focusTarget = initialElement ?? closeButton.value
  focusTarget?.focus({ preventScroll: true })
}

function restoreFocus(): void {
  getModalReturnFocus(previousFocus.value, returnFocusScope, props.returnFocusSelector)?.focus({
    preventScroll: true,
  })
  previousFocus.value = undefined
}

async function handleAfterLeave(): Promise<void> {
  const shouldRestore = shouldRestoreFocus
  shouldRestoreFocus = false
  leaveRestorePending = shouldRestore
  emit('afterLeave')
  // Owners may remove the dialog here. Restore only after their background loses inert.
  if (shouldRestore) {
    await nextTick()
    if (!props.open) restoreFocus()
    leaveRestorePending = false
  }
}

useOverlayKeyboard({
  active: () => props.open && !props.suspended,
  layer: 'modal',
  onEscape: () => emit('close'),
  onTab: (event) => containModalTab(event, panel.value),
})
onScopeDispose(() => {
  if (!leaveRestorePending) restoreFocus()
})
</script>

<template>
  <Transition name="app-dialog" :appear="props.appear" @after-leave="handleAfterLeave">
    <div
      v-if="props.open"
      class="app-dialog"
      :class="{ 'app-dialog--image': presentation === 'image' }"
      v-bind="$attrs"
      :inert="props.suspended ? true : undefined"
      :aria-hidden="props.suspended ? 'true' : undefined"
    >
      <button
        class="app-dialog__scrim"
        type="button"
        :aria-label="props.closeLabel"
        @click="emit('close')"
      ></button>
      <section
        ref="panel"
        class="app-dialog__panel"
        :class="`app-dialog__panel--${props.size}`"
        role="dialog"
        :aria-modal="props.suspended ? undefined : 'true'"
        :aria-labelledby="titleId"
        :aria-describedby="props.description ? descriptionId : undefined"
        tabindex="-1"
      >
        <header class="app-dialog__header">
          <div>
            <h2 :id="titleId">{{ props.title }}</h2>
            <p v-if="props.description" :id="descriptionId">{{ props.description }}</p>
          </div>
          <button
            ref="closeButton"
            class="app-dialog__close"
            type="button"
            :aria-label="props.closeLabel"
            @click="emit('close')"
          >
            <AppIcon name="close" />
          </button>
        </header>
        <div class="app-dialog__content">
          <slot />
        </div>
        <footer v-if="$slots.footer" class="app-dialog__footer">
          <slot name="footer" />
        </footer>
      </section>
    </div>
  </Transition>
  <div v-if="$slots.overlays" class="app-dialog__overlays"><slot name="overlays" /></div>
</template>

<style scoped>
.app-dialog__overlays {
  position: absolute;
  z-index: calc(var(--am-z-dialog) + 1);
  inset: 0;
  pointer-events: none;
}

.app-dialog {
  position: absolute;
  z-index: var(--am-z-dialog);
  inset: 0;
  display: grid;
  place-items: center;
  padding: max(var(--am-space-4), env(safe-area-inset-top))
    max(var(--am-space-4), env(safe-area-inset-right))
    max(var(--am-space-4), env(safe-area-inset-bottom))
    max(var(--am-space-4), env(safe-area-inset-left));
  pointer-events: auto;
  /* 模糊与淡入共用外层；opacity < 1 会隔离子遮罩的背景采样，导致动画结束才出现模糊。 */
  backdrop-filter: blur(3px);
}

.app-dialog__scrim {
  position: absolute;
  inset: 0;
  padding: 0;
  border: 0;
  background: var(--am-color-scrim);
}

.app-dialog__panel {
  container: am-dialog / inline-size;
  position: relative;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
  inline-size: min(100%, 960px);
  max-block-size: min(88vh, 800px);
  max-block-size: min(88dvh, 800px);
  overflow: hidden;
  border: 1px solid var(--am-color-border);
  border-radius: var(--am-radius-overlay);
  background: var(--am-color-surface);
  box-shadow: var(--am-shadow-overlay);
  color: var(--am-color-text);
}

.app-dialog__panel--compact {
  inline-size: min(100%, 600px);
}

.app-dialog__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--am-space-4);
  padding: var(--am-space-5) var(--am-space-6) var(--am-space-4);
  border-block-end: 1px solid var(--am-color-border);
}

.app-dialog__header h2,
.app-dialog__header p {
  margin: 0;
}

.app-dialog__header h2 {
  font-size: var(--am-font-size-xl);
  letter-spacing: -0.025em;
}

.app-dialog__header p {
  margin-block-start: var(--am-space-1);
  color: var(--am-color-text-secondary);
  font-size: var(--am-font-size-sm);
}

.app-dialog__close {
  display: grid;
  inline-size: var(--am-size-control);
  block-size: var(--am-size-control);
  flex: 0 0 auto;
  place-items: center;
  padding: 0;
  border: 0;
  border-radius: var(--am-radius-control);
  background: var(--am-color-hover);
  color: var(--am-color-text);
  cursor: pointer;
}

.app-dialog__content {
  min-block-size: 0;
  overflow: auto;
  padding: var(--am-space-5) var(--am-space-6) var(--am-space-6);
  overscroll-behavior: contain;
}

.app-dialog__footer {
  padding: var(--am-space-4) var(--am-space-6);
  border-block-start: 1px solid var(--am-color-border);
  background: var(--am-color-surface);
}

.app-dialog-enter-active,
.app-dialog-leave-active {
  transition: opacity var(--am-motion-normal) var(--am-ease-standard);
}

.app-dialog-enter-active .app-dialog__panel,
.app-dialog-leave-active .app-dialog__panel {
  transition:
    opacity var(--am-motion-normal) var(--am-ease-standard),
    transform var(--am-motion-normal) var(--am-ease-emphasized);
}

.app-dialog-enter-from,
.app-dialog-leave-to,
.app-dialog-enter-from .app-dialog__panel,
.app-dialog-leave-to .app-dialog__panel {
  opacity: 0;
}

.app-dialog-enter-from .app-dialog__panel,
.app-dialog-leave-to .app-dialog__panel {
  transform: translateY(10px) scale(0.985);
}

@media (max-width: 576px) {
  .app-dialog {
    padding: max(var(--am-space-2), env(safe-area-inset-top))
      max(var(--am-space-2), env(safe-area-inset-right))
      max(var(--am-space-2), env(safe-area-inset-bottom))
      max(var(--am-space-2), env(safe-area-inset-left));
  }

  .app-dialog__panel,
  .app-dialog__panel--compact {
    max-block-size: calc(100vh - var(--am-space-4));
    max-block-size: calc(100dvh - var(--am-space-4));
    border-radius: var(--am-radius-overlay);
  }

  .app-dialog__header,
  .app-dialog__content,
  .app-dialog__footer {
    padding-inline: var(--am-space-4);
  }

  .app-dialog__header h2 {
    font-size: var(--am-font-size-lg);
  }
}

@media (prefers-reduced-motion: reduce) {
  .app-dialog-enter-active,
  .app-dialog-leave-active,
  .app-dialog-enter-active .app-dialog__panel,
  .app-dialog-leave-active .app-dialog__panel {
    transition-duration: 1ms;
  }
}
.app-dialog--image .app-dialog__scrim {
  background: rgb(0 0 0 / 82%);
}
.app-dialog--image .app-dialog__panel {
  inline-size: 100%;
  block-size: 100%;
  max-block-size: 100%;
  grid-template-rows: auto minmax(0, 1fr);
  border: 0;
  border-radius: 0;
  background: transparent;
  box-shadow: none;
  pointer-events: none;
}
.app-dialog--image .app-dialog__header {
  justify-content: end;
  padding: 0 0 var(--am-space-2);
  border: 0;
}
.app-dialog--image .app-dialog__header > div {
  position: absolute;
  inline-size: 1px;
  block-size: 1px;
  overflow: hidden;
  clip-path: inset(50%);
}
.app-dialog--image .app-dialog__close {
  background: rgb(0 0 0 / 55%);
  color: white;
  pointer-events: auto;
}
.app-dialog--image .app-dialog__content {
  padding: 0;
  overflow: hidden;
}
</style>
