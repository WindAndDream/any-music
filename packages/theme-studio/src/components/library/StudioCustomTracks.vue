<script setup lang="ts">
import type { UiThemeFeatureMap } from '@any-music/ui/theme'
import { computed } from 'vue'

import { useStudioActivity } from '../../composables/use-studio-activity'
import StudioCollection from './StudioCollection.vue'
const props = defineProps<{ feature: UiThemeFeatureMap['custom-tracks'] }>()
const state = computed(() => props.feature.state)
const definitions = computed(
  () => new Map(state.value.definitions.map((item) => [item.trackId, item])),
)
const filtered = computed(() => ({
  ...state.value,
  tracks: state.value.tracks.filter((track) => {
    const definition = definitions.value.get(track.id)
    if (!definition) return false
    const text = [
      track.title,
      state.value.customNamesByTrackId.get(track.id) ?? '',
      definition.creator.displayName,
      ...definition.sourceCredits.map((credit) => credit.artistName),
    ]
      .join(' ')
      .normalize('NFKC')
      .toLocaleLowerCase()
    return text.includes(state.value.query.normalize('NFKC').trim().toLocaleLowerCase())
  }),
}))
const { confirmAction } = useStudioActivity(() => props.feature.availability)
</script>
<template>
  <StudioCollection
    title="全部自定义音乐列表"
    scope="custom-tracks"
    :state="filtered"
    :actions="feature.actions"
    :availability="feature.availability"
    :status="feature.status"
    :remove="feature.actions.remove"
    ><template #header
      ><label
        >搜索全部自定义音乐<input
          type="search"
          aria-label="搜索全部自定义音乐"
          :value="state.query"
          @input="feature.actions.setQuery(($event.target as HTMLInputElement).value)" /></label
      ><label
        >下载格式<select
          :value="state.exportFormat"
          @change="
            feature.actions.setExportFormat(
              ($event.target as HTMLSelectElement).value === 'wav' ? 'wav' : 'mp3',
            )
          "
        >
          <option value="mp3">MP3 · 192 kbps</option>
          <option value="wav">WAV · PCM 16-bit</option>
        </select></label
      ></template
    ><template #details="{ trackId }"
      ><button
        type="button"
        :aria-expanded="state.expandedTrackIds.includes(trackId)"
        @click="feature.actions.setExpanded(trackId, !state.expandedTrackIds.includes(trackId))"
      >
        作品配方与署名
      </button>
      <div v-if="state.expandedTrackIds.includes(trackId)" class="studio-work-details">
        <p>创作者 {{ definitions.get(trackId)?.creator.displayName }}</p>
        <p v-for="(credit, index) in definitions.get(trackId)?.sourceCredits ?? []" :key="index">
          {{ credit.artistName }} {{ credit.artistId }}
        </p>
        <ol>
          <li v-for="(segment, index) in definitions.get(trackId)?.recipe ?? []" :key="index">
            {{
              state.records.find((record) => record.track.id === segment.sourceTrackId)?.track
                .title ?? segment.sourceTrackId
            }}
            · {{ segment.startMs }} — {{ segment.endMs }} ms
          </li>
        </ol>
        <button type="button" @click="feature.actions.edit(trackId)">编辑作品</button
        ><button
          type="button"
          :disabled="state.exportBusy || state.invalidTrackIds.includes(trackId)"
          @click="feature.actions.download([trackId], state.exportFormat)"
        >
          下载作品</button
        ><button
          type="button"
          @click="
            confirmAction('删除自定义歌曲', '确定删除这首作品？', () =>
              feature.actions.remove([trackId]),
            )
          "
        >
          删除作品
        </button>
      </div></template
    ></StudioCollection
  >
</template>
