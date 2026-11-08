<script setup lang="ts">
import { usePointerGestureGuard } from '@any-music/ui'
import type { UiSourceToolbarProps, UiSourceToolbarEmits } from '@any-music/ui/catalog'
import { useEditingSession } from '@any-music/ui/catalog'
import { getMusicSourceInputHints } from '@any-music/ui/catalog'
import { getImportUrlScopeError } from '@any-music/ui/catalog'
import AppIcon from '@any-music/ui/components/AppIcon.vue'
import { computed, nextTick, onScopeDispose, shallowRef, watch } from 'vue'
import type { CSSProperties } from 'vue'

import { discoveryModeKey } from './source-toolbar-state'

type DiscoveryMode = 'search' | 'import'

// 弹框内的发现表单把搜索与导入作为同一任务的两个模式，网络请求仍只在明确提交时发生。
const props = defineProps<UiSourceToolbarProps>()

const emit = defineEmits<UiSourceToolbarEmits>()

const searchQuery = defineModel<string>('searchQuery', { required: true })
const importUrl = defineModel<string>('importUrl', { required: true })
const activeMode = useEditingSession(`source-toolbar:${props.pluginId}`).state(
  discoveryModeKey,
  () => shallowRef<DiscoveryMode>(props.supportsSearch ? 'search' : 'import'),
)
const dragOffsetPx = shallowRef(0)
const dragStartX = shallowRef<number>()
const dragWidthPx = shallowRef(0)
let dragPointer: { id: number; target: HTMLElement } | undefined
const gestureGuard = usePointerGestureGuard({ finish: handlePointerEnd, cancel: cancelSwipe })
const inputHints = computed(() => getMusicSourceInputHints(props.pluginId))
const importUrlScopeError = computed(() =>
  getImportUrlScopeError(importUrl.value, props.importUrlScopes),
)
const importUrlScopeLabels = computed(() =>
  props.importUrlScopes.map((scope) => `${scope.origin}${scope.pathnamePrefix}`),
)
const availableModes = computed<readonly DiscoveryMode[]>(() => [
  ...(props.supportsSearch ? (['search'] as const) : []),
  ...(props.supportsImport ? (['import'] as const) : []),
])
const activeModeIndex = computed(() => Math.max(0, availableModes.value.indexOf(activeMode.value)))
const canSubmitSearch = computed(() => Boolean(searchQuery.value.trim()))
const canSubmitImport = computed(
  () => Boolean(importUrl.value.trim()) && !importUrlScopeError.value,
)
const carouselStyle = computed<CSSProperties>(() => ({
  transform: `translate3d(calc(${-activeModeIndex.value * 100}% + ${dragOffsetPx.value}px), 0, 0)`,
}))

watch(
  availableModes,
  (modes) => {
    cancelSwipe()
    if (!modes.includes(activeMode.value)) activeMode.value = modes[0] ?? 'search'
  },
  { immediate: true },
)

function setActiveMode(mode: DiscoveryMode): void {
  cancelSwipe()
  if (availableModes.value.includes(mode)) activeMode.value = mode
}

function handleModeKeydown(event: KeyboardEvent): void {
  if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
  event.preventDefault()
  const offset = event.key === 'ArrowRight' ? 1 : -1
  const nextIndex =
    (activeModeIndex.value + offset + availableModes.value.length) % availableModes.value.length
  const nextMode = availableModes.value[nextIndex] ?? activeMode.value
  setActiveMode(nextMode)
  const root =
    event.currentTarget instanceof HTMLElement ? event.currentTarget.getRootNode() : undefined
  void nextTick(() => {
    if (!(root instanceof Document || root instanceof ShadowRoot)) return
    root.querySelector<HTMLElement>(`#am-source-${nextMode}-tab`)?.focus()
  })
}

function submitSearch(): void {
  if (canSubmitSearch.value) emit('search', searchQuery.value)
}

function submitImport(): void {
  if (canSubmitImport.value) emit('importUrl', importUrl.value)
}

function handlePointerDown(event: PointerEvent): void {
  if (availableModes.value.length < 2) return
  if (!event.isPrimary || event.button !== 0 || dragStartX.value !== undefined) return
  if (event.target instanceof Element && event.target.closest('input, button, a, textarea, select'))
    return
  const target = event.currentTarget
  if (!(target instanceof HTMLElement)) return
  dragStartX.value = event.clientX
  dragWidthPx.value = target.getBoundingClientRect().width
  dragPointer = { id: event.pointerId, target }
  gestureGuard.start(event)
  target.setPointerCapture(event.pointerId)
}

function handlePointerMove(event: PointerEvent): void {
  if (dragStartX.value === undefined || dragPointer?.id !== event.pointerId) return
  const rawOffset = event.clientX - dragStartX.value
  const isAtStart = activeModeIndex.value === 0 && rawOffset > 0
  const isAtEnd = activeModeIndex.value === availableModes.value.length - 1 && rawOffset < 0
  // 边界使用阻尼反馈，避免内容被拖离可用区域。
  dragOffsetPx.value = (isAtStart || isAtEnd ? 0.24 : 1) * rawOffset
}

function handlePointerEnd(event: PointerEvent): void {
  if (dragPointer?.id !== event.pointerId) return
  handlePointerMove(event)
  const threshold = Math.min(72, Math.max(44, dragWidthPx.value * 0.12))
  let nextMode = activeMode.value
  if (dragOffsetPx.value <= -threshold) {
    nextMode = availableModes.value[activeModeIndex.value + 1] ?? activeMode.value
  } else if (dragOffsetPx.value >= threshold) {
    nextMode = availableModes.value[activeModeIndex.value - 1] ?? activeMode.value
  }
  setActiveMode(nextMode)
}

function cancelSwipe(): void {
  gestureGuard.stop()
  const previous = dragPointer
  dragPointer = undefined
  dragStartX.value = undefined
  dragOffsetPx.value = 0
  dragWidthPx.value = 0
  if (previous?.target.hasPointerCapture(previous.id))
    previous.target.releasePointerCapture(previous.id)
}

function handlePointerCancel(event: PointerEvent): void {
  if (dragPointer?.id === event.pointerId) cancelSwipe()
}

onScopeDispose(cancelSwipe)
</script>

<template>
  <section class="source-toolbar" aria-label="搜索或导入音乐">
    <div v-if="availableModes.length > 1" class="source-toolbar__segments" role="tablist">
      <button
        id="am-source-search-tab"
        type="button"
        role="tab"
        :aria-selected="activeMode === 'search'"
        aria-controls="am-source-search-panel"
        :tabindex="activeMode === 'search' ? 0 : -1"
        @click="setActiveMode('search')"
        @keydown="handleModeKeydown"
      >
        搜索
      </button>
      <button
        id="am-source-import-tab"
        type="button"
        role="tab"
        :aria-selected="activeMode === 'import'"
        aria-controls="am-source-import-panel"
        :tabindex="activeMode === 'import' ? 0 : -1"
        @click="setActiveMode('import')"
        @keydown="handleModeKeydown"
      >
        导入链接
      </button>
    </div>

    <div
      class="source-toolbar__viewport"
      :class="{
        'source-toolbar__viewport--swipeable': availableModes.length > 1,
        'source-toolbar__viewport--dragging': dragStartX !== undefined,
      }"
      @pointerdown="handlePointerDown"
      @pointermove="handlePointerMove"
      @pointerup="handlePointerEnd"
      @pointercancel="handlePointerCancel"
      @lostpointercapture="handlePointerCancel"
    >
      <div
        class="source-toolbar__forms"
        :class="{ 'source-toolbar__forms--dragging': dragStartX !== undefined }"
        :style="carouselStyle"
      >
        <form
          v-if="props.supportsSearch"
          id="am-source-search-panel"
          class="source-toolbar__form"
          role="search"
          :aria-labelledby="availableModes.length > 1 ? 'am-source-search-tab' : undefined"
          :aria-label="availableModes.length > 1 ? undefined : '搜索音乐'"
          :aria-hidden="activeMode !== 'search'"
          :inert="activeMode !== 'search'"
          @submit.prevent="submitSearch"
        >
          <label class="source-toolbar__label" for="am-source-search">
            <span>想听什么？</span>
            <small>歌曲、作者或关键词</small>
          </label>
          <div class="source-toolbar__row">
            <AppIcon class="source-toolbar__input-icon" name="search" />
            <input
              id="am-source-search"
              v-model="searchQuery"
              class="source-toolbar__input"
              type="search"
              name="music-source-search"
              autocomplete="off"
              spellcheck="false"
              :placeholder="`${inputHints.searchPlaceholder}…`"
            />
            <button class="source-toolbar__button" type="submit" :disabled="!canSubmitSearch">
              搜索
            </button>
          </div>
        </form>

        <form
          v-if="props.supportsImport"
          id="am-source-import-panel"
          class="source-toolbar__form"
          :aria-labelledby="availableModes.length > 1 ? 'am-source-import-tab' : undefined"
          :aria-label="availableModes.length > 1 ? undefined : '导入音乐链接'"
          :aria-hidden="activeMode !== 'import'"
          :inert="activeMode !== 'import'"
          @submit.prevent="submitImport"
        >
          <label class="source-toolbar__label" for="am-source-import">
            <span>粘贴来源链接</span>
            <small>视频、合集、收藏夹或用户主页</small>
          </label>
          <div class="source-toolbar__row">
            <AppIcon class="source-toolbar__input-icon" name="link" />
            <input
              id="am-source-import"
              v-model="importUrl"
              class="source-toolbar__input"
              type="url"
              name="music-source-import-url"
              inputmode="url"
              autocomplete="off"
              spellcheck="false"
              :placeholder="`${inputHints.importPlaceholder}…`"
              :aria-invalid="Boolean(importUrlScopeError)"
              aria-describedby="am-source-import-feedback"
            />
            <button class="source-toolbar__button" type="submit" :disabled="!canSubmitImport">
              导入
            </button>
          </div>
          <p
            id="am-source-import-feedback"
            class="source-toolbar__feedback"
            :class="{ 'source-toolbar__feedback--error': importUrlScopeError }"
            aria-live="polite"
          >
            <template v-if="importUrlScopeError">{{ importUrlScopeError }}</template>
            <template v-else-if="importUrlScopeLabels.length">
              支持：{{ importUrlScopeLabels.join('、') }}
            </template>
            <template v-else>当前音乐源未声明可导入的网址范围。</template>
          </p>
        </form>
      </div>
    </div>
  </section>
</template>

<style scoped>
.source-toolbar {
  container: am-discovery / inline-size;
  inline-size: 100%;
  overflow: hidden;
}

.source-toolbar__feedback {
  margin: 0;
}

.source-toolbar__feedback,
.source-toolbar__label small {
  color: var(--am-color-text-secondary);
  font-size: var(--am-font-size-xs);
}

.source-toolbar__segments button,
.source-toolbar__button {
  border: 0;
  font: inherit;
  cursor: pointer;
}

.source-toolbar__segments {
  display: grid;
  inline-size: min(320px, calc(100% - (var(--am-space-5) * 2)));
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--am-space-1);
  margin: 0 auto var(--am-space-4);
  padding: var(--am-space-1);
  border-radius: var(--am-radius-card);
  background: var(--am-color-surface-subtle);
}

.source-toolbar__segments button {
  min-block-size: 36px;
  border-radius: var(--am-radius-control);
  background: transparent;
  color: var(--am-color-text-secondary);
  font-weight: 680;
  transition:
    background-color var(--am-motion-fast) var(--am-ease-standard),
    color var(--am-motion-fast) var(--am-ease-standard),
    box-shadow var(--am-motion-fast) var(--am-ease-standard);
}

.source-toolbar__segments button[aria-selected='true'] {
  background: var(--am-color-surface);
  box-shadow: var(--am-shadow-control);
  color: var(--am-color-primary);
}

.source-toolbar__segments button:hover:not([aria-selected='true']) {
  background: var(--am-color-surface-hover);
  color: var(--am-color-text);
}

.source-toolbar__segments button:focus-visible,
.source-toolbar__button:focus-visible {
  outline: var(--am-focus-ring);
  outline-offset: var(--am-focus-offset);
}

.source-toolbar__viewport {
  overflow: hidden;
  touch-action: pan-y;
}

.source-toolbar__viewport--swipeable {
  cursor: grab;
}

.source-toolbar__viewport--dragging {
  cursor: grabbing;
}

.source-toolbar__forms {
  display: grid;
  grid-auto-columns: 100%;
  grid-auto-flow: column;
  transition: transform var(--am-motion-slow) var(--am-ease-emphasized);
}

.source-toolbar__forms--dragging {
  transition: none;
  cursor: grabbing;
  user-select: none;
}

.source-toolbar__form {
  inline-size: min(100%, 760px);
  min-inline-size: 0;
  margin-inline: auto;
  padding: var(--am-space-2) var(--am-space-2) var(--am-space-4);
}

.source-toolbar__form[aria-hidden='true'] {
  /* Only the active form sets the carousel height; offscreen feedback must not add blank space. */
  contain: size;
}

.source-toolbar__label {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--am-space-3);
  margin-block-end: var(--am-space-2);
  color: var(--am-color-text);
  font-weight: 700;
  cursor: inherit;
}

.source-toolbar__row {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: var(--am-space-2);
  min-block-size: 44px;
  padding-inline-start: var(--am-space-4);
  border: 1px solid var(--am-color-border-strong);
  border-radius: var(--am-radius-control);
  background: var(--am-color-background);
  color: var(--am-color-text-secondary);
  transition:
    border-color var(--am-motion-fast) var(--am-ease-standard),
    box-shadow var(--am-motion-fast) var(--am-ease-standard);
}

.source-toolbar__row:focus-within {
  border-color: var(--am-color-primary);
  box-shadow: 0 0 0 3px var(--am-color-focus-ring);
}

.source-toolbar__input {
  min-inline-size: 0;
  block-size: 100%;
  padding: 0;
  border: 0;
  outline: 0;
  background: transparent;
  color: var(--am-color-text);
  font: inherit;
  cursor: text;
}

.source-toolbar__button {
  align-self: stretch;
  min-inline-size: 80px;
  padding-inline: var(--am-space-4);
  border-radius: calc(var(--am-radius-control) - 1px);
  background: var(--am-color-primary);
  color: var(--am-color-on-primary);
  font-weight: 720;
  transition: background-color var(--am-motion-fast) var(--am-ease-standard);
}

.source-toolbar__button:is(:hover, :focus-visible):not(:disabled) {
  background: var(--am-color-primary-hover);
}

.source-toolbar__input-icon {
  transition: transform var(--am-motion-fast) var(--am-ease-emphasized);
}

@media (prefers-reduced-motion: no-preference) {
  /* 只由可用的提交按钮触发动效，输入和禁用状态保持稳定。 */
  .source-toolbar__row:has(.source-toolbar__button:is(:hover, :focus-visible):not(:disabled))
    .source-toolbar__input-icon {
    transform: scale(1.12) rotate(-8deg);
  }

  #am-source-import-panel
    .source-toolbar__row:has(.source-toolbar__button:is(:hover, :focus-visible):not(:disabled))
    .source-toolbar__input-icon {
    transform: translateY(-2px) rotate(-8deg);
  }
}

.source-toolbar__button:disabled {
  cursor: not-allowed;
  filter: saturate(0.2);
  opacity: 0.48;
}

.source-toolbar__feedback {
  margin-block-start: var(--am-space-2);
}

.source-toolbar__feedback--error {
  color: var(--am-color-danger);
}

@container am-discovery (max-width: 544px) {
  .source-toolbar__segments {
    inline-size: 100%;
  }

  .source-toolbar__segments button {
    min-block-size: 34px;
  }

  .source-toolbar__form {
    padding-inline: 0;
  }

  .source-toolbar__label {
    align-items: flex-start;
    flex-direction: column;
    gap: 0;
  }

  .source-toolbar__row {
    min-block-size: 40px;
    padding-inline-start: var(--am-space-3);
  }

  .source-toolbar__button {
    min-inline-size: 68px;
    padding-inline: var(--am-space-3);
  }
}

@media (prefers-reduced-motion: reduce) {
  .source-toolbar__forms,
  .source-toolbar__segments button,
  .source-toolbar__row,
  .source-toolbar__button,
  .source-toolbar__input-icon {
    transition: none;
  }
}
</style>
