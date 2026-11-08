<script setup lang="ts">
import type { MusicCreationPresentation } from '@any-music/ui/theme'
import { computed } from 'vue'

import StudioMaterialBrowser from './StudioMaterialBrowser.vue'
import StudioTimeline from './StudioTimeline.vue'
const props = defineProps<{ editor: MusicCreationPresentation }>()
const state = computed(() => props.editor.state)
</script>
<template>
  <div class="studio-creation">
    <header class="studio-actions">
      <component
        :is="editor.controls.Collections"
        :collections="state.materialCollections"
        :active-collection-id="state.activeCollectionId"
        @select="editor.actions.selectCollection"
        @create="editor.actions.createCollection"
        @delete="editor.actions.deleteCollection"
      /><button type="button" @click="editor.actions.clearData">
        清空创作数据（保留已发布作品）
      </button>
    </header>
    <StudioTimeline :editor="editor" />
    <div class="studio-split">
      <aside>
        <h2>待整理素材</h2>
        <component
          :is="editor.controls.Pending"
          :records="state.pendingRecords"
          :active-collection-id="state.activeCollectionId"
          :platform-names="state.platformNames"
          :segment-stats-by-track-id="state.segmentStatsByTrackId"
          @add-to-collection="editor.actions.addPendingMaterial"
          @remove="editor.actions.removePendingMaterial"
        />
      </aside>
      <StudioMaterialBrowser :editor="editor" />
    </div>
  </div>
</template>
