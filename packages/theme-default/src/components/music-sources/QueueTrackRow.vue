<script setup lang="ts">
import type { Track } from '@any-music/core'
import { useTrackName } from '@any-music/ui/library'
import type { CatalogTrackDisplayMode, MobileTrackColumns } from '@any-music/ui/library'
import { computed } from 'vue'
import type { CSSProperties } from 'vue'

import TrackRow from './TrackRow.vue'

/** 待听封面始终支持长按排序；选择模式下短按选择；其余内容复用歌曲列表。 */
const props = defineProps<{
  track: Track
  customTags?: readonly string[]
  position: number
  contextLabel: string
  addedAtMs?: number
  dateLabel?: string
  active: boolean
  selected: boolean
  selectable?: boolean
  dragging: boolean
  getReorderStyle: (id: string) => CSSProperties | undefined
  favorite: boolean
  invalid: boolean
  downloadBusy: boolean
  displayMode: CatalogTrackDisplayMode
  mobileColumns: MobileTrackColumns
  /** The flat virtual cell owns stable drop geometry and pointer motion. */
  virtualPlacement?: boolean
}>()
const emit = defineEmits<{
  select: [trackId: string]
  play: [trackId: string]
  favorite: [track: Track]
  download: [track: Track]
  showActions: [trackId: string]
  dragStart: [event: PointerEvent, trackId: string]
  shift: [trackId: string, direction: -1 | 1]
  dragCancel: []
}>()
const addedLabel = computed(() =>
  props.addedAtMs === undefined
    ? `${props.dateLabel ?? '添加'}时间未知`
    : `${props.dateLabel ?? '添加'}于 ${new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium' }).format(props.addedAtMs)}`,
)
const { displayName } = useTrackName(() => props.track)
// 在单张卡片内订阅位移，避免每帧重建整个网格并触发 TransitionGroup 的全量布局测量。
const reorderStyle = computed(() =>
  props.virtualPlacement ? undefined : props.getReorderStyle(props.track.id),
)
</script>

<template>
  <div
    class="queue-track list__cell"
    :data-am-continuity-item="track.id"
    :class="{ 'queue-track--dragging': dragging }"
    :data-mobile-columns="mobileColumns"
    :data-queue-drop-kind="virtualPlacement ? undefined : 'track'"
    :data-queue-drop-id="virtualPlacement ? undefined : track.id"
  >
    <!-- Own the motion layer: themed row renderers behind a slot boundary do not inherit this SFC's scope. -->
    <div
      class="queue-track__surface"
      :class="{ 'queue-track__surface--shifted': reorderStyle && !dragging }"
      :data-am-grid-motion="virtualPlacement ? undefined : ''"
      :style="reorderStyle"
    >
      <TrackRow
        :reorderable="true"
        @cover-press="emit('dragStart', $event, track.id)"
        @shift="emit('shift', track.id, $event)"
        @cancel-drag="emit('dragCancel')"
        :track="track"
        :custom-tags="customTags"
        :active="active"
        :selectable="props.selectable"
        :selected="selected"
        :invalid="invalid"
        :favorite="favorite"
        :download-busy="downloadBusy"
        :display-mode="displayMode"
        :context-label="contextLabel"
        :trailing-meta="addedLabel"
        @select="emit('select', $event)"
        @play="emit('play', track.id)"
        @favorite="emit('favorite', $event)"
        @download="emit('download', $event)"
        @show-actions="emit('showActions', track.id)"
      >
        <template #cover-select>
          <button
            class="track__cover-select queue-track__cover-control"
            data-queue-handle
            :data-am-focus-restore-key="`track:${track.id}:play`"
            type="button"
            :aria-label="`${props.selectable ? (selected ? '取消选择' : '选择') : '排序'}歌曲 ${displayName}；第 ${position} 首；长按封面拖动排序；方向键可逐首移动`"
            :aria-pressed="props.selectable ? selected : undefined"
            :title="`${props.selectable ? '点击选择 · ' : ''}长按封面拖动排序 · 方向键微调 · Escape 取消`"
            @pointerdown.stop="emit('dragStart', $event, track.id)"
            @click.stop="props.selectable && emit('select', track.id)"
            @contextmenu.prevent
            @dragstart.prevent
            @keydown.up.prevent="emit('shift', track.id, -1)"
            @keydown.down.prevent="emit('shift', track.id, 1)"
            @keydown.left.prevent="emit('shift', track.id, -1)"
            @keydown.right.prevent="emit('shift', track.id, 1)"
            @keydown.esc.stop="emit('dragCancel')"
          ></button>
        </template>
      </TrackRow>
    </div>
  </div>
</template>

<style scoped>
.queue-track {
  container: am-track-card / inline-size;
  display: grid;
  min-inline-size: 0;
  position: relative;
}
.queue-track--dragging {
  z-index: 2;
}
.queue-track__surface {
  display: grid;
  min-inline-size: 0;
  position: relative;
  border-radius: var(--am-radius-card);
  transition: transform var(--am-motion-normal) var(--am-ease-emphasized);
}
.queue-track--dragging .queue-track__surface {
  box-shadow: var(--am-shadow-card);
  outline: 1px solid var(--am-color-primary);
  opacity: 0.96;
  transition: none;
  pointer-events: none;
  user-select: none;
}
.queue-track--dragging .queue-track__surface :deep(.track-card) {
  content-visibility: visible;
}
.queue-track__surface--shifted {
  will-change: transform;
}
.queue-track__cover-control {
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
.queue-track__cover-control:focus-visible {
  outline: var(--am-focus-ring);
  /* 焦点画在封面内部，不被内容裁切；右上角继续保留复选框。 */
  outline-offset: -3px;
}
@media (prefers-reduced-motion: reduce) {
  .queue-track__surface {
    transition: none;
  }
}
</style>
