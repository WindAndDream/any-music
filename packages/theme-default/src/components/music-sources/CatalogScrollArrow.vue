<script setup lang="ts">
import AppIcon from '@any-music/ui/components/AppIcon.vue'

defineProps<{ atEnd: boolean; forwardLabel: string; backLabel: string }>()
defineEmits<{ advance: [] }>()
</script>

<template>
  <button
    class="catalog-scroll-arrow"
    type="button"
    :aria-label="atEnd ? backLabel : forwardLabel"
    @click="$emit('advance')"
  >
    <AppIcon :name="atEnd ? 'arrow-left' : 'arrow-right'" :size="28" />
  </button>
</template>

<style scoped>
.catalog-scroll-arrow {
  position: relative;
  isolation: isolate;
  display: grid;
  inline-size: 44px;
  block-size: 44px;
  place-items: center;
  padding: 0;
  border: 0;
  border-radius: var(--am-radius-control);
  background: transparent;
  color: var(--am-color-text-secondary);
  cursor: pointer;
  transition:
    background-color var(--am-motion-fast) var(--am-ease-standard),
    color var(--am-motion-fast) var(--am-ease-standard);
}

.catalog-scroll-arrow::before {
  position: absolute;
  z-index: -1;
  inset: 0 0 0 -16px;
  background: linear-gradient(
    to right,
    transparent,
    var(--am-operator-actions-background, var(--am-color-surface))
  );
  backdrop-filter: blur(12px);
  mask-image: linear-gradient(to right, transparent, black 55%);
  pointer-events: none;
  content: '';
}

.catalog-scroll-arrow:focus-visible {
  background: var(--am-color-surface-hover);
  color: var(--am-color-primary);
  outline: var(--am-focus-ring);
  outline-offset: calc(-1 * var(--am-focus-offset));
}

@media (hover: hover) {
  .catalog-scroll-arrow:hover {
    background: var(--am-color-surface-hover);
    color: var(--am-color-primary);
  }
}

@media (prefers-reduced-motion: reduce) {
  .catalog-scroll-arrow {
    transition: none;
  }
}
</style>
