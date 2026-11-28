<script setup lang="ts">
defineProps<{ label?: string }>()
</script>

<template>
  <span
    class="loading-spinner"
    :role="label ? 'status' : undefined"
    :aria-hidden="!label || undefined"
  >
    <span v-if="label" class="am-sr-only">{{ label }}</span>
  </span>
</template>

<style scoped>
.loading-spinner {
  display: inline-block;
  box-sizing: border-box;
  inline-size: 18px;
  block-size: 18px;
  color: var(--am-loading-spinner-color, var(--am-color-accent));
  border: 2px solid color-mix(in srgb, currentColor 24%, transparent);
  border-block-start-color: currentColor;
  border-radius: 50%;
  vertical-align: middle;
  animation: loading-spinner-rotate 720ms linear infinite;
}

@keyframes loading-spinner-rotate {
  to {
    transform: rotate(1turn);
  }
}

@media (prefers-reduced-motion: reduce) {
  .loading-spinner {
    animation: none;
  }
}
</style>
