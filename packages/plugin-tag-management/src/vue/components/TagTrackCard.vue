<script setup lang="ts">
import type { LibraryTrackRecord, Track } from '@any-music/core'
import { useEditingSession } from '@any-music/ui'
import AppIcon from '@any-music/ui/components/AppIcon.vue'
import TrackCardSummary from '@any-music/ui/components/tracks/TrackCardSummary.vue'
import { computed, shallowRef } from 'vue'

import { tagDraftKey } from '../tag-track-state'

// 标签卡牌只维护标签关系，不暴露播放、待听或片段编辑操作。
const props = defineProps<{
  record: LibraryTrackRecord
  platformName: string
}>()

const emit = defineEmits<{
  addTag: [track: Track, tag: string]
  removeTag: [track: Track, tag: string]
}>()

const tagDraft = useEditingSession(`track:${props.record.track.id}`).state(tagDraftKey, () =>
  shallowRef(''),
)
const detailLines = computed(() => {
  const updatedLabel = new Intl.DateTimeFormat('zh-CN', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(props.record.updatedAtMs)
  return [`标签维护于 ${updatedLabel} · ${props.record.customTags.length} 个标签`]
})

function submitTag(): void {
  const tag = tagDraft.value.trim()
  if (!tag) return
  emit('addTag', props.record.track, tag)
  tagDraft.value = ''
}
</script>

<template>
  <article class="track-card tag-track">
    <TrackCardSummary
      :track="props.record.track"
      :context-label="props.platformName"
      :detail-lines="detailLines"
    >
      <template #details>
        <div class="tag-track__tags" aria-label="歌曲标签">
          <button
            v-for="tag in props.record.customTags"
            :key="tag"
            type="button"
            :aria-label="`从 ${props.record.track.title} 移除标签 ${tag}`"
            :title="`从 ${props.record.track.title} 移除标签 ${tag}`"
            @click="emit('removeTag', props.record.track, tag)"
          >
            <span>#{{ tag }}</span>
            <AppIcon name="close" :size="12" aria-hidden="true" />
          </button>
        </div>
        <form class="tag-track__form" @submit.prevent="submitTag">
          <input
            v-model="tagDraft"
            maxlength="32"
            :aria-label="`为 ${props.record.track.title} 添加标签`"
            placeholder="添加标签"
          />
          <button type="submit" :disabled="!tagDraft.trim()">添加</button>
        </form>
      </template>
    </TrackCardSummary>
  </article>
</template>
