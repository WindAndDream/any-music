<script setup lang="ts">
import CollectionCard from '@any-music/ui/components/CollectionCard.vue'
import { useCatalogContextTitle } from '@any-music/ui/library'
import type { TrackPlaybackState } from '@any-music/ui/library'
import { computed, useTemplateRef, type CSSProperties } from 'vue'

/** 平台卡片投影歌曲选择并发出长按意图；整组排序仍使用稳定平台身份。 */
const props = defineProps<{
  platformId: string
  name: string
  count: number
  totalCount: number
  filtered: boolean
  isCustom: boolean
  playbackStatus?: TrackPlaybackState['status']
  dragging: boolean
  selected?: boolean
  selectable?: boolean
  indeterminate?: boolean
  reorderStyle?: CSSProperties
  historyRecords?: boolean
  /** The virtual stable cell owns placement, identity and the sole pointer motion surface. */
  virtualPlacement?: boolean
}>()
const countElement = useTemplateRef<HTMLElement>('countElement')
const fullSummaryElement = useTemplateRef<HTMLElement>('fullSummaryElement')
const compactSummaryElement = useTemplateRef<HTMLElement>('compactSummaryElement')
const countSummary = computed(() =>
  props.filtered
    ? `匹配 ${props.count} / ${props.totalCount} ${props.historyRecords ? '条' : '首'}`
    : `${props.totalCount} ${props.historyRecords ? '条播放记录' : '首歌曲'}`,
)
const fullSummary = computed(
  () => `${props.isCustom ? '本地拼接' : '音乐源'} · ${countSummary.value}`,
)
// 使用不参与布局的自然宽度测量，隐藏前缀后不会因文字变短而反复切换。
const { displayText } = useCatalogContextTitle({
  title: fullSummary,
  compactTitle: countSummary,
  availableElement: countElement,
  titleElement: fullSummaryElement,
  compactTitleElement: compactSummaryElement,
})
const emit = defineEmits<{
  open: []
  select: []
  dragStart: [event: PointerEvent, id: string]
  shift: [id: string, direction: -1 | 1]
  dragCancel: []
}>()
</script>

<template>
  <section
    class="queue-platform-group"
    :class="{
      'queue-platform-group--dragging': dragging,
      'queue-platform-group--selected': props.selectable && (selected || indeterminate),
      'queue-platform-group--selectable': props.selectable,
    }"
    :tabindex="historyRecords ? -1 : 0"
    data-queue-handle
    :data-am-continuity-item="platformId"
    :data-am-focus-key="`platform:${platformId}:reorder`"
    :data-queue-drop-kind="virtualPlacement ? undefined : 'platform'"
    :data-queue-drop-id="virtualPlacement ? undefined : platformId"
    :aria-label="`${name}${isCustom ? '（本地拼接）' : ''}${historyRecords ? '播放记录' : '待听歌曲；长按平台卡片拖动排序；方向键可逐个平台移动'}`"
    @pointerdown.stop="emit('dragStart', $event, platformId)"
    @keydown.up.prevent="emit('shift', platformId, -1)"
    @keydown.left.prevent="emit('shift', platformId, -1)"
    @keydown.down.prevent="emit('shift', platformId, 1)"
    @keydown.right.prevent="emit('shift', platformId, 1)"
    @keydown.esc.stop="emit('dragCancel')"
    @contextmenu.prevent
    @dragstart.prevent
  >
    <CollectionCard
      class="queue-platform-group__surface"
      :data-am-grid-motion="virtualPlacement ? undefined : ''"
      :style="virtualPlacement ? undefined : reorderStyle"
      :entry-id="platformId"
      :focus-key="`platform:${platformId}:open`"
      :name="name"
      :description="countSummary"
      :icon="isCustom ? 'segments' : 'music'"
      :accented="isCustom"
      @open="emit('open')"
    >
      <template #description>
        <span class="queue-platform-group__summary">
          <span ref="countElement" class="queue-platform-group__count" :title="fullSummary">
            <span v-if="displayText === fullSummary" class="queue-platform-group__inline-type"
              >{{ isCustom ? '本地拼接' : '音乐源' }} · </span
            >{{ countSummary }}
            <span
              ref="fullSummaryElement"
              class="queue-platform-group__measure"
              aria-hidden="true"
              >{{ fullSummary }}</span
            >
            <span
              ref="compactSummaryElement"
              class="queue-platform-group__measure"
              aria-hidden="true"
              >{{ countSummary }}</span
            >
          </span>
          <span
            v-if="playbackStatus"
            class="queue-platform-group__status queue-platform-group__inline-status"
            :class="{ 'queue-platform-group__status--paused': playbackStatus === 'paused' }"
            aria-live="polite"
            >{{ playbackStatus === 'paused' ? '已暂停' : '正在播放' }}</span
          >
        </span>
      </template>
      <template #meta>
        <span>{{ isCustom ? '本地拼接' : '音乐源' }}</span>
        <span
          v-if="playbackStatus"
          class="queue-platform-group__status"
          :class="{ 'queue-platform-group__status--paused': playbackStatus === 'paused' }"
          aria-live="polite"
          >{{ playbackStatus === 'paused' ? '已暂停' : '正在播放' }}</span
        >
      </template>
      <template #actions>
        <label
          v-if="props.selectable"
          class="queue-platform-group__select"
          :title="
            historyRecords
              ? '勾选当前匹配播放记录'
              : '勾选当前匹配歌曲 · 长按平台卡片拖动排序 · 方向键微调 · Escape 取消'
          "
        >
          <input
            type="checkbox"
            :data-am-focus-key="`platform:${platformId}:select`"
            :checked="selected"
            :indeterminate="indeterminate"
            :aria-checked="indeterminate ? 'mixed' : Boolean(selected)"
            :aria-label="`${selected ? '取消选择' : '选择'}${name}${isCustom ? '（本地拼接）' : ''}的 ${count} ${historyRecords ? '条匹配播放记录' : '首匹配歌曲；长按平台卡片拖动排序；方向键可逐个平台移动'}`"
            @change="emit('select')"
          />
        </label>
      </template>
    </CollectionCard>
  </section>
</template>

<style scoped>
.queue-platform-group {
  position: relative;
  min-inline-size: 0;
  -webkit-touch-callout: none;
}
.queue-platform-group__surface {
  transition: transform var(--am-motion-normal) var(--am-ease-emphasized);
}
.queue-platform-group__surface :deep(.collection-card__actions) {
  /* The empty slot keeps the same footer height and metadata width as selection mode. */
  inline-size: 44px;
  min-block-size: 44px;
}
.queue-platform-group--selected .queue-platform-group__surface {
  border-color: var(--am-color-primary);
  box-shadow: inset 0 0 0 1px var(--am-color-primary);
}
.queue-platform-group--dragging {
  z-index: 3;
  cursor: move;
}
.queue-platform-group--dragging .queue-platform-group__surface {
  box-shadow: var(--am-shadow-card);
  outline: 1px solid var(--am-color-primary);
  opacity: 0.96;
  transition: none;
  pointer-events: none;
  user-select: none;
}
.queue-platform-group__select {
  display: grid;
  inline-size: 44px;
  block-size: 44px;
  place-items: center;
  border: 0;
  border-radius: var(--am-radius-control);
  background: transparent;
  color: var(--am-color-text-secondary);
  cursor: pointer;
  touch-action: manipulation;
}
.queue-platform-group__select:has(input:focus-visible),
.queue-platform-group__select:hover {
  background: var(--am-color-surface-hover);
  color: var(--am-color-primary);
}
.queue-platform-group__select input {
  inline-size: 18px;
  block-size: 18px;
  margin: 0;
  accent-color: var(--am-color-primary);
  cursor: pointer;
}
.queue-platform-group:focus-visible,
.queue-platform-group__select input:focus-visible {
  outline: var(--am-focus-ring);
  outline-offset: -3px;
}
.queue-platform-group__status {
  padding: var(--am-space-1) var(--am-space-2);
  border-radius: var(--am-radius-detail);
  background: var(--am-color-primary-container);
  color: var(--am-color-primary);
  white-space: nowrap;
}
.queue-platform-group__status--paused {
  background: var(--am-color-surface-subtle);
  color: var(--am-color-text-secondary);
}
.queue-platform-group__inline-type,
.queue-platform-group__inline-status {
  display: none;
}
.queue-platform-group__count {
  position: relative;
  display: block;
  min-inline-size: 0;
  overflow: hidden;
  white-space: nowrap;
}
.queue-platform-group__measure {
  position: absolute;
  inset-block-start: 0;
  inset-inline-start: 0;
  inline-size: max-content;
  visibility: hidden;
  pointer-events: none;
}
@container am-listen-queue (max-width: 600px) {
  /* 类型与数量共用摘要行，勾选保留独立触控区；按钮内边距容纳箭头位移。 */
  .queue-platform-group__surface {
    display: grid;
    grid-template-areas: 'entry actions';
    grid-template-columns: minmax(0, 1fr) 44px;
    align-items: center;
    gap: var(--am-space-1);
    padding: var(--am-space-2);
  }
  .queue-platform-group__surface :deep(.collection-card__open) {
    grid-area: entry;
    grid-template-columns: 40px minmax(0, 1fr) 18px;
    min-block-size: 56px;
    gap: var(--am-space-2);
    padding: var(--am-space-2) var(--am-space-3);
    border-radius: var(--am-radius-control);
  }
  .queue-platform-group__surface :deep(.collection-card__icon) {
    inline-size: 40px;
    block-size: 40px;
  }
  .queue-platform-group__surface :deep(.collection-card__footer) {
    display: contents;
  }
  .queue-platform-group__surface :deep(.collection-card__meta) {
    display: none;
  }
  .queue-platform-group__surface :deep(.collection-card__actions) {
    grid-area: actions;
  }
  .queue-platform-group__status {
    padding-block: 0;
  }
  .queue-platform-group__summary {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--am-space-1) var(--am-space-2);
  }
  .queue-platform-group__count {
    flex: 1;
  }
  .queue-platform-group__inline-status {
    flex: 0 0 auto;
  }
  .queue-platform-group__inline-type,
  .queue-platform-group__inline-status {
    display: inline;
  }
}
@media (prefers-reduced-motion: reduce) {
  .queue-platform-group__surface {
    transition: none;
  }
}
</style>
