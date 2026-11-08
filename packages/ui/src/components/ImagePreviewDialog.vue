<script setup lang="ts">
import { useTemplateRef } from 'vue'

import { useImagePreview } from '../composables/use-image-preview'
import AppDialog from './AppDialog.vue'
import RemoteImage from './music-sources/RemoteImage.vue'

/** Artwork expands across the lightbox; only the screen edges bound scrolling. */
const props = defineProps<{ open: boolean; src: string; title: string }>()
defineEmits<{ close: [] }>()
const { zoom, content, canvasStyle, imageStyle, setZoom, handleLoad } = useImagePreview(
  props,
  useTemplateRef<HTMLElement>('viewport'),
)
</script>

<template>
  <AppDialog
    appear
    presentation="image"
    :open="open"
    :title="content.title"
    close-label="关闭图片预览"
    @close="$emit('close')"
  >
    <div class="image-preview">
      <div
        ref="viewport"
        class="image-preview__viewport"
        tabindex="0"
        aria-label="封面预览，可滚动查看放大后的图片"
        @wheel.ctrl.prevent="setZoom(zoom + ($event.deltaY < 0 ? 0.25 : -0.25))"
        @click.self="$emit('close')"
      >
        <div class="image-preview__canvas" :style="canvasStyle" @click.self="$emit('close')">
          <RemoteImage
            class="image-preview__image"
            :src="content.src"
            :alt="content.title"
            loading="eager"
            :style="imageStyle"
            @load="handleLoad"
            @dblclick="setZoom(zoom === 1 ? 2 : 1)"
            @dragstart.prevent
          />
        </div>
      </div>
      <div class="image-preview__controls" role="group" aria-label="图片缩放">
        <button
          type="button"
          :disabled="zoom <= 1"
          aria-label="缩小图片"
          @click="setZoom(zoom - 0.5)"
        >
          −
        </button>
        <output aria-live="polite">{{ zoom * 100 }}%</output>
        <button
          type="button"
          :disabled="zoom >= 4"
          aria-label="放大图片"
          @click="setZoom(zoom + 0.5)"
        >
          ＋
        </button>
      </div>
    </div>
  </AppDialog>
</template>

<style scoped>
.image-preview {
  position: relative;
  display: grid;
  min-inline-size: 0;
  min-block-size: 0;
  block-size: 100%;
  pointer-events: none;
}
.image-preview__viewport {
  inline-size: 100%;
  block-size: 100%;
  overflow: auto;
  scrollbar-gutter: stable both-edges;
  overscroll-behavior: contain;
  touch-action: pan-x pan-y pinch-zoom;
  pointer-events: auto;
}
.image-preview__canvas {
  position: relative;
  overflow: hidden;
}
.image-preview__image {
  position: absolute;
  inset-block-start: 50%;
  inset-inline-start: 50%;
  display: block;
  max-inline-size: none;
  object-fit: contain;
  transform-origin: center;
  transition: transform var(--am-motion-normal) var(--am-ease-emphasized);
  user-select: none;
}
.image-preview__controls {
  position: absolute;
  inset-block-end: var(--am-space-3);
  z-index: 1;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: var(--am-space-2);
  justify-self: center;
  padding: var(--am-space-2);
  border-radius: var(--am-radius-control);
  background: rgb(0 0 0 / 55%);
  color: white;
  pointer-events: auto;
}
.image-preview__controls button {
  min-block-size: 44px;
  min-inline-size: 44px;
  padding-inline: var(--am-space-3);
  border: 1px solid var(--am-color-border);
  border-radius: var(--am-radius-control);
  background: var(--am-color-surface);
  color: var(--am-color-text);
  font: inherit;
  cursor: pointer;
}
.image-preview__controls button:is(:hover, :focus-visible):not(:disabled) {
  background: var(--am-color-surface-hover);
}
.image-preview__controls button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.image-preview__controls output {
  min-inline-size: 5ch;
  text-align: center;
  font-variant-numeric: tabular-nums;
}
.image-preview__viewport:focus-visible,
.image-preview__controls button:focus-visible {
  outline: var(--am-focus-ring);
  outline-offset: var(--am-focus-offset);
}
@media (prefers-reduced-motion: reduce) {
  .image-preview__image {
    transition: none;
  }
}
</style>
