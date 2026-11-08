<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, useId, useTemplateRef, watch } from 'vue'

import type { ActiveConfirmationRequest } from '../../composables/use-confirmation-dialog'
import { useOverlayKeyboard } from '../../composables/use-overlay-keyboard'
import { containModalTab, getDeepActiveElement } from '../modal-focus'

const props = defineProps<{
  request?: ActiveConfirmationRequest
  /** Optional controlled editor uses the same modal layout and confirmation actions. */
  role?: 'dialog' | 'alertdialog'
  confirmDisabled?: boolean
}>()

const emit = defineEmits<{
  confirm: []
  cancel: []
}>()
defineSlots<{ default?: () => unknown }>()

const titleId = `am-confirmation-title-${useId()}`
const descriptionId = `am-confirmation-description-${useId()}`
const dialogPanel = useTemplateRef<HTMLElement>('dialogPanel')
const cancelButton = useTemplateRef<HTMLButtonElement>('cancelButton')
const isOpen = computed(() => Boolean(props.request))

let returnFocusTarget: HTMLElement | undefined
let shouldRestoreFocus = false

function restoreFocus(): void {
  if (returnFocusTarget?.isConnected) returnFocusTarget.focus()
  returnFocusTarget = undefined
}

watch(
  () => props.request?.id,
  async (requestId, previousRequestId) => {
    if (requestId !== undefined) {
      shouldRestoreFocus = false
      if (previousRequestId === undefined) {
        returnFocusTarget = props.request?.returnFocusTarget ?? getDeepActiveElement()
      }
      await nextTick()
      // 破坏性操作默认落在取消按钮，降低键盘用户误确认的概率。
      if (props.request?.id === requestId) cancelButton.value?.focus()
      return
    }
    if (previousRequestId !== undefined) {
      // alertdialog 离场动画结束前仍会拦截交互，之后才把焦点还给真实触发点。
      shouldRestoreFocus = true
    }
  },
  { flush: 'post', immediate: true },
)

onBeforeUnmount(restoreFocus)

function handleAfterLeave(): void {
  if (!shouldRestoreFocus) return
  shouldRestoreFocus = false
  restoreFocus()
}

useOverlayKeyboard({
  active: isOpen,
  layer: 'modal',
  onEscape: () => emit('cancel'),
  onTab: (event) => containModalTab(event, dialogPanel.value),
})
</script>

<template>
  <!-- Keyed overlay hosts mount with an active request, so the first render also needs motion. -->
  <Transition name="confirmation-dialog" appear @after-leave="handleAfterLeave">
    <div v-if="isOpen && props.request" class="confirmation-dialog" @click.self="emit('cancel')">
      <section
        ref="dialogPanel"
        class="confirmation-dialog__panel"
        :data-tone="props.request.tone"
        :role="props.role ?? 'alertdialog'"
        aria-modal="true"
        :aria-labelledby="titleId"
        :aria-describedby="descriptionId"
        tabindex="-1"
      >
        <header class="confirmation-dialog__header">
          <span class="confirmation-dialog__eyebrow">需要确认</span>
          <h2 :id="titleId">{{ props.request.title }}</h2>
        </header>
        <div :id="descriptionId" class="confirmation-dialog__description">
          <p class="confirmation-dialog__message">{{ props.request.message }}</p>
          <dl v-if="props.request.details?.length" class="confirmation-dialog__details">
            <div v-for="(detail, index) in props.request.details" :key="index">
              <dt>{{ detail.label }}</dt>
              <dd>{{ detail.text }}</dd>
            </div>
          </dl>
        </div>
        <slot />
        <footer class="confirmation-dialog__actions">
          <button ref="cancelButton" type="button" @click="emit('cancel')">
            {{ props.request.cancelLabel }}
          </button>
          <button
            class="confirmation-dialog__confirm"
            :data-tone="props.request.tone"
            :disabled="props.confirmDisabled"
            type="button"
            @click="!props.confirmDisabled && emit('confirm')"
          >
            {{ props.request.confirmLabel }}
          </button>
        </footer>
      </section>
    </div>
  </Transition>
</template>

<style scoped>
.confirmation-dialog {
  position: fixed;
  z-index: var(--am-z-dialog);
  inset: 0;
  display: grid;
  place-items: center;
  padding: max(var(--am-space-4), env(safe-area-inset-top))
    max(var(--am-space-4), env(safe-area-inset-right))
    max(var(--am-space-4), env(safe-area-inset-bottom))
    max(var(--am-space-4), env(safe-area-inset-left));
  background: var(--am-color-scrim);
  pointer-events: auto;
}

.confirmation-dialog__panel {
  display: grid;
  gap: var(--am-space-5);
  inline-size: min(440px, 100%);
  max-block-size: min(640px, calc(100vh - var(--am-space-8)));
  max-block-size: min(640px, calc(100dvh - var(--am-space-8)));
  overflow: auto;
  overscroll-behavior: contain;
  padding: var(--am-space-6);
  border: 1px solid var(--am-color-border);
  border-radius: var(--am-radius-overlay);
  background: var(--am-color-surface);
  box-shadow: var(--am-shadow-overlay);
  color: var(--am-color-text);
}

.confirmation-dialog__header {
  display: grid;
  gap: var(--am-space-1);
}

.confirmation-dialog__eyebrow {
  color: var(--am-color-text-secondary);
  font-size: var(--am-font-size-xs);
  font-weight: 700;
  letter-spacing: 0.08em;
}

.confirmation-dialog__header h2,
.confirmation-dialog__message {
  margin: 0;
}

.confirmation-dialog__header h2 {
  font-size: var(--am-font-size-lg);
  line-height: 1.3;
}

.confirmation-dialog__message {
  color: var(--am-color-text-secondary);
  white-space: pre-line;
  overflow-wrap: anywhere;
  line-height: 1.65;
}

.confirmation-dialog__details {
  display: grid;
  gap: var(--am-space-3);
  margin: var(--am-space-4) 0 0;
  padding-block-start: var(--am-space-4);
  border-block-start: 1px solid var(--am-color-border);
  font-size: var(--am-font-size-sm);
  line-height: 1.65;
}

.confirmation-dialog__details > div {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: var(--am-space-3);
}

.confirmation-dialog__details dt {
  font-weight: 650;
}
.confirmation-dialog__details dd {
  margin: 0;
  color: var(--am-color-text-secondary);
  overflow-wrap: anywhere;
}

.confirmation-dialog__actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--am-space-2);
}

.confirmation-dialog__actions button {
  min-block-size: var(--am-size-control);
  padding-inline: var(--am-space-4);
  border: 1px solid var(--am-color-border-strong);
  border-radius: var(--am-radius-control);
  background: var(--am-color-surface);
  color: var(--am-color-text);
  cursor: pointer;
  transition:
    background-color var(--am-motion-fast) var(--am-ease-standard),
    border-color var(--am-motion-fast) var(--am-ease-standard),
    transform var(--am-motion-fast) var(--am-ease-standard);
}

.confirmation-dialog__actions button:hover:not(:disabled) {
  background: var(--am-color-surface-hover);
}

.confirmation-dialog__actions button:active:not(:disabled) {
  transform: scale(0.98);
}

.confirmation-dialog__actions button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.confirmation-dialog__confirm {
  border-color: var(--am-color-primary) !important;
  background: var(--am-color-primary) !important;
  color: var(--am-color-on-primary) !important;
}

.confirmation-dialog__confirm[data-tone='danger'] {
  border-color: var(--am-color-danger) !important;
  background: var(--am-color-danger) !important;
  color: var(--am-color-surface) !important;
}

.confirmation-dialog-enter-active,
.confirmation-dialog-leave-active {
  transition: opacity var(--am-motion-normal) var(--am-ease-standard);
}

.confirmation-dialog-enter-active .confirmation-dialog__panel,
.confirmation-dialog-leave-active .confirmation-dialog__panel {
  transition:
    opacity var(--am-motion-normal) var(--am-ease-standard),
    transform var(--am-motion-normal) var(--am-ease-emphasized);
}

.confirmation-dialog-enter-from,
.confirmation-dialog-leave-to,
.confirmation-dialog-enter-from .confirmation-dialog__panel,
.confirmation-dialog-leave-to .confirmation-dialog__panel {
  opacity: 0;
}

.confirmation-dialog-enter-from .confirmation-dialog__panel,
.confirmation-dialog-leave-to .confirmation-dialog__panel {
  transform: translateY(8px) scale(0.98);
}

@media (max-width: 576px) {
  .confirmation-dialog {
    place-items: end stretch;
    padding: 0;
  }

  .confirmation-dialog__panel {
    inline-size: 100%;
    max-block-size: min(86vh, 640px);
    max-block-size: min(86dvh, 640px);
    padding: var(--am-space-5) max(var(--am-space-4), env(safe-area-inset-right))
      max(var(--am-space-5), env(safe-area-inset-bottom))
      max(var(--am-space-4), env(safe-area-inset-left));
    border-end-start-radius: 0;
    border-end-end-radius: 0;
  }

  .confirmation-dialog__actions {
    display: grid;
    grid-template-columns: 1fr 1fr;
  }

  .confirmation-dialog-enter-from .confirmation-dialog__panel,
  .confirmation-dialog-leave-to .confirmation-dialog__panel {
    transform: translateY(20px);
  }
}

@media (prefers-reduced-motion: reduce) {
  .confirmation-dialog-enter-active,
  .confirmation-dialog-leave-active,
  .confirmation-dialog-enter-active .confirmation-dialog__panel,
  .confirmation-dialog-leave-active .confirmation-dialog__panel {
    transition-duration: 1ms;
  }
}
</style>
