<script setup lang="ts">
import AppIcon from '@any-music/ui/components/AppIcon.vue'
import RemoteImage from '@any-music/ui/components/music-sources/RemoteImage.vue'
import { PLAYLIST_COVER_ACCEPT } from '@any-music/ui/library'

import TrackActionButton from '../music-sources/TrackActionButton.vue'

/** Controlled artwork field; upload/crop state and preview dialogs stay with the editor. */
defineProps<{ previewUrl?: string; busy: boolean; showPreview: boolean }>()
defineEmits<{ select: [event: Event]; preview: []; remove: [] }>()
</script>

<template>
  <div class="playlist-cover-field" :class="{ 'playlist-cover-field--preview': showPreview }">
    <strong class="playlist-cover-field__heading">歌单封面 <small>选填</small></strong>
    <div class="playlist-cover-field__content">
      <button
        v-if="showPreview"
        class="playlist-cover-field__preview"
        type="button"
        aria-label="预览歌单封面"
        :disabled="!previewUrl"
        @click="$emit('preview')"
      >
        <RemoteImage v-if="previewUrl" :src="previewUrl" alt="歌单封面预览" loading="eager" />
        <AppIcon v-else name="playlist" :size="32" />
      </button>
      <p>JPG、PNG、WebP，最大 5 MB；上传后可拖动、缩放并选择封面展示范围。</p>
    </div>
    <div
      class="playlist-cover-field__actions"
      :class="{ 'playlist-cover-field__actions--paired': previewUrl }"
    >
      <TrackActionButton
        v-if="previewUrl"
        icon="trash"
        label="移除封面"
        inline
        danger
        :disabled="busy"
        @click="$emit('remove')"
      />
      <label
        class="playlist-cover-field__file"
        :class="{ 'playlist-cover-field__file--busy': busy }"
      >
        <AppIcon name="image" :size="18" />{{
          busy ? '处理中…' : previewUrl ? '更换封面' : '上传封面'
        }}
        <input
          type="file"
          :accept="PLAYLIST_COVER_ACCEPT"
          aria-label="上传歌单封面"
          :disabled="busy"
          @change="$emit('select', $event)"
        />
      </label>
    </div>
  </div>
</template>

<style scoped>
.playlist-cover-field {
  display: grid;
  min-inline-size: 0;
  gap: var(--am-space-3);
}
.playlist-cover-field__heading {
  font-size: var(--am-font-size-sm);
  font-weight: 650;
}
.playlist-cover-field__heading small,
.playlist-cover-field__content p {
  color: var(--am-color-text-secondary);
  font-size: var(--am-font-size-xs);
  font-weight: 400;
}
.playlist-cover-field__content p {
  margin: 0;
  line-height: 1.6;
  overflow-wrap: anywhere;
}
.playlist-cover-field--preview .playlist-cover-field__content {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  align-items: center;
  gap: var(--am-space-3);
}
.playlist-cover-field__preview {
  display: grid;
  place-items: center;
  inline-size: 100%;
  min-inline-size: 0;
  aspect-ratio: 8 / 5;
  overflow: hidden;
  padding: 0;
  border: 0;
  border-radius: var(--am-radius-sm);
  background: linear-gradient(
    135deg,
    var(--am-color-primary-container),
    var(--am-color-surface-subtle)
  );
  color: var(--am-color-primary);
  cursor: zoom-in;
}
.playlist-cover-field__preview:disabled {
  cursor: default;
}
.playlist-cover-field__preview :deep(img) {
  inline-size: 100%;
  block-size: 100%;
  object-fit: contain;
}
.playlist-cover-field__actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: var(--am-space-3);
}
.playlist-cover-field__actions--paired {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
}
.playlist-cover-field__actions--paired .playlist-cover-field__file {
  grid-column: 2;
}
.playlist-cover-field__file {
  position: relative;
  display: inline-flex;
  flex: 0 0 50%;
  align-items: center;
  justify-content: center;
  gap: var(--am-space-2);
  box-sizing: border-box;
  min-inline-size: 0;
  min-block-size: 44px;
  overflow: hidden;
  padding: var(--am-space-2);
  border: 1px solid var(--am-color-border-strong);
  border-radius: var(--am-radius-control);
  background: var(--am-color-surface);
  color: var(--am-color-primary);
  box-shadow: none;
  cursor: pointer;
  font: 650 var(--am-font-size-xs) var(--am-font-family);
  white-space: nowrap;
  transition:
    background-color var(--am-motion-fast) var(--am-ease-standard),
    border-color var(--am-motion-fast) var(--am-ease-standard);
}
.playlist-cover-field__file > .app-icon {
  flex: 0 0 auto;
  transition: transform var(--am-motion-normal) var(--am-ease-emphasized);
}
.playlist-cover-field__file input {
  position: absolute;
  inset: 0;
  inline-size: 100%;
  block-size: 100%;
  opacity: 0;
  cursor: pointer;
}
.playlist-cover-field__file--busy {
  opacity: 0.5;
  cursor: not-allowed;
}
.playlist-cover-field__file:not(.playlist-cover-field__file--busy):is(:hover, :focus-within) {
  border-color: var(--am-color-primary);
  background: var(--am-color-primary-soft);
}
.playlist-cover-field__preview:focus-visible,
.playlist-cover-field__file:focus-within {
  outline: var(--am-focus-ring);
  outline-offset: -3px;
}
@media (prefers-reduced-motion: no-preference) {
  .playlist-cover-field__file:not(.playlist-cover-field__file--busy):is(:hover, :focus-within)
    > .app-icon {
    transform: translateY(-3px) rotate(-8deg) scale(1.08);
  }
}
@media (prefers-reduced-motion: reduce) {
  .playlist-cover-field__file,
  .playlist-cover-field__file > .app-icon {
    transition: none;
  }
}
</style>
