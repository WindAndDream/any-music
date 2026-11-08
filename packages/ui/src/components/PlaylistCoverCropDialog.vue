<script setup lang="ts">
import { useId, useTemplateRef } from 'vue'

import type { PlaylistCoverCrop } from '../composables/library/playlist-cover-crop'
import { usePlaylistCoverCrop } from '../composables/library/use-playlist-cover-crop'
import AppDialog from './AppDialog.vue'
import AppIcon from './AppIcon.vue'

const props = defineProps<{
  source: ImageBitmap | null
  busy?: boolean
  error?: string
  suspended?: boolean
}>()
defineEmits<{ cancel: []; confirm: [crop: PlaylistCoverCrop] }>()
const helpId = useId()
const { ratio, zoom, crop, style, adjust, reset, start, move, endDrag, keydown } =
  usePlaylistCoverCrop(
    () => props.source,
    useTemplateRef<HTMLCanvasElement>('canvas'),
    useTemplateRef<HTMLElement>('frame'),
  )
</script>

<template>
  <AppDialog
    :open="source !== null"
    :suspended="suspended"
    title="调整歌单封面"
    description="拖动图片选择展示范围，再调整缩放。确认后才会替换封面。"
    size="compact"
    initial-focus-selector=".playlist-cover-crop__frame"
    return-focus-selector="input[aria-label='上传歌单封面']"
    @close="$emit('cancel')"
  >
    <fieldset class="playlist-cover-crop" :disabled="busy || suspended">
      <div class="playlist-cover-crop__shapes" role="group" aria-label="封面比例">
        <button type="button" :aria-pressed="ratio === 8 / 5" @click="adjust(8 / 5, zoom)">
          横向 8:5
        </button>
        <button type="button" :aria-pressed="ratio === 1" @click="adjust(1, zoom)">方形 1:1</button>
      </div>
      <div
        ref="frame"
        class="playlist-cover-crop__frame"
        :style="{ aspectRatio: String(ratio) }"
        tabindex="0"
        :inert="busy || suspended ? true : undefined"
        role="group"
        aria-label="封面展示范围，拖动图片或使用方向键调整"
        :aria-describedby="helpId"
        @pointerdown.prevent="start"
        @pointermove="move"
        @pointerup="endDrag"
        @pointercancel="endDrag"
        @lostpointercapture="endDrag"
        @keydown="keydown"
      >
        <canvas ref="canvas" :style="style" aria-hidden="true" />
        <span class="playlist-cover-crop__grid" aria-hidden="true" />
      </div>
      <p :id="helpId">框内即为保存范围。支持鼠标、触摸拖动和方向键；按住 Shift 可加快移动。</p>
      <label class="playlist-cover-crop__zoom">
        <span
          >缩放 <output>{{ Math.round(zoom * 100) }}%</output></span
        >
        <input
          type="range"
          min="1"
          max="3"
          step="0.01"
          :value="zoom"
          aria-label="封面缩放"
          @input="adjust(ratio, Number(($event.target as HTMLInputElement).value))"
        />
      </label>
      <p v-if="error" class="playlist-cover-crop__error" role="alert">{{ error }}</p>
      <div class="playlist-cover-crop__footer">
        <button type="button" @click="reset"><AppIcon name="refresh" :size="16" />重置</button>
        <button type="button" @click="$emit('cancel')">取消</button>
        <button class="playlist-cover-crop__confirm" type="button" @click="$emit('confirm', crop)">
          {{ busy ? '处理图片中…' : '使用此封面' }}
        </button>
      </div>
    </fieldset>
  </AppDialog>
</template>

<style scoped>
.playlist-cover-crop {
  display: grid;
  min-inline-size: 0;
  gap: var(--am-space-4);
  margin: 0;
  padding: 0;
  border: 0;
  color: var(--am-color-text);
}
.playlist-cover-crop__shapes,
.playlist-cover-crop__footer {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--am-space-2);
}
.playlist-cover-crop button {
  display: inline-flex;
  min-block-size: 44px;
  align-items: center;
  justify-content: center;
  gap: var(--am-space-2);
  padding: var(--am-space-2) var(--am-space-3);
  border: 1px solid var(--am-color-border);
  border-radius: var(--am-radius-control);
  background: var(--am-color-surface);
  color: inherit;
  font: inherit;
  cursor: pointer;
}
.playlist-cover-crop button[aria-pressed='true'] {
  border-color: var(--am-color-primary);
  background: var(--am-color-primary-soft);
  color: var(--am-color-primary);
}
.playlist-cover-crop button:hover:not(:disabled) {
  background: var(--am-color-surface-hover);
}
.playlist-cover-crop__frame {
  position: relative;
  inline-size: 100%;
  overflow: hidden;
  border-radius: var(--am-radius-artwork);
  background: white;
  cursor: grab;
  touch-action: none;
  user-select: none;
}
.playlist-cover-crop__frame:active {
  cursor: grabbing;
}
.playlist-cover-crop__frame canvas {
  position: absolute;
}
.playlist-cover-crop__grid {
  position: absolute;
  inset: 0;
  pointer-events: none;
  box-shadow: inset 0 0 0 2px rgb(255 255 255 / 90%);
  background:
    linear-gradient(to right, transparent calc(100% - 1px), rgb(255 255 255 / 50%) 0) 0 0 / 33.333%
      100%,
    linear-gradient(to bottom, transparent calc(100% - 1px), rgb(255 255 255 / 50%) 0) 0 0 / 100%
      33.333%;
}
.playlist-cover-crop p {
  margin: 0;
  color: var(--am-color-text-secondary);
  font-size: var(--am-font-size-xs);
  line-height: 1.6;
}
.playlist-cover-crop__zoom {
  display: grid;
  gap: var(--am-space-2);
}
.playlist-cover-crop__zoom span {
  display: flex;
  justify-content: space-between;
}
.playlist-cover-crop__zoom input {
  inline-size: 100%;
  min-block-size: 44px;
  margin: 0;
  accent-color: var(--am-color-primary);
}
.playlist-cover-crop__footer {
  justify-content: flex-end;
}
.playlist-cover-crop__footer button:first-child {
  margin-inline-end: auto;
}
.playlist-cover-crop .playlist-cover-crop__confirm {
  border-color: var(--am-color-primary);
  background: var(--am-color-primary);
  color: var(--am-color-on-primary);
}
.playlist-cover-crop .playlist-cover-crop__confirm:hover:not(:disabled) {
  background: var(--am-color-primary-hover);
}
.playlist-cover-crop .playlist-cover-crop__error {
  color: var(--am-color-danger);
}
.playlist-cover-crop :is(button, input):disabled {
  cursor: not-allowed;
  opacity: 0.5;
}
.playlist-cover-crop :is(button, input, [tabindex]):focus-visible {
  outline: var(--am-focus-ring);
  outline-offset: -3px;
}
</style>
