<script setup lang="ts">
import { nextTick } from 'vue'

const props = defineProps<{ page: string; returning?: boolean; focusSelector: string }>()
function leave(element: Element) {
  const root = element.getRootNode() as Document | ShadowRoot
  if (root.activeElement && element.contains(root.activeElement))
    element
      .closest('[role="dialog"]')
      ?.querySelector<HTMLElement>('.app-dialog__close')
      ?.focus({ preventScroll: true })
  element.setAttribute('inert', '')
  element.setAttribute('aria-hidden', 'true')
}
function enter(element: Element) {
  element.removeAttribute('inert')
  element.removeAttribute('aria-hidden')
}
async function focus(element: Element) {
  await nextTick()
  if (element.getAttribute('data-dialog-page') === props.page)
    element.querySelector<HTMLElement>(props.focusSelector)?.focus({ preventScroll: true })
}
</script>

<template>
  <div class="dialog-pages">
    <Transition
      :name="returning ? 'dialog-page-back' : 'dialog-page-forward'"
      @before-enter="enter"
      @before-leave="leave"
      @leave-cancelled="enter"
      @after-enter="focus"
    >
      <div :key="page" class="dialog-pages__view" :data-dialog-page="page"><slot /></div>
    </Transition>
  </div>
</template>

<style scoped>
.dialog-pages {
  position: relative;
  min-inline-size: 0;
  min-block-size: 220px;
  overflow: hidden;
}
.dialog-pages__view {
  display: grid;
  gap: var(--am-space-3);
  min-inline-size: 0;
}
.dialog-page-forward-enter-active,
.dialog-page-forward-leave-active,
.dialog-page-back-enter-active,
.dialog-page-back-leave-active {
  transition:
    transform var(--am-motion-normal) var(--am-ease-emphasized),
    opacity var(--am-motion-normal) var(--am-ease-standard);
}
.dialog-page-forward-leave-active,
.dialog-page-back-leave-active {
  position: absolute;
  inset: 0;
}
.dialog-page-forward-enter-from,
.dialog-page-back-leave-to {
  opacity: 0;
  transform: translateX(100%);
}
.dialog-page-forward-leave-to,
.dialog-page-back-enter-from {
  opacity: 0;
  transform: translateX(-100%);
}
@media (prefers-reduced-motion: reduce) {
  .dialog-page-forward-enter-active,
  .dialog-page-forward-leave-active,
  .dialog-page-back-enter-active,
  .dialog-page-back-leave-active {
    transition: none;
  }
}
</style>
