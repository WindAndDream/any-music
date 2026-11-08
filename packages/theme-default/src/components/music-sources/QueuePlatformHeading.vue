<script setup lang="ts">
import AppIcon from '@any-music/ui/components/AppIcon.vue'
import type { TrackPlaybackState } from '@any-music/ui/library'
import { shallowRef, useId, useTemplateRef } from 'vue'

import CatalogHeadingHandle from './CatalogHeadingHandle.vue'

/** 平台歌曲页沿用搜索歌曲页的返回栏；只替换待听上下文，不参与队列操作。 */
defineProps<{
  name: string
  collectionTitle?: string
  totalCount: number
  visibleCount: number
  filtered: boolean
  isCustom: boolean
  mobileLayout: boolean
  hideDisplay?: boolean
  countUnit?: string
  playbackStatus?: TrackPlaybackState['status']
}>()
const emit = defineEmits<{ back: []; display: [] }>()
defineSlots<{ actions?: () => unknown }>()
const heading = useTemplateRef<HTMLElement>('heading')
const contextId = useId()
const isCollapsed = shallowRef(false)
</script>

<template>
  <header class="catalog-page__sticky-header queue-platform-heading">
    <div
      ref="heading"
      class="catalog-page__heading"
      :class="{ 'catalog-page__heading--collapsed': isCollapsed }"
      :data-mobile-layout="mobileLayout"
    >
      <button
        class="catalog-page__back"
        type="button"
        aria-label="返回按平台"
        @click="emit('back')"
      >
        <AppIcon name="arrow-left" :size="18" />
        <span class="catalog-page__back-label">返回按平台</span>
      </button>
      <div v-show="!isCollapsed" :id="contextId" class="catalog-page__context">
        <h2
          class="catalog-page__context-title queue-platform-heading__title"
          :class="{ 'queue-platform-heading__title--custom': isCustom }"
          tabindex="-1"
          data-collection-focus
          :title="name"
        >
          <span class="queue-platform-heading__name">{{ name }}</span>
        </h2>
        <div class="catalog-page__context-summary queue-platform-heading__summary">
          <span>
            {{ collectionTitle ?? '待听' }} · {{ filtered ? `匹配 ${visibleCount} / ` : '' }}共
            {{ totalCount }} {{ countUnit ?? '首' }}
            <template v-if="isCustom"> · 本地拼接</template>
          </span>
          <span v-if="playbackStatus" class="queue-platform-heading__status" aria-live="polite">{{
            playbackStatus === 'paused' ? '已暂停' : '正在播放'
          }}</span>
        </div>
      </div>
      <CatalogHeadingHandle
        :collapsed="isCollapsed"
        :controls="contextId"
        :drag-only="mobileLayout"
        :gesture-target="heading"
        @update-collapsed="isCollapsed = $event"
      />
      <div v-if="!mobileLayout && (!hideDisplay || $slots.actions)" class="catalog-page__actions">
        <button
          v-if="!hideDisplay"
          class="catalog-page__display"
          type="button"
          aria-haspopup="dialog"
          aria-label="选择歌曲展示方式"
          title="展示方式"
          @click="emit('display')"
        >
          <AppIcon name="list" :size="17" />
          <span class="queue-platform-heading__display-label">展示方式</span>
        </button>
        <slot name="actions" />
      </div>
    </div>
  </header>
</template>

<style scoped>
.queue-platform-heading {
  /* 返回栏覆盖页面宽度，歌曲仍沿用搜索列表的内层横向留白。 */
  margin-inline: calc(-1 * (var(--am-catalog-page-padding) + var(--am-space-3)));
}
.queue-platform-heading__title {
  display: flex;
  box-sizing: border-box;
  min-inline-size: 0;
  min-block-size: 44px;
  align-items: center;
  margin: 0;
  padding-inline: var(--am-space-3);
  color: var(--am-color-text);
  font-size: var(--am-font-size-md);
  font-weight: 700;
}
.queue-platform-heading__name {
  min-inline-size: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.queue-platform-heading__title--custom {
  color: var(--am-color-primary);
}
.queue-platform-heading__summary {
  display: flex;
  min-inline-size: 0;
  flex-wrap: wrap;
  align-items: center;
  justify-content: end;
  gap: var(--am-space-1) var(--am-space-2);
}
.queue-platform-heading__status {
  padding: var(--am-space-1) var(--am-space-2);
  border-radius: var(--am-radius-detail);
  background: var(--am-color-primary-container);
  color: var(--am-color-primary);
  white-space: nowrap;
}
@container am-listen-queue (max-width: 760px) {
  .queue-platform-heading .catalog-page__display {
    inline-size: 44px;
    min-inline-size: 44px;
    padding-inline: 0;
  }
  .queue-platform-heading__display-label {
    display: none;
  }
}
</style>
