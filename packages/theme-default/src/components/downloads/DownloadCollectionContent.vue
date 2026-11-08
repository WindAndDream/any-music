<script setup lang="ts">
import AppIcon from '@any-music/ui/components/AppIcon.vue'
import MusicListEmptyState from '@any-music/ui/components/music-sources/MusicListEmptyState.vue'
import type { UiThemeFeatureMap } from '@any-music/ui/theme'
import { computed, shallowRef, watch } from 'vue'

import CatalogOperatorActions from '../music-sources/CatalogOperatorActions.vue'
import DownloadCollectionHeading from './DownloadCollectionHeading.vue'

type Status = UiThemeFeatureMap['downloads']['state']['statusFilter']
const props = defineProps<{
  concurrency: number
  mobileLayout: boolean
  hideDisplay?: boolean
  status: Status
  counts: Readonly<Record<Status, number>>
  statuses: readonly { id: Status; name: string }[]
  empty: boolean
}>()
defineEmits<{ status: [status: Status]; display: [] }>()
defineSlots<{ default?: () => unknown }>()

const statusIndex = computed(() => props.statuses.findIndex(({ id }) => id === props.status))
const direction = shallowRef<'forward' | 'back'>('forward')
watch(
  statusIndex,
  (next, previous) => {
    direction.value = next > previous ? 'forward' : 'back'
  },
  { flush: 'sync' },
)
function deactivateLeavingView(element: Element): void {
  element.setAttribute('inert', '')
  element.setAttribute('aria-hidden', 'true')
}
function activateView(element: Element): void {
  element.removeAttribute('inert')
  element.removeAttribute('aria-hidden')
}
</script>

<template>
  <div class="download-collection__surface">
    <DownloadCollectionHeading
      :concurrency="concurrency"
      :downloaded-count="counts.succeeded"
      :mobile-layout="mobileLayout"
    />
    <div
      class="download-collection__toolbar"
      :class="{ 'download-collection__toolbar--compact': hideDisplay }"
    >
      <CatalogOperatorActions
        class="download-collection__tabs"
        role="group"
        aria-label="下载状态"
        align="start"
        forward-label="查看更多下载状态"
        back-label="返回前面的下载状态"
      >
        <div
          class="download-collection__status-options"
          :style="{
            '--am-state-tab-count': statuses.length,
            '--am-state-tab-index': statusIndex,
          }"
        >
          <button
            v-for="entry in statuses"
            :key="entry.id"
            type="button"
            class="download-collection__tab"
            :aria-pressed="status === entry.id"
            @click="$emit('status', entry.id)"
          >
            {{ entry.name }} <span>{{ counts[entry.id] }}</span>
          </button>
        </div>
      </CatalogOperatorActions>
      <button
        v-if="!hideDisplay && !mobileLayout"
        class="download-collection__display"
        type="button"
        aria-haspopup="dialog"
        aria-label="选择歌曲展示方式"
        title="展示方式"
        @click="$emit('display')"
      >
        <AppIcon name="list" :size="16" /><span class="download-collection__display-label"
          >展示方式</span
        >
      </button>
    </div>
    <div class="download-collection__results">
      <Transition
        :name="`download-status-${direction}`"
        @before-leave="deactivateLeavingView"
        @before-enter="activateView"
        @leave-cancelled="activateView"
      >
        <div :key="status" class="download-collection__list">
          <MusicListEmptyState
            v-if="empty"
            icon="download"
            :title="
              !counts.all
                ? '当前没有下载任务'
                : status === 'all'
                  ? '没有匹配的下载任务'
                  : `没有${statuses.find((entry) => entry.id === status)?.name}任务`
            "
            >{{
              counts.all
                ? '切换下载状态或调整筛选条件，找到需要的歌曲。'
                : '在发现、待听、我的喜欢或歌单中选择歌曲，即可开始下载。'
            }}</MusicListEmptyState
          >
          <slot v-else />
        </div>
      </Transition>
    </div>
  </div>
</template>

<style scoped lang="scss">
@use '../../styles/collection-chrome';
.download-collection__surface {
  display: flex;
  flex: 1 0 auto;
  flex-direction: column;
  min-inline-size: 0;
  padding: var(--am-space-4) var(--am-space-3);
  background: var(--am-color-surface-subtle);
}
.download-collection__toolbar {
  position: sticky;
  z-index: var(--am-z-sticky);
  inset-block-start: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: var(--am-space-2);
  margin-block-end: var(--am-space-4);
  padding-block: var(--am-space-2);
  border-block-end: 1px solid var(--am-color-border);
  background: var(--am-color-surface-subtle);
}
.download-collection__tabs {
  --am-operator-actions-background: var(--am-color-surface-subtle);
  min-inline-size: 0;
}
.download-collection__toolbar--compact {
  grid-template-columns: minmax(0, 1fr);
}
.download-collection__tabs :deep(.catalog-operator-actions__content) {
  gap: var(--am-space-1);
}
.download-collection__status-options {
  @include collection-chrome.state-tabs(5);
}
.download-collection__results {
  position: relative;
  display: grid;
  flex: 1 0 auto;
  grid-template-columns: minmax(0, 1fr);
  min-inline-size: 0;
  overflow-x: clip;
}
.download-collection__list {
  display: flex;
  flex-direction: column;
  grid-area: 1 / 1;
  inline-size: 100%;
  min-inline-size: 0;
}
.download-status-forward-enter-active,
.download-status-forward-leave-active,
.download-status-back-enter-active,
.download-status-back-leave-active {
  transition:
    transform var(--am-motion-slow) var(--am-ease-emphasized),
    opacity var(--am-motion-slow) var(--am-ease-standard);
}
.download-status-forward-leave-active,
.download-status-back-leave-active {
  /* Let the incoming status own the height, as on the other collection pages. */
  position: absolute;
  inset: 0;
  overflow: clip;
  pointer-events: none;
}
.download-status-forward-enter-from,
.download-status-back-leave-to {
  opacity: 0;
  transform: translateX(100%);
}
.download-status-forward-leave-to,
.download-status-back-enter-from {
  opacity: 0;
  transform: translateX(-100%);
}
.download-collection__display {
  display: inline-flex;
  min-block-size: 44px;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  gap: var(--am-space-2);
  padding-inline: var(--am-space-3);
  border: 1px solid var(--am-color-border);
  border-radius: var(--am-radius-control);
  background: var(--am-color-surface);
  color: var(--am-color-text);
  font: 650 var(--am-font-size-xs) var(--am-font-family);
  white-space: nowrap;
  cursor: pointer;
  touch-action: manipulation;
  transition:
    background-color var(--am-motion-fast) var(--am-ease-standard),
    color var(--am-motion-fast) var(--am-ease-standard);
}
.download-collection__display:is(:hover, :focus-visible) {
  background: var(--am-color-surface-hover);
}
.download-collection__display:focus-visible {
  outline: var(--am-focus-ring);
  outline-offset: -3px;
}

@container am-download-collection (max-width: 760px) {
  .download-collection__display {
    inline-size: 44px;
    min-inline-size: 44px;
    padding-inline: 0;
  }
  .download-collection__display-label {
    display: none;
  }
}

@media (prefers-reduced-motion: reduce) {
  .download-status-forward-enter-active,
  .download-status-forward-leave-active,
  .download-status-back-enter-active,
  .download-status-back-leave-active,
  .download-collection__display {
    transition: none;
  }
}
</style>
