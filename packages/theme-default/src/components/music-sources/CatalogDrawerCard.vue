<script setup lang="ts">
import type { CatalogDrawerView } from '@any-music/ui/catalog'
import {
  formatCatalogDrawerCreatedAt,
  getCatalogDrawerKindLabel,
  getCatalogDrawerNoticeLabel,
  getCatalogDrawerStatusLabel,
  getCatalogDrawerTrackSummary,
  hasCatalogDrawerError,
  isCatalogDrawerDisconnected,
} from '@any-music/ui/catalog'
import AppIcon from '@any-music/ui/components/AppIcon.vue'
import { computed } from 'vue'
import type { CSSProperties } from 'vue'

// 卡片负责请求摘要和选择热区；二级操作交由统一弹窗，业务动作仍由上层执行。
const props = withDefaults(
  defineProps<{
    drawer: CatalogDrawerView
    selected: boolean
    selectable?: boolean
    dragging?: boolean
    reorderStyle?: CSSProperties
  }>(),
  { dragging: false },
)

const emit = defineEmits<{
  view: [drawerId: string]
  showError: [drawerId: string]
  showActions: [drawerId: string]
  select: [drawerId: string]
  pressStart: [event: PointerEvent, drawerId: string]
  shift: [drawerId: string, direction: -1 | 1]
  dragCancel: []
}>()

const kindLabel = computed(() => getCatalogDrawerKindLabel(props.drawer))
const statusLabel = computed(() => getCatalogDrawerStatusLabel(props.drawer))
const trackSummary = computed(() => getCatalogDrawerTrackSummary(props.drawer))
const noticeLabel = computed(() => getCatalogDrawerNoticeLabel(props.drawer))
const hasError = computed(() => hasCatalogDrawerError(props.drawer))
const isDisconnected = computed(() => isCatalogDrawerDisconnected(props.drawer))
const isViewDisabled = computed(() => isDisconnected.value && props.drawer.tracks.length === 0)
const createdAtLabel = computed(() => formatCatalogDrawerCreatedAt(props.drawer.createdAtMs))
const createdAtIso = computed(() =>
  props.drawer.createdAtMs !== undefined && createdAtLabel.value !== '时间未知'
    ? new Date(props.drawer.createdAtMs).toISOString()
    : undefined,
)

/** Copyable text and controls stay independent; whitespace selects only in operator mode. */
function handleCardClick(event: MouseEvent): void {
  const target = event.target
  if (!(target instanceof Element)) return
  if (target.closest('button, a, input, label, form, [data-catalog-text]')) return
  handleCardActivate()
}

function handleSelectionClick(event: MouseEvent): void {
  if (!props.selectable) return
  if ((event.target as Element | null)?.closest?.('[data-card-menu], label')) return
  event.preventDefault()
  event.stopPropagation()
  emit('select', props.drawer.id)
}

function handleCardActivate(): void {
  if (props.selectable) emit('select', props.drawer.id)
}

/** 长按只接管卡片空白，文字复制、元数据滚动和原生控件保留各自输入。 */
function isDragTarget(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    !target.closest('button, a, input, label, form, [data-catalog-text], [contenteditable]')
  )
}

function handlePressStart(event: PointerEvent): void {
  if (isDragTarget(event.target)) emit('pressStart', event, props.drawer.id)
}

function handlePrimaryAction(): void {
  if (isViewDisabled.value) return
  if (hasError.value) emit('showError', props.drawer.id)
  else emit('view', props.drawer.id)
}
</script>

<template>
  <article
    class="catalog-card"
    data-am-grid-motion
    data-catalog-handle
    :data-catalog-drawer-id="props.drawer.id"
    :class="{
      'catalog-card--selected': props.selectable && props.selected,
      'catalog-card--selectable': props.selectable,
      'catalog-card--disconnected': isDisconnected,
      'catalog-card--dragging': props.dragging,
      'catalog-card--shifted': props.reorderStyle && !props.dragging,
    }"
    :style="props.reorderStyle"
    :data-status="props.drawer.status"
    tabindex="0"
    :aria-label="`音乐列表 ${props.drawer.title}；${props.selectable ? '点击空白选择，' : ''}长按空白拖动排序；方向键可逐项移动`"
    :title="`${props.selectable ? '点击空白选择 · ' : ''}长按空白拖动排序 · 方向键微调 · Escape 取消`"
    @pointerdown="handlePressStart"
    @click="handleCardClick"
    @click.capture="handleSelectionClick"
    @keydown.enter.self.prevent="handleCardActivate"
    @keydown.space.self.prevent="handleCardActivate"
    @keydown.up.self.prevent="emit('shift', props.drawer.id, -1)"
    @keydown.left.self.prevent="emit('shift', props.drawer.id, -1)"
    @keydown.down.self.prevent="emit('shift', props.drawer.id, 1)"
    @keydown.right.self.prevent="emit('shift', props.drawer.id, 1)"
    @keydown.esc.self.stop="emit('dragCancel')"
    @contextmenu="isDragTarget($event.target) && $event.preventDefault()"
  >
    <header class="catalog-card__header">
      <div class="catalog-card__summary">
        <span class="catalog-card__kind" data-catalog-text>
          <AppIcon :name="props.drawer.kind === 'search' ? 'search' : 'link'" :size="16" />
          {{ kindLabel }}
        </span>
        <span class="catalog-card__status" data-catalog-text>{{ trackSummary }}</span>
      </div>
      <label
        v-if="props.selectable"
        class="catalog-card__select"
        :title="`${props.selected ? '取消选择' : '选择'}列表 ${props.drawer.title}`"
      >
        <input
          type="checkbox"
          :checked="props.selected"
          :aria-label="`${props.selected ? '取消选择' : '选择'}音乐列表 ${props.drawer.title}`"
          @change="emit('select', props.drawer.id)"
        />
      </label>
    </header>

    <div class="catalog-card__body">
      <h3 :title="props.drawer.title">
        <span data-catalog-text>{{ props.drawer.title }}</span>
      </h3>
      <p class="catalog-card__request">
        <span data-catalog-text>{{ props.drawer.pluginName }} · {{ kindLabel }}</span>
        <strong :title="props.drawer.input" data-catalog-text>{{ props.drawer.input }}</strong>
      </p>
      <p class="catalog-card__created-at">
        <AppIcon name="clock" :size="14" />
        <span data-catalog-text>{{
          props.drawer.kind === 'search' ? '搜索时间' : '导入时间'
        }}</span>
        <time v-if="createdAtIso" :datetime="createdAtIso" data-catalog-text>{{
          createdAtLabel
        }}</time>
        <span v-else data-catalog-text>{{ createdAtLabel }}</span>
      </p>
      <div class="catalog-card__metadata" role="group" aria-label="列表状态与加载概况" tabindex="0">
        <div v-if="props.drawer.isPinned || noticeLabel" class="catalog-card__notices">
          <span v-if="props.drawer.isPinned" class="catalog-card__pin" data-catalog-text>
            <AppIcon name="arrow-up" :size="16" />置顶
          </span>
          <span
            v-if="noticeLabel"
            class="catalog-card__notice"
            :class="{ 'catalog-card__notice--error': hasError }"
            data-catalog-text
          >
            <AppIcon :name="hasError ? 'warning' : 'info'" :size="14" />
            {{ noticeLabel }}
          </span>
        </div>
        <div class="catalog-card__metrics" aria-label="列表加载概况">
          <span data-catalog-text
            ><strong>{{ props.drawer.tracks.length }}</strong> 首已加载</span
          >
          <span data-catalog-text
            ><strong>{{ props.drawer.loadedPageCount }}</strong> 页内容</span
          >
          <span v-if="props.drawer.hasMore && !isDisconnected" data-catalog-text>还有更多</span>
          <span v-else-if="props.drawer.status === 'ready' && !isDisconnected" data-catalog-text
            >已到末尾</span
          >
        </div>
      </div>
    </div>

    <footer class="catalog-card__actions">
      <button
        class="catalog-card__view"
        :class="{ 'catalog-card__view--error': hasError }"
        type="button"
        :disabled="isViewDisabled && !selectable"
        :title="isViewDisabled ? `${statusLabel}，重新安装或启用音乐源后可加载歌曲` : undefined"
        @click="handlePrimaryAction"
      >
        <AppIcon :name="hasError ? 'warning' : 'preview'" :size="17" />
        {{ hasError ? '处理错误' : '查看歌曲' }}
      </button>
      <button
        class="catalog-card__more"
        data-card-menu
        type="button"
        aria-haspopup="dialog"
        :aria-label="`音乐列表操作 ${props.drawer.title}`"
        @click="emit('showActions', props.drawer.id)"
      >
        <AppIcon name="more" :size="17" /><span>操作</span>
      </button>
    </footer>
  </article>
</template>

<style scoped>
.catalog-card__created-at {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--am-space-1) var(--am-space-2);
  margin: 0;
  color: var(--am-color-text-secondary);
  font-size: var(--am-font-size-xs);
  font-variant-numeric: tabular-nums;
}

.catalog-card {
  position: relative;
  display: grid;
  min-inline-size: 0;
  block-size: 100%;
  grid-template-rows: auto 1fr auto;
  gap: var(--am-space-4);
  padding: var(--am-space-4);
  border: 1px solid var(--am-color-border);
  border-radius: var(--am-radius-card);
  background: var(--am-color-surface);
  box-shadow: var(--am-shadow-control);
  transition:
    border-color var(--am-motion-fast) var(--am-ease-standard),
    box-shadow var(--am-motion-fast) var(--am-ease-standard),
    transform var(--am-motion-fast) var(--am-ease-standard);
}

.catalog-card:hover {
  border-color: var(--am-color-border-strong);
  box-shadow: var(--am-shadow-card);
  transform: translateY(-2px);
}

.catalog-card:focus-visible {
  outline: var(--am-focus-ring);
  outline-offset: -3px;
}
.catalog-card--dragging {
  box-shadow: var(--am-shadow-card);
  outline: 1px solid var(--am-color-primary);
  opacity: 0.96;
  transition: none;
  pointer-events: none;
  content-visibility: visible;
  user-select: none;
}
.catalog-card--shifted {
  will-change: transform;
}

@supports (content-visibility: auto) {
  .catalog-card {
    /* 跳过屏外内容并记住实际高度；边界放在卡片自身，网格单元不裁切悬停位移与阴影。 */
    content-visibility: auto;
    contain-intrinsic-block-size: auto 280px;
  }
}

.catalog-card--selected {
  border-color: var(--am-color-primary);
}

.catalog-card__select:has(input:checked) {
  border-color: var(--am-color-primary);
  color: var(--am-color-primary);
}

.catalog-card[data-status='error']:not(.catalog-card--disconnected),
.catalog-card[data-status='invalid']:not(.catalog-card--disconnected) {
  border-color: color-mix(in srgb, var(--am-color-danger) 42%, var(--am-color-border));
}

.catalog-card__header {
  display: grid;
  min-inline-size: 0;
  /* Reserve the checkbox target in both modes so labels neither rewrap nor raise the row. */
  min-block-size: 44px;
  grid-template-columns: minmax(0, 1fr) 44px;
  align-items: center;
  gap: var(--am-space-2);
}

.catalog-card__summary {
  display: flex;
  min-inline-size: 0;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--am-space-1) var(--am-space-2);
}

.catalog-card__notices {
  display: flex;
  flex: 0 0 auto;
  min-inline-size: 0;
  align-items: center;
  gap: var(--am-space-2);
}

.catalog-card__pin {
  display: inline-flex;
  flex: 0 0 auto;
  min-block-size: 28px;
  align-items: center;
  gap: var(--am-space-1);
  padding-inline: var(--am-space-2);
  border: 1px solid var(--am-color-primary);
  border-radius: var(--am-radius-detail);
  background: var(--am-color-primary);
  color: var(--am-color-on-primary);
  font-size: var(--am-font-size-xs);
  font-weight: 750;
  white-space: nowrap;
}

.catalog-card__kind,
.catalog-card__status {
  display: inline-flex;
  /* 按标签的完整文本宽度换到下一行，不能让 flex 收缩或省略状态。 */
  flex: 0 0 auto;
  max-inline-size: 100%;
  min-block-size: 28px;
  align-items: center;
  gap: var(--am-space-1);
  padding-inline: var(--am-space-2);
  border-radius: var(--am-radius-detail);
  font-size: var(--am-font-size-xs);
  font-weight: 700;
  overflow-wrap: anywhere;
}

.catalog-card__kind {
  background: var(--am-color-primary-container);
  color: var(--am-color-primary);
}

.catalog-card__status {
  background: var(--am-color-surface-subtle);
  color: var(--am-color-text-secondary);
}

.catalog-card__notice {
  display: inline-flex;
  flex: 0 0 auto;
  min-inline-size: 0;
  min-block-size: 28px;
  align-items: center;
  gap: var(--am-space-1);
  padding: var(--am-space-1) var(--am-space-2);
  border-radius: var(--am-radius-detail);
  background: var(--am-color-surface-subtle);
  color: var(--am-color-text-secondary);
  font-size: var(--am-font-size-xs);
}

.catalog-card__notice--error {
  background: var(--am-color-danger-container);
  color: var(--am-color-danger);
}

.catalog-card__select {
  display: inline-flex;
  inline-size: 44px;
  min-block-size: 44px;
  align-items: center;
  justify-content: center;
  margin-inline-start: auto;
  flex: 0 0 auto;
  border: 0;
  background: transparent;
  color: var(--am-color-text);
  cursor: pointer;
}

.catalog-card__select input {
  margin: 0;
  inline-size: 20px;
  block-size: 20px;
  accent-color: var(--am-color-primary);
  cursor: pointer;
  /* 父 label 只在 input 的键盘焦点可见时绘制统一焦点环。 */
  outline: 0;
}

.catalog-card__select:has(input:focus-visible) {
  outline: var(--am-focus-ring);
  outline-offset: var(--am-focus-offset);
}

.catalog-card__body {
  display: grid;
  min-inline-size: 0;
  align-content: start;
  gap: var(--am-space-2);
}

.catalog-card__body h3,
.catalog-card__request {
  margin: 0;
}

.catalog-card__body h3 {
  overflow: hidden;
  color: var(--am-color-text);
  font-size: var(--am-font-size-lg);
  letter-spacing: -0.02em;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.catalog-card__request {
  /* 搜索词与长链接共用两行摘要，输入长度不再改变卡片高度。 */
  display: grid;
  min-inline-size: 0;
  align-items: center;
  gap: var(--am-space-1) var(--am-space-2);
  color: var(--am-color-text-secondary);
  font-size: var(--am-font-size-xs);
}

.catalog-card__request > span {
  /* 只让实际文字占用复制热区，行尾空白继续交给卡片选择。 */
  justify-self: start;
  min-inline-size: 0;
  max-inline-size: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.catalog-card__request strong {
  /* 文本热区按内容收缩，让短请求后的空白继续接收卡片勾选并显示点击指针。 */
  justify-self: start;
  min-inline-size: 0;
  max-inline-size: 100%;
  overflow: hidden;
  color: var(--am-color-text);
  font-weight: 650;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.catalog-card__metadata {
  /* 两个语义分组共用原生横向视口，完整标签不压缩；触摸、触控板和键盘均可滚动。 */
  display: flex;
  min-inline-size: 0;
  align-items: center;
  gap: var(--am-space-2);
  padding-block-start: var(--am-space-3);
  border-block-start: 1px solid var(--am-color-border);
  overflow-x: auto;
  overflow-y: hidden;
  scrollbar-width: none;
  white-space: nowrap;
}

.catalog-card__metadata::-webkit-scrollbar {
  display: none;
}

.catalog-card__metadata:focus-visible {
  outline: var(--am-focus-ring);
  outline-offset: -2px;
}

.catalog-card__metrics {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: var(--am-space-2);
  color: var(--am-color-text-secondary);
  font-size: var(--am-font-size-xs);
}

.catalog-card__metrics span {
  display: inline-flex;
  flex: 0 0 auto;
  min-block-size: 28px;
  align-items: center;
  gap: var(--am-space-1);
  padding: var(--am-space-1) var(--am-space-2);
  border-radius: var(--am-radius-detail);
  background: var(--am-color-surface-subtle);
}

.catalog-card__metrics strong {
  color: var(--am-color-text);
}

.catalog-card__actions {
  display: flex;
  min-inline-size: 0;
  flex-wrap: wrap;
  gap: var(--am-space-2);
  align-items: center;
  /* 加载概况与操作仅用留白分区，避免卡片底部重复分隔线。 */
  padding-block-start: var(--am-space-3);
}

.catalog-card__actions button {
  min-block-size: 36px;
  border: 1px solid var(--am-color-border);
  border-radius: var(--am-radius-control);
  background: var(--am-color-surface);
  color: var(--am-color-text);
  font: inherit;
}

.catalog-card__actions button {
  padding-inline: var(--am-space-3);
  cursor: pointer;
  font-size: var(--am-font-size-xs);
  font-weight: 700;
  touch-action: manipulation;
  transition:
    border-color var(--am-motion-fast) var(--am-ease-standard),
    background-color var(--am-motion-fast) var(--am-ease-standard),
    color var(--am-motion-fast) var(--am-ease-standard);
}

.catalog-card__actions button:hover:not(:disabled) {
  border-color: var(--am-color-border-strong);
  background: var(--am-color-surface-hover);
}

.catalog-card__actions button:disabled {
  cursor: not-allowed;
  opacity: 0.48;
}

.catalog-card__actions .catalog-card__view {
  display: inline-flex;
  flex: 1 1 128px;
  align-items: center;
  justify-content: center;
  gap: var(--am-space-1);
  border-color: var(--am-color-primary);
  background: var(--am-color-primary);
  color: var(--am-color-on-primary);
}

.catalog-card__more {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--am-space-1);
}

.catalog-card__actions .catalog-card__view:hover:not(:disabled) {
  border-color: var(--am-color-primary);
  background: var(--am-color-primary);
  color: var(--am-color-on-primary);
  filter: brightness(1.06);
}

/* 错误处理沿用主操作的尺寸，用危险语义色区别正常的查看歌曲。 */
.catalog-card__actions .catalog-card__view--error,
.catalog-card__actions .catalog-card__view--error:hover:not(:disabled) {
  border-color: var(--am-color-danger);
  background: var(--am-color-danger-container);
  color: var(--am-color-danger);
}

.catalog-card--disconnected {
  border-color: var(--am-color-border);
}

.catalog-card__actions .catalog-card__view:disabled {
  border-color: var(--am-color-border);
  background: var(--am-color-surface-subtle);
  color: var(--am-color-text-secondary);
}

.catalog-card--disconnected.catalog-card--selected {
  border-color: var(--am-color-primary);
}

@media (hover: hover) and (pointer: fine) {
  .catalog-card {
    cursor: grab;
  }

  .catalog-card--selectable {
    cursor: pointer;
  }

  .catalog-card [data-catalog-text] {
    cursor: text;
  }
}

.catalog-card__actions button:focus-visible {
  outline: var(--am-focus-ring);
  outline-offset: var(--am-focus-offset);
}

/* 卡片放进侧栏、弹窗或多列网格后，操作区始终按自身宽度重排。 */
@container am-catalog-card (max-width: 380px) {
  .catalog-card {
    gap: var(--am-space-3);
    padding: var(--am-space-3);
    border-radius: var(--am-radius-card);
    box-shadow: none;
  }

  .catalog-card:hover {
    transform: none;
  }

  .catalog-card__body h3 {
    font-size: var(--am-font-size-md);
  }

  .catalog-card__metadata {
    padding-block-start: var(--am-space-2);
  }

  .catalog-card__actions {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
  }

  .catalog-card__actions button {
    min-inline-size: 0;
    min-block-size: 34px;
    padding-inline: var(--am-space-2);
  }
}

/* 按整个列表的可用宽度压缩信息，多列桌面的窄卡片仍保留请求摘要。 */
@container am-catalog-list (max-width: 600px) {
  .catalog-card__request {
    display: none;
  }
}

@media (max-width: 600px) {
  .catalog-card__created-at {
    display: none;
  }
  .catalog-card__select {
    position: absolute;
    inset-block-end: var(--am-space-3);
    inset-inline-end: var(--am-space-3);
  }
  .catalog-card__actions {
    /* Keep the bottom-right target clear in either operator state. */
    padding-inline-end: 44px;
  }
  .catalog-card {
    gap: var(--am-space-2);
    padding: var(--am-space-3);
    contain-intrinsic-block-size: auto 240px;
  }

  .catalog-card__body {
    gap: var(--am-space-1);
  }

  .catalog-card__request {
    /* 原始请求仍可从操作弹窗完整查看和复制。 */
    display: none;
  }

  .catalog-card__metadata,
  .catalog-card__actions {
    padding-block-start: var(--am-space-2);
  }
}

@media (prefers-reduced-motion: reduce) {
  .catalog-card {
    transition-duration: 1ms;
  }
}
</style>
