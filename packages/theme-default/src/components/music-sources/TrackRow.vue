<script setup lang="ts">
import { resolveCardStyle, useCardPresentation } from '@any-music/card-styles/vue'
import type { Track } from '@any-music/core'
import { useTrackName } from '@any-music/ui/catalog'
import type { CatalogTrackDisplayMode } from '@any-music/ui/catalog'
import AppIcon from '@any-music/ui/components/AppIcon.vue'
import TrackCardSummary from '@any-music/ui/components/tracks/TrackCardSummary.vue'
import type { CollectionItemStyle } from '@any-music/ui/library'
import { computed, useId } from 'vue'

// 曲目行只读取统一 Track，不能根据 pluginId 分支解析平台字段。
const props = withDefaults(
  defineProps<{
    track: Track
    active: boolean
    invalid: boolean
    favorite: boolean
    selected: boolean
    selectable?: boolean
    displayMode: CatalogTrackDisplayMode
    contextLabel?: string
    trailingMeta?: string
    minimalDetail?: string
    customTags?: readonly string[]
    reorderable?: boolean
    downloadBusy?: boolean
    hideActionsMenu?: boolean
    readonly?: boolean
    selectionOnly?: boolean
    disabled?: boolean
    itemStyle?: CollectionItemStyle
    focusId?: string
    selectionDescription?: string
  }>(),
  { contextLabel: '', downloadBusy: false },
)

// 待听可替换封面选择热区以接入长按排序，搜索列表保留原生 label/input 语义。
defineSlots<{
  'cover-select'?: () => unknown
  'cover-overlay'?: () => unknown
  corner?: () => unknown
  actions?: () => unknown
}>()

const emit = defineEmits<{
  coverPress: [event: PointerEvent]
  shift: [direction: -1 | 1]
  cancelDrag: []
  play: [track: Track]
  download: [track: Track]
  favorite: [track: Track]
  select: [trackId: string]
  showActions: [track: Track]
}>()

const publishedLabel = computed(() =>
  props.track.publishedAtMs
    ? new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium' }).format(props.track.publishedAtMs)
    : '时间未知',
)
const compactCountFormatter = new Intl.NumberFormat('zh-CN', {
  notation: 'compact',
  maximumFractionDigits: 1,
})
// 窄封面的角标优先保留两项统计，完整计数仍提供给辅助技术和悬停提示。
function formatCompactCount(count?: number): string {
  return count === undefined ? '—' : compactCountFormatter.format(count)
}

const statisticsLabel = computed(
  () =>
    `播放 ${formatCompactCount(props.track.statistics?.playCount)} · 弹幕 ${formatCompactCount(props.track.statistics?.danmakuCount)}`,
)
const statisticsAccessibleLabel = computed(
  () =>
    `播放 ${props.track.statistics?.playCount?.toLocaleString() ?? '—'} · 弹幕 ${props.track.statistics?.danmakuCount?.toLocaleString() ?? '—'}`,
)
const selectionInputId = useId()
const { displayName } = useTrackName(() => props.track)
const {
  itemStyle,
  active: current,
  playing,
  progress,
  resume,
  pause,
} = useCardPresentation(() => props.track.id)
const cardRenderer = computed(() => resolveCardStyle('track', props.itemStyle ?? itemStyle.value))

function handleSelectionClick(event: MouseEvent): void {
  if (props.readonly || props.disabled || !props.selectable) return
  if ((event.target as Element | null)?.closest?.('[data-card-menu], label')) return
  event.preventDefault()
  event.stopPropagation()
  emit('select', props.track.id)
}
</script>

<template>
  <component
    :is="cardRenderer"
    v-if="cardRenderer"
    :track="track"
    :readonly="props.readonly"
    :selection-only="selectionOnly"
    :disabled="disabled"
    :title="displayName ?? track.title"
    :active="active"
    :playing="playing"
    :progress="progress"
    :invalid="invalid"
    :selected="selected"
    :selectable="!props.readonly && selectable"
    :detail="minimalDetail"
    :custom-tags="customTags"
    :focus-id="focusId"
    :selection-description="selectionDescription"
    :reorderable="!props.readonly && reorderable"
    @cover-press="emit('coverPress', $event)"
    @shift="emit('shift', $event)"
    @cancel-drag="emit('cancelDrag')"
    @play="current ? resume() : emit('play', track)"
    @pause="pause"
    @actions="emit('showActions', track)"
    @select="emit('select', track.id)"
  />
  <article
    v-else
    class="track-card track"
    :class="{
      'track--active': active,
      'track--invalid': invalid,
      'track--selected': props.selectable && selected,
      'track--selectable': !props.readonly && props.selectable,
      'track--readonly': props.readonly,
      'track--compact': props.displayMode === 'compact',
    }"
    @click.capture="handleSelectionClick"
  >
    <slot name="corner" />
    <label
      v-if="!props.readonly && props.selectable"
      class="track__select"
      :title="`${selected ? '取消选择' : '选择'}${selectionDescription ?? `歌曲 ${displayName}`}`"
    >
      <input
        :id="selectionInputId"
        class="track__checkbox"
        :data-am-focus-key="`track:${focusId ?? track.id}:select`"
        type="checkbox"
        :checked="selected"
        :disabled="disabled"
        :aria-label="`${selected ? '取消选择' : '选择'}${selectionDescription ?? `歌曲 ${displayName}`}`"
        @change="emit('select', track.id)"
      />
    </label>
    <TrackCardSummary
      :track="props.track"
      :context-label="props.contextLabel"
      :trailing-meta="props.trailingMeta ?? `发布于 ${publishedLabel}`"
      :badge-label="props.invalid ? '已失效' : ''"
      badge-tone="danger"
    >
      <template #cover-overlay>
        <!-- The artwork label shares the card's native selection input. -->
        <slot name="cover-select">
          <label
            v-if="!props.readonly && props.selectable"
            class="track__cover-select"
            :for="selectionInputId"
            :aria-label="`${selected ? '取消选择' : '选择'}${selectionDescription ?? `歌曲 ${displayName}`}`"
          ></label>
        </slot>
        <span class="track__statistics" :title="statisticsAccessibleLabel">
          <span aria-hidden="true">{{ statisticsLabel }}</span>
          <span class="am-sr-only">{{ statisticsAccessibleLabel }}</span>
        </span>
        <slot name="cover-overlay" />
      </template>
      <template #meta="{ primaryMeta }">
        <div class="track__meta-row">
          <p class="track-card-summary__meta" :title="primaryMeta">{{ primaryMeta }}</p>
          <button
            v-if="!props.readonly && !props.selectionOnly && !props.hideActionsMenu"
            class="track__inline-actions"
            data-card-menu
            :data-am-focus-key="`track:${focusId ?? track.id}:actions-inline`"
            :data-am-focus-restore-key="`track:${focusId ?? track.id}:actions`"
            type="button"
            aria-haspopup="dialog"
            :aria-label="`打开《${displayName}》的操作`"
            @click="emit('showActions', track)"
          >
            <AppIcon name="more" :size="16" />
            <span>操作</span>
          </button>
        </div>
      </template>
    </TrackCardSummary>
    <div v-if="!props.readonly && !props.selectionOnly" class="track__actions">
      <slot name="actions">
        <button
          class="track__button track__button--primary"
          type="button"
          :disabled="!selectable && invalid"
          @click="emit('play', track)"
          :data-am-focus-key="`track:${focusId ?? track.id}:play`"
        >
          <AppIcon name="play" :size="15" />
          <span>播放</span>
        </button>
        <button
          class="track__button"
          type="button"
          :aria-pressed="favorite"
          :disabled="!selectable && invalid && !favorite"
          :aria-label="`${favorite ? '取消喜欢' : '喜欢'}《${displayName}》`"
          @click="emit('favorite', track)"
          :data-am-focus-key="`track:${focusId ?? track.id}:favorite`"
        >
          <AppIcon name="heart" :size="15" />
          <span>{{ favorite ? '已喜欢' : '喜欢' }}</span>
        </button>
        <button
          class="track__button"
          type="button"
          :disabled="!selectable && (invalid || props.downloadBusy)"
          @click="emit('download', track)"
          :data-am-focus-key="`track:${focusId ?? track.id}:download`"
        >
          <AppIcon name="download" :size="15" />
          <span>下载</span>
        </button>
        <button
          class="track__button track__button--more"
          data-card-menu
          type="button"
          aria-haspopup="dialog"
          :aria-label="`打开《${displayName}》的操作`"
          @click="emit('showActions', track)"
          :data-am-focus-key="`track:${focusId ?? track.id}:actions`"
        >
          <AppIcon name="more" :size="15" />
          <span>操作</span>
        </button>
      </slot>
    </div>
  </article>
</template>
