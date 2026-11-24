<script setup lang="ts">
import AppIcon from '../AppIcon.vue'
import LoadingSpinner from '../LoadingSpinner.vue'
import RemoteImage from '../music-sources/RemoteImage.vue'

defineProps<{ src?: string; alt: string }>()
</script>

<template>
  <span class="track-artwork">
    <template v-if="src">
      <RemoteImage :src="src" :alt="alt" />
      <LoadingSpinner class="track-artwork__loading" />
    </template>
    <AppIcon v-else name="music" />
  </span>
</template>

<style scoped>
.track-artwork {
  position: relative;
  display: grid;
  place-items: center;
  overflow: hidden;
  background: var(--am-color-surface-subtle);
  color: var(--am-color-text-secondary);
}
.track-artwork :deep(img) {
  position: absolute;
  inset: 0;
  display: block;
  inline-size: 100%;
  block-size: 100%;
  object-fit: cover;
}
.track-artwork > .track-artwork__loading {
  --am-loading-spinner-color: var(--am-color-text-secondary);

  display: none;
}
.track-artwork > :deep(img[data-image-state='loading']) + .track-artwork__loading {
  display: inline-block;
}
</style>
