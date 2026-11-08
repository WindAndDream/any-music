<script setup lang="ts">
import type { SegmentRecipe } from '@any-music/core'
import { useEditingSession } from '@any-music/ui'
import AppIcon from '@any-music/ui/components/AppIcon.vue'
import { computed, shallowRef, watch } from 'vue'

import { selectedSegmentKey } from '../timeline-state'

const props = defineProps<{
  segments: readonly SegmentRecipe[]
  trackTitles: ReadonlyMap<string, string>
  exportBusy: boolean
}>()

const emit = defineEmits<{
  move: [index: number, offset: -1 | 1]
  remove: [index: number]
  preview: [segment: SegmentRecipe]
  download: [segment: SegmentRecipe]
}>()

const viewMode = shallowRef<'arrangement' | 'editor'>('arrangement')
const zoom = shallowRef(1)
const selectedIndex = useEditingSession('timeline').state(selectedSegmentKey, () => shallowRef(0))
const selectedSegment = computed(() => props.segments[selectedIndex.value])
const totalDurationMs = computed(() =>
  props.segments.reduce((total, segment) => total + getSegmentDurationMs(segment), 0),
)

watch(
  () => props.segments.length,
  (length) => {
    if (length === 0) selectedIndex.value = 0
    else if (selectedIndex.value >= length) selectedIndex.value = length - 1
  },
)

function getSegmentDurationMs(segment: SegmentRecipe): number {
  return Math.max(0, segment.endMs - segment.startMs)
}

function getSegmentStyle(segment: SegmentRecipe): { inlineSize: string } {
  const total = Math.max(1, totalDurationMs.value)
  const share = getSegmentDurationMs(segment) / total
  return { inlineSize: `${Math.max(88, share * 720 * zoom.value)}px` }
}

function formatTime(milliseconds: number): string {
  const totalSeconds = milliseconds / 1000
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = (totalSeconds % 60).toFixed(2).padStart(5, '0')
  return `${minutes}:${seconds}`
}

function openSegmentEditor(index: number): void {
  selectedIndex.value = index
  viewMode.value = 'editor'
}

function moveSelectedSegment(offset: -1 | 1): void {
  emit('move', selectedIndex.value, offset)
  selectedIndex.value += offset
}
</script>

<template>
  <section class="segment-timeline" aria-label="自定义歌曲时间线">
    <header class="segment-timeline__header">
      <div>
        <strong>创作时间线</strong>
        <span>{{ props.segments.length }} 个片段 · {{ formatTime(totalDurationMs) }}</span>
      </div>
      <div class="segment-timeline__view-switch" role="group" aria-label="时间线显示模式">
        <button
          type="button"
          :aria-pressed="viewMode === 'arrangement'"
          @click="viewMode = 'arrangement'"
        >
          <AppIcon name="list" />
          排列
        </button>
        <button type="button" :aria-pressed="viewMode === 'editor'" @click="viewMode = 'editor'">
          <AppIcon name="waveform" />
          剪辑轨道
        </button>
      </div>
    </header>

    <p v-if="props.segments.length === 0" class="segment-timeline__empty">
      从素材列表设置范围并加入时间线。自定义音乐也可以作为一个直接素材。
    </p>

    <template v-else-if="viewMode === 'arrangement'">
      <TransitionGroup tag="ol" name="am-segment" class="segment-timeline__items">
        <li
          v-for="(segment, index) in props.segments"
          :key="`${segment.sourceTrackId}:${segment.startMs}:${segment.endMs}:${index}`"
        >
          <span class="segment-timeline__index">{{ index + 1 }}</span>
          <button class="segment-timeline__summary" type="button" @click="openSegmentEditor(index)">
            <strong>{{
              props.trackTitles.get(segment.sourceTrackId) ?? segment.sourceTrackId
            }}</strong>
            <small>{{ formatTime(segment.startMs) }} → {{ formatTime(segment.endMs) }}</small>
          </button>
          <div class="segment-timeline__actions">
            <button
              type="button"
              :disabled="index === 0"
              :aria-label="`前移第 ${index + 1} 个片段`"
              @click="emit('move', index, -1)"
            >
              <AppIcon name="arrow-up" />
            </button>
            <button
              type="button"
              :disabled="index === props.segments.length - 1"
              :aria-label="`后移第 ${index + 1} 个片段`"
              @click="emit('move', index, 1)"
            >
              <AppIcon name="arrow-down" />
            </button>
            <button type="button" @click="emit('preview', segment)">试听</button>
            <button type="button" :disabled="props.exportBusy" @click="emit('download', segment)">
              下载
            </button>
            <button class="segment-timeline__remove" type="button" @click="emit('remove', index)">
              删除
            </button>
          </div>
        </li>
      </TransitionGroup>
    </template>

    <div v-else class="segment-editor">
      <div class="segment-editor__toolbar">
        <span>剪辑轨道</span>
        <label>
          缩放
          <input
            v-model.number="zoom"
            type="range"
            name="segment-timeline-zoom"
            min="0.5"
            max="2"
            step="0.1"
          />
          <output>{{ Math.round(zoom * 100) }}%</output>
        </label>
      </div>
      <div class="segment-editor__viewport">
        <TransitionGroup tag="ol" name="am-segment" class="segment-editor__track">
          <li
            v-for="(segment, index) in props.segments"
            :key="`${segment.sourceTrackId}:${segment.startMs}:${segment.endMs}:${index}`"
            :style="getSegmentStyle(segment)"
          >
            <button
              type="button"
              :aria-pressed="selectedIndex === index"
              @click="selectedIndex = index"
            >
              <span>{{ index + 1 }}</span>
              <strong>{{
                props.trackTitles.get(segment.sourceTrackId) ?? segment.sourceTrackId
              }}</strong>
              <small>{{ formatTime(getSegmentDurationMs(segment)) }}</small>
            </button>
          </li>
        </TransitionGroup>
      </div>

      <article v-if="selectedSegment" class="segment-editor__inspector">
        <div>
          <span>片段 {{ selectedIndex + 1 }}</span>
          <strong>
            {{
              props.trackTitles.get(selectedSegment.sourceTrackId) ?? selectedSegment.sourceTrackId
            }}
          </strong>
          <small>
            {{ formatTime(selectedSegment.startMs) }} → {{ formatTime(selectedSegment.endMs) }} ·
            {{ formatTime(getSegmentDurationMs(selectedSegment)) }}
          </small>
        </div>
        <div class="segment-editor__actions">
          <button type="button" :disabled="selectedIndex === 0" @click="moveSelectedSegment(-1)">
            向前
          </button>
          <button
            type="button"
            :disabled="selectedIndex === props.segments.length - 1"
            @click="moveSelectedSegment(1)"
          >
            向后
          </button>
          <button type="button" @click="emit('preview', selectedSegment)">试听</button>
          <button
            type="button"
            :disabled="props.exportBusy"
            @click="emit('download', selectedSegment)"
          >
            下载
          </button>
          <button
            class="segment-timeline__remove"
            type="button"
            @click="emit('remove', selectedIndex)"
          >
            删除
          </button>
        </div>
      </article>
    </div>
  </section>
</template>

<style scoped>
.segment-timeline {
  container: am-segment-timeline / inline-size;
  display: grid;
  gap: var(--am-space-3);
}

.segment-timeline__header,
.segment-timeline__header > div,
.segment-timeline__view-switch,
.segment-editor__toolbar,
.segment-editor__toolbar label,
.segment-editor__inspector,
.segment-editor__actions {
  display: flex;
  align-items: center;
}

.segment-timeline__header,
.segment-editor__toolbar,
.segment-editor__inspector {
  justify-content: space-between;
  gap: var(--am-space-4);
}

.segment-timeline__header > div:first-child,
.segment-editor__inspector > div:first-child {
  display: grid;
}

.segment-timeline__header span,
.segment-editor__inspector span,
.segment-editor__inspector small {
  color: var(--am-color-text-secondary);
  font-size: var(--am-font-size-xs);
}

.segment-timeline__view-switch {
  gap: var(--am-space-1);
  padding: var(--am-space-1);
  border-radius: var(--am-radius-md);
  background: var(--am-color-surface-subtle);
}

.segment-timeline__view-switch button,
.segment-timeline__actions button,
.segment-editor__actions button {
  display: inline-flex;
  min-block-size: 34px;
  align-items: center;
  justify-content: center;
  gap: var(--am-space-1);
  padding-inline: var(--am-space-3);
  border: 0;
  border-radius: var(--am-radius-sm);
  background: transparent;
  color: var(--am-color-text-secondary);
  cursor: pointer;
}

.segment-timeline__view-switch button[aria-pressed='true'] {
  background: var(--am-color-surface);
  box-shadow: var(--am-shadow-control);
  color: var(--am-color-primary);
}

.segment-timeline__items,
.segment-editor__track {
  margin: 0;
  padding: 0;
  list-style: none;
}

.segment-timeline__items {
  display: grid;
  gap: var(--am-space-2);
}

.segment-timeline__items > li {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: var(--am-space-3);
  padding: var(--am-space-3);
  border: 1px solid var(--am-color-border);
  border-radius: var(--am-radius-md);
  background: var(--am-color-surface);
}

.segment-timeline__index {
  display: grid;
  inline-size: 30px;
  block-size: 30px;
  place-items: center;
  border-radius: 50%;
  background: var(--am-color-primary-soft);
  color: var(--am-color-primary);
  font-weight: 750;
}

.segment-timeline__summary {
  display: grid;
  min-inline-size: 0;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--am-color-text);
  cursor: pointer;
  text-align: start;
}

.segment-timeline__summary strong,
.segment-timeline__summary small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.segment-timeline__summary small {
  color: var(--am-color-text-secondary);
}

.segment-timeline__actions,
.segment-editor__actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--am-space-1);
}

.segment-timeline__actions button:hover,
.segment-editor__actions button:hover {
  background: var(--am-color-hover);
  color: var(--am-color-primary);
}

.segment-timeline__actions .segment-timeline__remove,
.segment-editor__actions .segment-timeline__remove {
  color: var(--am-color-danger);
}

.segment-editor {
  display: grid;
  gap: var(--am-space-3);
  padding: var(--am-space-3);
  border: 1px solid var(--am-color-border);
  border-radius: var(--am-radius-lg);
  background: var(--am-color-surface-subtle);
}

.segment-editor__toolbar label {
  gap: var(--am-space-2);
  color: var(--am-color-text-secondary);
  font-size: var(--am-font-size-xs);
}

.segment-editor__toolbar input {
  inline-size: 128px;
  accent-color: var(--am-color-primary);
}

.segment-editor__viewport {
  overflow: auto hidden;
  padding: var(--am-space-4);
  border-radius: var(--am-radius-md);
  background:
    linear-gradient(var(--am-color-border) 1px, transparent 1px) 0 0 / 100% 24px,
    var(--am-color-background);
  overscroll-behavior-inline: contain;
}

.segment-editor__track {
  display: flex;
  min-inline-size: max-content;
  align-items: stretch;
  gap: 3px;
}

.segment-editor__track li {
  min-inline-size: 88px;
}

.segment-editor__track button {
  display: grid;
  inline-size: 100%;
  block-size: 82px;
  grid-template-columns: auto minmax(0, 1fr);
  align-content: center;
  gap: 2px var(--am-space-2);
  padding: var(--am-space-3);
  overflow: hidden;
  border: 1px solid var(--am-color-border-strong);
  border-radius: var(--am-radius-sm);
  background: var(--am-color-primary-soft);
  color: var(--am-color-primary);
  cursor: pointer;
  text-align: start;
}

@supports (border-color: color-mix(in srgb, white 50%, transparent)) {
  .segment-editor__track button {
    border-color: color-mix(in srgb, var(--am-color-primary) 24%, transparent);
  }
}

.segment-editor__track button[aria-pressed='true'] {
  border-color: var(--am-color-primary);
  box-shadow: 0 0 0 3px var(--am-color-focus-ring);
}

.segment-editor__track strong,
.segment-editor__track small {
  grid-column: 2;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.segment-editor__track span {
  grid-row: 1 / 3;
  font-weight: 800;
}

.segment-editor__track small {
  opacity: 0.72;
}

.segment-editor__inspector {
  padding: var(--am-space-3) var(--am-space-4);
  border-radius: var(--am-radius-md);
  background: var(--am-color-surface);
}

.am-segment-move {
  transition: transform var(--am-motion-normal) var(--am-ease-emphasized);
}

@container am-segment-timeline (max-width: 640px) {
  .segment-timeline__header,
  .segment-editor__toolbar,
  .segment-editor__inspector {
    align-items: stretch;
    flex-direction: column;
  }

  .segment-timeline__view-switch button {
    flex: 1;
  }

  .segment-timeline__items > li {
    grid-template-columns: auto minmax(0, 1fr);
  }

  .segment-timeline__actions {
    grid-column: 1 / -1;
  }
}
</style>
