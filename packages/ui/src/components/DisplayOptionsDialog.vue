<script setup lang="ts">
import { computed, nextTick, onScopeDispose, shallowRef, useTemplateRef, watch } from 'vue'

import AppDialog from './AppDialog.vue'
import AppIcon from './AppIcon.vue'

interface Option {
  id: string
  label: string
  description?: string
  columns?: number
  viewport?: 'desktop' | 'mobile'
  selected?: boolean
}
interface Section {
  id: string
  label: string
  description: string
  value: string
  options: readonly Option[]
}
const props = defineProps<{
  open: boolean
  suspended?: boolean
  title: string
  sections: readonly Section[]
}>()
const emit = defineEmits<{ close: []; select: [section: string, value: string] }>()
const activeId = shallowRef<string | null>(null)
const active = computed(() => props.sections.find(({ id }) => id === activeId.value))
const direction = shallowRef('forward')
const panel = useTemplateRef<HTMLElement>('panel')
let navigationVersion = 0
let resizeAnimation: Animation | undefined
function cancelResize() {
  navigationVersion += 1
  resizeAnimation?.cancel()
  resizeAnimation = undefined
}
onScopeDispose(cancelResize)
watch(
  () => props.open,
  () => {
    cancelResize()
    activeId.value = null
  },
)
watch(
  () => props.suspended,
  (suspended) => {
    if (suspended) cancelResize()
  },
)
watch(
  () => props.sections,
  () => {
    if (activeId.value && !active.value) activeId.value = null
  },
)
async function navigate(id: string | null) {
  if (!props.open || props.suspended || id === activeId.value) return
  const dialog = panel.value?.closest<HTMLElement>('[role="dialog"]')
  // Capture the currently animated size before cancellation so rapid returns stay continuous.
  const previousSize = dialog ? getComputedStyle(dialog).blockSize : undefined
  cancelResize()
  const version = navigationVersion
  direction.value = id ? 'forward' : 'back'
  activeId.value = id
  await nextTick()
  if (version !== navigationVersion || !props.open || props.suspended) return
  if (dialog && previousSize && !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
    const style = getComputedStyle(dialog)
    const duration = style.getPropertyValue('--am-motion-normal').trim()
    // The leaving page is out of flow; measure and resize with the slide, without waiting for it.
    if (previousSize !== style.blockSize) {
      resizeAnimation = dialog.animate?.(
        [{ blockSize: previousSize }, { blockSize: style.blockSize }],
        {
          duration: Number.parseFloat(duration) * (duration.endsWith('ms') ? 1 : 1000),
          easing: style.getPropertyValue('--am-ease-emphasized').trim(),
        },
      )
    }
  }
  panel.value?.focus({ preventScroll: true })
}
function select(value: string) {
  if (!active.value || props.suspended || !props.open) return
  emit('select', active.value.id, value)
  emit('close')
}
function deactivate(element: Element) {
  element.setAttribute('inert', '')
  element.setAttribute('aria-hidden', 'true')
}
function activate(element: Element) {
  element.removeAttribute('inert')
  element.removeAttribute('aria-hidden')
}
</script>
<template>
  <AppDialog
    class="am-display-options-dialog"
    :open="open"
    :suspended="suspended"
    :title="title"
    :description="active?.description"
    :back-action="
      active
        ? () => {
            void navigate(null)
          }
        : undefined
    "
    size="compact"
    @close="emit('close')"
  >
    <div class="am-display-options">
      <Transition
        :name="`am-display-${direction}`"
        @before-leave="deactivate"
        @before-enter="activate"
        @leave-cancelled="activate"
      >
        <div
          :key="active?.id ?? 'sections'"
          ref="panel"
          class="am-display-options__page"
          tabindex="-1"
          :aria-label="active?.label ?? '展示设置分类'"
        >
          <template v-if="!active">
            <button
              v-for="section in sections"
              :key="section.id"
              class="am-display-options__section"
              type="button"
              :data-display-section="section.id"
              @click="navigate(section.id)"
            >
              <span class="am-display-options__copy"
                ><strong>{{ section.label }}</strong
                ><small>{{ section.description }}</small></span
              ><AppIcon name="arrow-right" :size="18" />
            </button>
          </template>
          <template v-else>
            <div role="group" :aria-label="active.label" class="am-display-options__list">
              <button
                v-for="option in active.options"
                :key="option.id"
                class="am-display-options__option"
                :class="option.viewport ? `am-display-options__option--${option.viewport}` : ''"
                :data-mode="option.id"
                type="button"
                :aria-pressed="option.selected ?? active.value === option.id"
                @click="select(option.id)"
              >
                <span
                  class="am-display-options__preview"
                  :style="{ '--am-preview-columns': option.columns ?? 1 }"
                  :data-minimal="option.id === 'minimal'"
                  aria-hidden="true"
                  ><i v-for="index in option.columns ?? 1" :key="index"
                /></span>
                <span class="am-display-options__copy"
                  ><strong>{{ option.label }}</strong
                  ><small v-if="option.description">{{ option.description }}</small></span
                ><span class="am-display-options__check" aria-hidden="true">{{
                  (option.selected ?? active.value === option.id) ? '已选' : '选择'
                }}</span>
              </button>
            </div>
          </template>
        </div>
      </Transition>
    </div>
    <template v-if="active" #footer>
      <div class="am-display-options__actions">
        <button class="am-display-options__back" type="button" @click="navigate(null)">返回</button>
      </div>
    </template>
  </AppDialog>
</template>
<style scoped>
/* The height tween can temporarily constrain the incoming page. Clip during the slide;
   restore normal content scrolling afterwards so short screens remain usable. */
.am-display-options-dialog
  :deep(
    .app-dialog__content:has(
      .am-display-forward-enter-active,
      .am-display-forward-leave-active,
      .am-display-back-enter-active,
      .am-display-back-leave-active
    )
  ) {
  overflow: hidden;
}
.am-display-options {
  position: relative;
  display: grid;
  overflow: hidden;
}
.am-display-options__page {
  grid-area: 1 / 1;
  display: grid;
  align-content: start;
  gap: var(--am-space-3);
  min-inline-size: 0;
  outline: none;
}
.am-display-options__list {
  display: grid;
  gap: var(--am-space-3);
}
.am-display-options__section,
.am-display-options__option,
.am-display-options__back {
  display: flex;
  align-items: center;
  gap: var(--am-space-3);
  padding: var(--am-space-3);
  border: 1px solid var(--am-color-border);
  border-radius: var(--am-radius-control);
  color: var(--am-color-text);
  background: var(--am-color-surface);
  font: inherit;
  text-align: start;
  cursor: pointer;
}
.am-display-options__section:hover,
.am-display-options__option:hover,
.am-display-options__back:hover {
  background: var(--am-color-surface-hover);
}
.am-display-options__section:focus-visible,
.am-display-options__option:focus-visible,
.am-display-options__back:focus-visible {
  outline: var(--am-focus-ring);
  outline-offset: -3px;
}
.am-display-options__copy {
  display: grid;
  flex: 1;
  gap: var(--am-space-1);
  min-inline-size: 0;
}
.am-display-options__copy small,
.am-display-options__check {
  color: var(--am-color-text-secondary);
  font-size: var(--am-font-size-xs);
  overflow-wrap: anywhere;
}
.am-display-options__section {
  min-block-size: 80px;
}
.am-display-options__back {
  min-block-size: 44px;
  padding: var(--am-space-2) var(--am-space-4);
  border-color: var(--am-color-border-strong);
}
.am-display-options__actions {
  display: flex;
  justify-content: flex-end;
}
.am-display-options__option {
  display: grid;
  grid-template-columns: 96px minmax(0, 1fr) auto;
  min-block-size: 86px;
  border-radius: var(--am-radius-sm);
}
.am-display-options__option[aria-pressed='true'] {
  border-color: var(--am-color-primary);
  background: var(--am-color-primary-container);
  box-shadow: 0 0 0 2px var(--am-color-focus-ring);
}
.am-display-options__preview {
  display: grid;
  grid-template-columns: repeat(var(--am-preview-columns), minmax(0, 1fr));
  gap: 3px;
  block-size: 48px;
}
.am-display-options__preview i {
  border-radius: var(--am-radius-detail);
  background: var(--am-color-primary);
  opacity: 0.55;
}
.am-display-options__preview[data-minimal='true'] {
  padding: 8px;
  box-sizing: border-box;
  border: 1px solid var(--am-color-border);
}
.am-display-options__option--mobile {
  display: none;
}
.am-display-forward-enter-active,
.am-display-forward-leave-active,
.am-display-back-enter-active,
.am-display-back-leave-active {
  transition:
    transform var(--am-motion-normal) var(--am-ease-emphasized),
    opacity var(--am-motion-normal);
}
.am-display-forward-enter-from,
.am-display-back-leave-to {
  transform: translateX(24px);
  opacity: 0;
}
.am-display-forward-leave-to,
.am-display-back-enter-from {
  transform: translateX(-24px);
  opacity: 0;
}
.am-display-forward-leave-active,
.am-display-back-leave-active {
  position: absolute;
  inset-block-start: 0;
  inset-inline: 0;
  pointer-events: none;
}
@container am-dialog (max-width: 480px) {
  .am-display-options__option {
    grid-template-columns: 72px minmax(0, 1fr);
  }
  .am-display-options__check {
    grid-column: 2;
  }
}
@media (max-width: 600px) {
  .am-display-options__option--desktop {
    display: none;
  }
  .am-display-options__option--mobile {
    display: grid;
  }
  .am-display-options__option {
    grid-template-columns: 64px minmax(0, 1fr);
    min-block-size: 64px;
    gap: var(--am-space-2);
    padding: var(--am-space-2);
  }
  .am-display-options__preview {
    block-size: 38px;
  }
}
@media (prefers-reduced-motion: reduce) {
  .am-display-options__page {
    transition: none;
  }
}
</style>
