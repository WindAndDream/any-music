<script setup lang="ts">
import type { LibraryTrackRecord, Track } from '@any-music/core'
import AppIcon from '@any-music/ui/components/AppIcon.vue'

import type { TagPlatformOption } from '../use-tag-management-filters'
import TagTrackCard from './TagTrackCard.vue'

const props = defineProps<{
  platform: TagPlatformOption
  records: readonly LibraryTrackRecord[]
  expanded: boolean
}>()

const emit = defineEmits<{
  toggle: [platformId: string]
  addTag: [track: Track, tag: string]
  removeTag: [track: Track, tag: string]
}>()

// 平台抽屉只组合本平台的标签卡牌，标签写操作继续逐级上抛到标签插件唯一状态源。
</script>

<template>
  <section class="tag-drawer">
    <button
      class="tag-drawer__toggle"
      type="button"
      :aria-expanded="props.expanded"
      :aria-controls="`tag-drawer-panel-${props.platform.id}`"
      @click="emit('toggle', props.platform.id)"
    >
      <AppIcon :name="props.expanded ? 'arrow-down' : 'arrow-right'" />
      <strong>{{ props.platform.name }}</strong>
      <small>{{ props.records.length }} 首匹配 · 共 {{ props.platform.count }} 首有标签</small>
    </button>

    <div
      v-if="props.expanded"
      :id="`tag-drawer-panel-${props.platform.id}`"
      class="tag-drawer__panel"
    >
      <p v-if="props.records.length === 0" class="tag-drawer__empty">该平台暂无匹配歌曲。</p>
      <template v-else>
        <TagTrackCard
          v-for="record in props.records"
          :key="record.track.id"
          :record="record"
          :platform-name="props.platform.name"
          @add-tag="(track, tag) => emit('addTag', track, tag)"
          @remove-tag="(track, tag) => emit('removeTag', track, tag)"
        />
      </template>
    </div>
  </section>
</template>
