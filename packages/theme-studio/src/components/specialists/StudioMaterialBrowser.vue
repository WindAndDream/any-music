<script setup lang="ts">
import type { MusicCreationPresentation } from '@any-music/ui/theme'
import { computed } from 'vue'
const props = defineProps<{ editor: MusicCreationPresentation }>()
const state = computed(() => props.editor.state)
</script>
<template>
  <section aria-label="可用音乐素材">
    <h2>{{ state.activeCollection?.name ?? '未选择合集' }}</h2>
    <p v-if="!state.materialCollections.length">
      先创建一个素材合集，再从资料库加入普通音乐或已有自定义音乐。
    </p>
    <component
      :is="editor.controls.Filter"
      :model-value="state.filters"
      :platforms="state.platformOptions"
      :tag-stats="state.tagStats"
      @update:model-value="editor.actions.setFilters"
    />
    <p>显示 {{ state.visibleRecords.length }} / 资料库 {{ state.records.length }} 首</p>
    <p v-if="!state.visibleRecords.length">没有匹配的音乐素材。</p>
    <div class="studio-material-grid">
      <component
        v-for="record in state.visibleRecords"
        :key="record.track.id"
        :is="editor.controls.Material"
        :record="record"
        :platform-name="
          state.platformNames.get(record.track.source.pluginId) ?? record.track.source.pluginId
        "
        :included="state.collectionTrackIds.has(record.track.id)"
        :segment-count="state.segmentStatsByTrackId.get(record.track.id)?.segmentCount ?? 0"
        :clipped-duration-ms="
          state.segmentStatsByTrackId.get(record.track.id)?.totalDurationMs ?? 0
        "
        :export-busy="state.exportBusy"
        @add-material="editor.actions.addMaterial"
        @remove-material="editor.actions.removeMaterial"
        @add-segment="editor.actions.addSegment"
        @preview="editor.actions.preview"
        @download="editor.actions.downloadSegment"
      />
    </div>
  </section>
</template>
