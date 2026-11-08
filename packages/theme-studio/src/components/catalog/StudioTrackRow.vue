<script setup lang="ts">
import type { Track } from '@any-music/core'
import AppIcon from '@any-music/ui/components/AppIcon.vue'
import RemoteImage from '@any-music/ui/components/music-sources/RemoteImage.vue'
import { computed } from 'vue'

const props = withDefaults(
  defineProps<{
    track: Track
    index: number
    title: string
    selected: boolean
    favorite: boolean
    queued: boolean
    invalid: boolean
    current: boolean
    downloadBusy: boolean
    readonly?: boolean
    selectable?: boolean
    disabled?: boolean
    /** Catalogs can toggle membership; generic library contracts only offer enqueue. */
    queueAction?: 'toggle' | 'add'
  }>(),
  { queueAction: 'toggle' },
)
const queueDisabled = computed(
  () => (props.invalid && !props.queued) || (props.queueAction === 'add' && props.queued),
)
const queueLabel = computed(() =>
  props.queued ? (props.queueAction === 'toggle' ? '移出待听' : '已在待听') : '加入待听',
)
const emit = defineEmits<{
  select: []
  play: []
  favorite: []
  queue: []
  download: []
  actions: []
}>()
</script>

<template>
  <tr class="studio-track" :data-selected="selected" :data-current="current">
    <td v-if="!readonly || selectable">
      <label class="studio-selection"
        ><input
          type="checkbox"
          :checked="selected"
          :disabled="disabled"
          :aria-label="`选择歌曲 ${title}`"
          :data-am-focus-key="`track:${track.id}:select`"
          @change="emit('select')"
        /><span aria-hidden="true">{{ index + 1 }}</span></label
      >
    </td>
    <td>
      <div class="studio-track__identity">
        <RemoteImage
          v-if="track.artworkUrl"
          :src="track.artworkUrl"
          :alt="title"
          :width="44"
          :height="44"
        />
        <div>
          <strong>{{ title }}</strong
          ><span>{{ track.artists.map((artist) => artist.name).join(' / ') || '未知作者' }}</span
          ><span v-if="invalid">歌曲不可用</span>
        </div>
      </div>
    </td>
    <td>
      {{
        track.durationMs === undefined
          ? '未知时长'
          : `${Math.floor(track.durationMs / 60000)}:${String(Math.floor(track.durationMs / 1000) % 60).padStart(2, '0')}`
      }}
    </td>
    <td v-if="!readonly">
      <div class="studio-actions">
        <button
          type="button"
          :aria-label="`播放 ${title}`"
          :data-am-focus-key="`track:${track.id}:play`"
          :disabled="invalid"
          @click="!invalid && emit('play')"
        >
          <AppIcon name="play" />
        </button>
        <button
          type="button"
          :aria-label="`${favorite ? '取消喜欢' : '喜欢'} ${title}`"
          :data-am-focus-key="`track:${track.id}:favorite`"
          :aria-pressed="favorite"
          :disabled="invalid && !favorite"
          @click="(!invalid || favorite) && emit('favorite')"
        >
          <AppIcon name="heart" />
        </button>
        <button
          type="button"
          :aria-label="`${queueLabel} ${title}`"
          :aria-pressed="queued"
          :disabled="queueDisabled"
          @click="!queueDisabled && emit('queue')"
        >
          <AppIcon name="queue" />
        </button>
        <button
          type="button"
          :aria-label="`下载 ${title}`"
          :data-am-focus-key="`track:${track.id}:download`"
          :disabled="invalid || downloadBusy"
          @click="!invalid && !downloadBusy && emit('download')"
        >
          <AppIcon name="download" />
        </button>
        <button
          type="button"
          :aria-label="`歌曲操作 ${title}`"
          :data-am-focus-key="`track:${track.id}:actions`"
          @click="emit('actions')"
        >
          <AppIcon name="more" />
        </button>
      </div>
    </td>
  </tr>
</template>
