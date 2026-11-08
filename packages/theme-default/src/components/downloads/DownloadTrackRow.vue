<script setup lang="ts">
import type { Track } from '@any-music/core'
import AppIcon from '@any-music/ui/components/AppIcon.vue'
import type { DownloadListEntry } from '@any-music/ui/library'
import type { CatalogTrackDisplayMode } from '@any-music/ui/library'
import { computed } from 'vue'
import type { CSSProperties } from 'vue'

import TrackRow from '../music-sources/TrackRow.vue'
import { getDownloadTrackAction, getDownloadTrackStatus } from './download-track-presentation'

const props = defineProps<{
  entry: DownloadListEntry
  customTags?: readonly string[]
  selected: boolean
  selectable?: boolean
  contextLabel: string
  displayMode: CatalogTrackDisplayMode
  favorite: boolean
  active: boolean
  invalid: boolean
  reorderable?: boolean
  dragging?: boolean
  getReorderStyle?: (id: string) => CSSProperties | undefined
}>()
const emit = defineEmits<{
  select: [id: string]
  pause: [id: string]
  resume: [id: string]
  play: [track: Track]
  favorite: [track: Track]
  showActions: [id: string]
  dragStart: [event: PointerEvent, itemId: string]
  shift: [itemId: string, direction: -1 | 1]
  dragCancel: []
}>()
const action = computed(() => getDownloadTrackAction(props.entry))
const detail = computed(() => getDownloadTrackStatus(props.entry))
const reorderStyle = computed(() => props.getReorderStyle?.(props.entry.item.id))
</script>

<template>
  <div
    class="download-track list__cell"
    :class="{ 'download-track--dragging': dragging }"
    :data-status="entry.state"
    :data-queue-drop-kind="reorderable ? 'track' : undefined"
    :data-queue-drop-id="reorderable ? entry.item.id : undefined"
  >
    <div
      class="download-track__surface"
      :class="{ 'download-track__surface--moving': reorderStyle || dragging }"
      data-am-grid-motion
      :style="reorderStyle"
    >
      <TrackRow
        :reorderable="reorderable"
        @cover-press="emit('dragStart', $event, entry.item.id)"
        @shift="emit('shift', entry.item.id, $event)"
        @cancel-drag="emit('dragCancel')"
        :track="entry.item.track"
        :custom-tags="customTags"
        :active="active"
        :invalid="invalid"
        :favorite="favorite"
        :selectable="props.selectable"
        :selected="selected"
        :display-mode="displayMode"
        :context-label="contextLabel"
        :trailing-meta="detail"
        :minimal-detail="detail"
        @select="emit('select', entry.item.id)"
        @play="emit('play', $event)"
        @favorite="emit('favorite', $event)"
        @show-actions="emit('showActions', entry.item.id)"
      >
        <template v-if="reorderable" #cover-select>
          <button
            class="track__cover-select download-track__cover-control"
            data-queue-handle
            type="button"
            :aria-label="`${props.selectable ? (selected ? '取消选择' : '选择') : '排序'}下载歌曲 ${entry.item.track.title}；长按封面拖动排序；方向键可逐首移动`"
            :aria-pressed="props.selectable ? selected : undefined"
            :title="`${props.selectable ? '点击选择 · ' : ''}长按封面拖动排序 · 方向键微调 · Escape 取消`"
            @pointerdown.stop="emit('dragStart', $event, entry.item.id)"
            @click.stop="props.selectable && emit('select', entry.item.id)"
            @contextmenu.prevent
            @dragstart.prevent
            @keydown.up.prevent="emit('shift', entry.item.id, -1)"
            @keydown.down.prevent="emit('shift', entry.item.id, 1)"
            @keydown.left.prevent="emit('shift', entry.item.id, -1)"
            @keydown.right.prevent="emit('shift', entry.item.id, 1)"
            @keydown.esc.stop="emit('dragCancel')"
          ></button>
        </template>
        <template #actions>
          <button
            class="track__button track__button--primary"
            type="button"
            :disabled="invalid"
            :aria-label="`播放《${entry.item.track.title}》`"
            @click="emit('play', entry.item.track)"
          >
            <AppIcon name="play" :size="15" /><span>播放</span>
          </button>
          <button
            class="track__button"
            type="button"
            :disabled="invalid && !favorite"
            :aria-pressed="favorite"
            :aria-label="`${favorite ? '取消喜欢' : '喜欢'}《${entry.item.track.title}》`"
            @click="emit('favorite', entry.item.track)"
          >
            <AppIcon name="heart" :size="15" /><span>{{ favorite ? '已喜欢' : '喜欢' }}</span>
          </button>
          <button
            class="track__button"
            type="button"
            :disabled="action.disabled || (invalid && action.event === 'resume')"
            :aria-label="action.ariaLabel"
            @click="
              action.event === 'pause'
                ? emit('pause', entry.item.id)
                : emit('resume', entry.item.id)
            "
          >
            <AppIcon :name="action.icon" :size="15" /><span>{{ action.label }}</span>
          </button>
          <button
            class="track__button track__button--more"
            data-card-menu
            type="button"
            aria-haspopup="dialog"
            :aria-label="`查看《${entry.item.track.title}》的操作`"
            @click="emit('showActions', entry.item.id)"
          >
            <AppIcon name="more" :size="15" /><span>操作</span>
          </button>
        </template>
      </TrackRow>
    </div>
  </div>
</template>

<style scoped>
.download-track {
  container: am-track-card / inline-size;
  display: grid;
  min-inline-size: 0;
  position: relative;
}
.download-track__surface {
  display: grid;
  min-inline-size: 0;
  position: relative;
  border-radius: var(--am-radius-card);
  transition: transform var(--am-motion-normal) var(--am-ease-emphasized);
}
.download-track--dragging {
  z-index: 2;
}
.download-track__surface--moving {
  will-change: transform;
}
.download-track--dragging .download-track__surface {
  box-shadow: var(--am-shadow-card);
  outline: 1px solid var(--am-color-primary);
  opacity: 0.96;
  transition: none;
  pointer-events: none;
  user-select: none;
}
.download-track__surface--moving :deep(.track-card) {
  content-visibility: visible;
}
.download-track__cover-control {
  inline-size: 100%;
  block-size: 100%;
  padding: 0;
  border: 0;
  border-radius: var(--am-radius-sm);
  background: transparent;
  cursor: grab;
  user-select: none;
  -webkit-touch-callout: none;
}
.download-track__cover-control:focus-visible {
  outline: var(--am-focus-ring);
  outline-offset: -3px;
}
@media (prefers-reduced-motion: reduce) {
  .download-track__surface {
    transition: none;
  }
}
</style>
