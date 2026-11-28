<script setup lang="ts">
/** Slides in a replacement view while navigation controls stay mounted. */
defineProps<{ viewKey: string; reverse?: boolean }>()
defineSlots<{ default: () => unknown }>()

function removePreviousView(_element: Element, done: () => void): void {
  // Remove the previous controls before the new view enters the layout.
  done()
}
</script>

<template>
  <div class="sliding-view">
    <Transition
      :name="reverse ? 'sliding-view-back' : 'sliding-view-forward'"
      @leave="removePreviousView"
    >
      <div :key="viewKey" class="sliding-view__content"><slot /></div>
    </Transition>
  </div>
</template>

<style scoped>
.sliding-view,
.sliding-view__content {
  display: flex;
  flex: 1 0 auto;
  flex-direction: column;
  min-inline-size: 0;
}

@media (prefers-reduced-motion: no-preference) {
  .sliding-view:has(> :is(.sliding-view-forward-enter-active, .sliding-view-back-enter-active)) {
    overflow-x: clip;
  }
  .sliding-view-forward-enter-active,
  .sliding-view-back-enter-active {
    transition:
      transform var(--am-motion-normal) var(--am-ease-emphasized),
      opacity var(--am-motion-normal) var(--am-ease-standard);
  }
  .sliding-view-forward-enter-from {
    transform: translateX(100%);
    opacity: 0;
  }
  .sliding-view-back-enter-from {
    transform: translateX(-100%);
    opacity: 0;
  }
}
</style>
