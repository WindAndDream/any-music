<script setup lang="ts">
import { provideTrackNames } from '@any-music/ui/library'
import type { UiThemeFeatureMap } from '@any-music/ui/theme'
import { computed } from 'vue'

import ClassicFeatureStatus from './ClassicFeatureStatus.vue'
import CustomTrackDrawer from './CustomTrackDrawer.vue'

const props = defineProps<{ feature: UiThemeFeatureMap['custom-tracks'] }>()
const state = computed(() => props.feature.state)
provideTrackNames(computed(() => state.value.customNamesByTrackId))
const records = computed(
  () => new Map(state.value.records.map((record) => [record.track.id, record])),
)
const definitions = computed(
  () => new Map(state.value.definitions.map((definition) => [definition.trackId, definition])),
)
const collections = computed(
  () => new Map(state.value.materialCollections.map((collection) => [collection.id, collection])),
)
const favorites = computed(() => new Set(state.value.favoriteTrackIds))
const visible = computed(() => {
  const query = state.value.query.normalize('NFKC').trim().toLocaleLowerCase()
  return state.value.definitions
    .flatMap((definition) => {
      const record = records.value.get(definition.trackId)
      if (!record) return []
      const collection = collections.value.get(definition.materialCollectionId)
      const text = [
        record.track.title,
        record.customName ?? '',
        definition.creator.displayName,
        collection?.name ?? '',
        ...definition.sourceCredits.flatMap((credit) => [credit.artistName, credit.artistId ?? '']),
      ]
        .join('\n')
        .normalize('NFKC')
        .toLocaleLowerCase()
      return !query || text.includes(query) ? [{ definition, record, collection }] : []
    })
    .toSorted((left, right) => right.definition.createdAtMs - left.definition.createdAtMs)
})
function sourceRecords(ids: readonly string[]) {
  return [...new Set(ids)].flatMap((id) => {
    const record = records.value.get(id)
    return record ? [record] : []
  })
}
function remove(trackId: string) {
  if (props.feature.availability.status === 'available')
    void props.feature.actions.remove([trackId])
}
</script>

<template>
  <section class="classic-library custom-tracks" aria-label="全部自定义音乐列表">
    <ClassicFeatureStatus :availability="feature.availability" :status="feature.status" />
    <fieldset :disabled="feature.availability.status !== 'available'">
      <header class="custom-tracks__toolbar">
        <input
          type="search"
          aria-label="搜索全部自定义音乐"
          :value="state.query"
          @input="feature.actions.setQuery(($event.target as HTMLInputElement).value)"
        />
        <span>匹配 {{ visible.length }} / 共 {{ state.definitions.length }} 首</span>
        <label
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
        >
      </header>
      <p v-if="!state.definitions.length">还没有自定义歌曲。</p>
      <p v-else-if="!visible.length">没有匹配的自定义歌曲。</p>
      <CustomTrackDrawer
        v-for="entry in visible"
        :key="entry.record.track.id"
        :record="entry.record"
        :current-track-id="state.currentTrackId ?? undefined"
        :definition="entry.definition"
        :collection="entry.collection"
        :source-records="
          sourceRecords(entry.definition.recipe.map(({ sourceTrackId }) => sourceTrackId))
        "
        :custom-definitions="definitions"
        :platform-names="state.platformNames"
        :favorite-track-ids="favorites"
        :expanded="state.expandedTrackIds.includes(entry.record.track.id)"
        :export-format="state.exportFormat"
        :export-busy="state.exportBusy"
        @toggle="feature.actions.setExpanded($event, !state.expandedTrackIds.includes($event))"
        @play="feature.actions.play($event.id)"
        @queue="feature.actions.enqueue([$event.id])"
        @compose="feature.actions.useAsMaterial([$event])"
        @favorite="feature.actions.toggleFavorite($event.id)"
        @unfavorite="feature.actions.toggleFavorite($event)"
        @download="(id, format) => feature.actions.download([id], format)"
        @delete="remove"
      />
    </fieldset>
  </section>
</template>
