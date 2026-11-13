<script setup lang="ts">
import type { Track } from '@any-music/core'
import AppIcon from '@any-music/ui/components/AppIcon.vue'
import CollectionTagSummary from '@any-music/ui/components/CollectionTagSummary.vue'
import RemoteImage from '@any-music/ui/components/music-sources/RemoteImage.vue'
import { computed } from 'vue'

const props = defineProps<{
  track: Track
  title: string
  active?: boolean
  playing?: boolean
  progress?: number
  invalid?: boolean
  selected?: boolean
  selectable?: boolean
  detail?: string
  customTags?: readonly string[]
  focusId?: string
  selectionDescription?: string
  reorderable?: boolean
  readonly?: boolean
  /** Reuse the native selection layout without playback or content actions. */
  selectionOnly?: boolean
  disabled?: boolean
}>()
const emit = defineEmits<{
  play: []
  pause: []
  actions: []
  select: []
  coverPress: [event: PointerEvent]
  shift: [direction: -1 | 1]
  cancelDrag: []
}>()
function handleSelectionClick(event: MouseEvent) {
  if (props.readonly || props.disabled || !props.selectable) return
  if ((event.target as Element | null)?.closest?.('[data-card-menu], label')) return
  // Capture before artwork playback so every non-menu region toggles exactly once.
  event.preventDefault()
  event.stopPropagation()
  emit('select')
}
function handleCoverClick() {
  if (props.readonly || props.disabled) return
  // Batch selection takes precedence over playback and availability, including the current song.
  if (props.selectable) {
    emit('select')
    return
  }
  if (props.selectionOnly) return
  if (props.invalid) return
  if (props.playing) emit('pause')
  else emit('play')
}
function shift(event: KeyboardEvent, direction: -1 | 1) {
  if (props.reorderable) {
    event.preventDefault()
    emit('shift', direction)
  }
}
const artist = computed(
  () => props.track.artists.map(({ name }) => name).join(' / ') || '创作者未知',
)
const duration = computed(() => {
  if (props.track.durationMs === undefined) return ''
  const seconds = Math.floor(props.track.durationMs / 1000)
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
})
const progressLength = computed(() => Math.max(0, Math.min(1, props.progress ?? 0)) * 100)
const selectionLabel = computed(
  () =>
    `${props.selected ? '取消选择' : '选择'}${props.selectionDescription ?? `歌曲 ${props.title}`}`,
)
</script>

<template>
  <article
    class="am-minimal-track"
    :data-active="active"
    :data-selectable="!readonly && selectable"
    :data-selected="selectable && selected"
    :data-invalid="invalid"
    :data-readonly="readonly"
    @click.capture="handleSelectionClick"
  >
    <svg v-if="active" class="am-minimal-track__progress" aria-hidden="true">
      <rect x="1" y="1" rx="9" pathLength="100" :stroke-dasharray="`${progressLength} 100`" />
    </svg>
    <div
      v-if="readonly || selectionOnly"
      class="am-minimal-track__cover"
      :data-readonly="readonly ? 'true' : undefined"
    >
      <RemoteImage v-if="track.artworkUrl" :src="track.artworkUrl" :alt="`${title} 封面`" />
      <AppIcon v-else name="music" :size="26" />
    </div>
    <button
      v-else
      class="am-minimal-track__cover"
      type="button"
      :disabled="disabled || (!selectable && invalid && !reorderable)"
      :aria-disabled="(!selectable && invalid) || undefined"
      :aria-label="`${selectable ? selectionLabel : `${playing ? '暂停' : '播放'}《${title}》`}${reorderable ? '；长按封面拖动排序，方向键调整顺序' : ''}`"
      :title="!selectable && playing ? '正在播放，点击暂停' : undefined"
      :aria-pressed="selectable ? Boolean(selected) : undefined"
      :data-queue-handle="reorderable ? '' : undefined"
      :data-am-focus-key="`track:${focusId ?? track.id}:play`"
      @click="handleCoverClick"
      @pointerdown="reorderable && emit('coverPress', $event)"
      @contextmenu="reorderable && $event.preventDefault()"
      @dragstart.prevent
      @keydown.up="shift($event, -1)"
      @keydown.left="shift($event, -1)"
      @keydown.down="shift($event, 1)"
      @keydown.right="shift($event, 1)"
      @keydown.esc="reorderable && emit('cancelDrag')"
    >
      <RemoteImage v-if="track.artworkUrl" :src="track.artworkUrl" :alt="`${title} 封面`" />
      <AppIcon v-else name="music" :size="26" />
      <span
        v-if="!readonly && !selectionOnly && !selectable"
        class="am-minimal-track__play"
        aria-hidden="true"
      >
        <span class="am-minimal-track__play-icon">
          <AppIcon :name="playing ? 'waveform' : 'play'" :size="24" />
        </span>
      </span>
    </button>
    <div class="am-minimal-track__copy">
      <h3 :title="title">{{ title }}</h3>
      <p :title="artist">{{ artist }}</p>
      <div class="am-minimal-track__metadata">
        <p class="am-minimal-track__detail" :title="invalid ? '歌曲已失效' : detail">
          {{ invalid ? '歌曲已失效' : [duration, detail].filter(Boolean).join(' · ') }}
        </p>
        <CollectionTagSummary :tags="customTags ?? []" label="歌曲标签" single-line />
      </div>
    </div>
    <div v-if="!readonly" class="am-minimal-track__controls">
      <button
        v-if="!selectionOnly"
        class="am-minimal-track__more"
        data-card-menu
        type="button"
        aria-haspopup="dialog"
        :aria-label="`打开《${title}》的操作`"
        :data-am-focus-key="`track:${focusId ?? track.id}:actions`"
        @click="emit('actions')"
      >
        <AppIcon name="more" :size="20" />
      </button>
    </div>
    <label v-if="!readonly && selectable" class="am-minimal-track__select" :title="selectionLabel"
      ><input
        type="checkbox"
        :checked="selected"
        :disabled="disabled"
        :aria-label="selectionLabel"
        :data-am-focus-key="`track:${focusId ?? track.id}:select`"
        @change="emit('select')"
    /></label>
  </article>
</template>

<style scoped>
.am-minimal-track {
  position: relative;
  display: grid;
  /* Wide lists use artwork above the copy; narrow lists switch to horizontal rows below. */
  grid-template-columns: minmax(0, 1fr) 36px;
  grid-template-rows: auto 1fr;
  align-items: center;
  gap: var(--am-space-3);
  min-inline-size: 0;
  block-size: 100%;
  box-sizing: border-box;
  padding: var(--am-space-3);
  border: 1px solid var(--am-color-border);
  border-radius: var(--am-radius-card);
  background: var(--am-color-surface);
  color: var(--am-color-text);
  transition:
    border-color var(--am-motion-fast),
    background-color var(--am-motion-fast),
    box-shadow var(--am-motion-fast);
}
.am-minimal-track:focus-within {
  border-color: color-mix(in srgb, var(--am-color-primary) 25%, var(--am-color-border));
  box-shadow: var(--am-shadow-control);
}
.am-minimal-track[data-active='true'],
.am-minimal-track[data-selected='true'] {
  border-color: color-mix(in srgb, var(--am-color-primary) 35%, var(--am-color-border));
  background: color-mix(in srgb, var(--am-color-primary) 4%, var(--am-color-surface));
}
.am-minimal-track__progress {
  position: absolute;
  inset: -1px;
  inline-size: calc(100% + 2px);
  block-size: calc(100% + 2px);
  overflow: visible;
  pointer-events: none;
}
.am-minimal-track__progress rect {
  width: calc(100% - 2px);
  height: calc(100% - 2px);
  fill: none;
  stroke: var(--am-color-primary);
  stroke-width: 2;
  stroke-linecap: round;
  vector-effect: non-scaling-stroke;
}
.am-minimal-track__cover {
  position: relative;
  display: grid;
  grid-column: 1 / -1;
  place-items: center;
  inline-size: 100%;
  aspect-ratio: 8 / 5;
  max-block-size: var(--am-track-card-artwork-max-height, 200px);
  padding: 0;
  overflow: hidden;
  border: 0;
  border-radius: var(--am-radius-artwork, 8px);
  background: var(--am-color-primary-container);
  color: var(--am-color-primary);
  cursor: pointer;
  touch-action: pan-y;
  user-select: none;
  -webkit-touch-callout: none;
}
.am-minimal-track__cover img {
  display: block;
  inline-size: 100%;
  block-size: 100%;
  object-fit: cover;
  /* Zoom only the artwork inside its clipped frame, preserving grid and drag geometry. */
  transform: scale(var(--am-minimal-track-artwork-scale, 1));
  transition: transform var(--am-motion-slow) var(--am-ease-emphasized);
}
.am-minimal-track__cover[data-readonly='true'] {
  cursor: default;
}
.am-minimal-track[data-readonly='true'] .am-minimal-track__copy {
  grid-column: 1 / -1;
}
.am-minimal-track__cover:focus-visible:not([aria-disabled='true']) {
  --am-minimal-track-artwork-scale: 1.055;
}
.am-minimal-track__play {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  background: linear-gradient(rgb(0 0 0 / 8%), rgb(0 0 0 / 36%));
  color: white;
  opacity: 0;
  pointer-events: none;
  transition: opacity var(--am-motion-normal);
}
.am-minimal-track__play-icon {
  display: grid;
  place-items: center;
  inline-size: 44px;
  block-size: 44px;
  box-sizing: border-box;
  border: 1px solid rgb(255 255 255 / 45%);
  border-radius: 50%;
  background: rgb(0 0 0 / 28%);
  transform: translateY(5px) scale(0.85);
  transition: transform var(--am-motion-normal) var(--am-ease-emphasized);
}
.am-minimal-track__cover:focus-visible:not([aria-disabled='true']) .am-minimal-track__play {
  opacity: 1;
}
.am-minimal-track__cover:focus-visible .am-minimal-track__play-icon {
  transform: none;
}
.am-minimal-track__cover:disabled,
.am-minimal-track__cover[aria-disabled='true'] {
  opacity: 0.55;
  cursor: not-allowed;
}
.am-minimal-track__copy {
  min-inline-size: 0;
}
.am-minimal-track__copy h3,
.am-minimal-track__copy p {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  margin: 0;
}
.am-minimal-track__copy h3 {
  font-size: var(--am-font-size-sm);
  line-height: 1.5;
  font-weight: 700;
}
.am-minimal-track__copy p {
  margin-block-start: var(--am-space-1);
  color: var(--am-color-text-secondary);
  font-size: var(--am-font-size-xs);
}
.am-minimal-track__metadata {
  display: flex;
  align-items: center;
  gap: var(--am-space-2);
  min-inline-size: 0;
  overflow: hidden;
  margin-block-start: var(--am-space-1);
}
.am-minimal-track__copy .am-minimal-track__detail {
  /* Keep duration/status readable while the single-line tag strip yields the remaining width. */
  flex: 0 0 auto;
  max-inline-size: 100%;
  min-block-size: 1.4em;
  margin: 0;
}
.am-minimal-track__controls {
  display: grid;
  grid-column: 2;
  grid-row: 2;
  align-content: center;
  justify-items: center;
}
.am-minimal-track__more {
  display: grid;
  place-items: center;
  inline-size: 36px;
  block-size: 36px;
  padding: 0;
  border: 0;
  border-radius: var(--am-radius-control);
  background: transparent;
  color: var(--am-color-text-secondary);
  cursor: pointer;
  transition:
    transform var(--am-motion-normal) var(--am-ease-emphasized),
    background-color var(--am-motion-fast),
    color var(--am-motion-fast);
}
.am-minimal-track__more:is(:hover, :focus-visible) {
  background: var(--am-color-surface-hover);
  color: var(--am-color-text);
}
.am-minimal-track__select {
  /* Overlay selection so entering batch mode never adds a row or changes card height. */
  position: absolute;
  inset-block-start: var(--am-space-3);
  inset-inline-end: var(--am-space-3);
  display: flex;
  align-items: flex-start;
  justify-content: flex-end;
  inline-size: 44px;
  block-size: 44px;
  box-sizing: border-box;
  padding: 6px;
  background: transparent;
  cursor: pointer;
}
.am-minimal-track__select input {
  inline-size: 18px;
  block-size: 18px;
  margin: 0;
  accent-color: var(--am-color-primary);
  cursor: pointer;
  outline: 0;
}
button:focus-visible,
.am-minimal-track__select:has(input:focus-visible) {
  outline: var(--am-focus-ring);
  outline-offset: var(--am-focus-offset);
}
@container am-track-list (max-width: 600px) {
  .am-minimal-track[data-readonly='true'] {
    grid-template-columns: 72px minmax(0, 1fr);
  }
  .am-minimal-track[data-readonly='true'] .am-minimal-track__copy {
    grid-column: 2;
  }
  .am-minimal-track {
    grid-template-columns: 72px minmax(0, 1fr) 44px;
    grid-template-rows: auto;
  }
  .am-minimal-track__cover {
    grid-column: 1;
    grid-row: 1;
    aspect-ratio: 1;
  }
  .am-minimal-track__copy {
    grid-column: 2;
    grid-row: 1;
  }
  .am-minimal-track__controls {
    grid-column: 3;
    grid-row: 1;
    /* Keep the row stable while the centered menu slides up to make room for selection. */
    min-block-size: 88px;
    align-self: stretch;
    align-content: center;
  }
  .am-minimal-track__more {
    inline-size: 44px;
    block-size: 44px;
  }
  .am-minimal-track[data-selectable='true'] .am-minimal-track__more {
    transform: translateY(-22px);
  }
  .am-minimal-track__select {
    inset-block-start: auto;
    inset-block-end: var(--am-space-3);
    inset-inline-end: var(--am-space-3);
    align-items: center;
    justify-content: center;
    animation: am-minimal-track-selection-enter var(--am-motion-fast) var(--am-ease-standard)
      var(--am-motion-normal) both;
  }
}
@keyframes am-minimal-track-selection-enter {
  from {
    opacity: 0;
    transform: translateY(6px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
/* Two-column phone cells keep small tiles rather than squeezing text beside the artwork. */
@container am-track-card (max-width: 260px) {
  .am-minimal-track[data-readonly='true'] {
    grid-template-columns: minmax(0, 1fr);
  }
  .am-minimal-track[data-readonly='true'] .am-minimal-track__copy {
    grid-column: 1;
  }
  .am-minimal-track {
    grid-template-columns: minmax(0, 1fr) 44px;
    grid-template-rows: auto 1fr;
    gap: var(--am-space-2);
  }
  .am-minimal-track__cover {
    grid-column: 1 / -1;
    grid-row: 1;
    aspect-ratio: 1;
  }
  .am-minimal-track__copy {
    grid-column: 1;
    grid-row: 2;
  }
  .am-minimal-track__controls {
    grid-column: 2;
    grid-row: 2;
  }
  .am-minimal-track__select {
    inset-inline-start: auto;
    inset-inline-end: var(--am-space-3);
  }
}
@media (hover: hover) and (pointer: fine) {
  .am-minimal-track:where(:hover) {
    border-color: color-mix(in srgb, var(--am-color-primary) 25%, var(--am-color-border));
    box-shadow: var(--am-shadow-control);
  }
  .am-minimal-track:not([data-invalid='true']):hover {
    --am-minimal-track-artwork-scale: 1.055;
  }
  .am-minimal-track__cover:hover:not(:disabled):not([aria-disabled='true'])
    .am-minimal-track__play {
    opacity: 1;
  }
  .am-minimal-track__cover:hover .am-minimal-track__play-icon {
    transform: none;
  }
}
@media (hover: none), (pointer: coarse) {
  .am-minimal-track__play {
    opacity: 1;
    background: rgb(0 0 0 / 35%);
  }
  .am-minimal-track__play-icon {
    transform: none;
  }
}
@media (prefers-reduced-motion: reduce) {
  .am-minimal-track__select {
    animation: none;
  }
  .am-minimal-track,
  .am-minimal-track__cover img,
  .am-minimal-track__play,
  .am-minimal-track__play-icon,
  .am-minimal-track__more {
    transition: none;
  }
  .am-minimal-track__cover img,
  .am-minimal-track__play-icon {
    transform: none;
  }
}
</style>
