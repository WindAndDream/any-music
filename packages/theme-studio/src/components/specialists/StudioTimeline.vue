<script setup lang="ts">
import type { MusicCreationPresentation } from '@any-music/ui/theme'
import { computed } from 'vue'
const props = defineProps<{ editor: MusicCreationPresentation }>()
const state = computed(() => props.editor.state)
</script>
<template>
  <section class="studio-timeline" aria-label="作品时间线">
    <div class="studio-actions">
      <label class="studio-field"
        >自定义歌曲名称<input
          :value="state.title"
          maxlength="80"
          data-am-focus-key="composer:title"
          @input="editor.actions.setTitle(($event.target as HTMLInputElement).value)" /></label
      ><label
        >导出格式<select
          :value="state.exportFormat"
          @change="
            editor.actions.setExportFormat(
              ($event.target as HTMLSelectElement).value === 'wav' ? 'wav' : 'mp3',
            )
          "
        >
          <option value="mp3">MP3 · 192 kbps</option>
          <option value="wav">WAV · PCM 16-bit</option>
        </select></label
      ><span>成品时长 {{ editor.actions.formatDuration(state.virtualDurationMs) }}</span>
    </div>
    <component
      :is="editor.controls.Timeline"
      :segments="state.recipe"
      :track-titles="state.trackTitles"
      :export-busy="state.exportBusy"
      @move="editor.actions.moveSegment"
      @remove="editor.actions.removeSegment"
      @preview="editor.actions.preview"
      @download="editor.actions.downloadSegment"
    />
    <p v-if="state.localError || state.errorMessage" role="alert">
      {{ state.localError || state.errorMessage }}
    </p>
    <p v-if="state.exportMessage" role="status">{{ state.exportMessage }}</p>
    <div class="studio-actions">
      <button
        type="button"
        :disabled="!state.recipe.length || state.exportBusy"
        @click="editor.actions.downloadDraft"
      >
        下载当前成品</button
      ><button type="button" :disabled="state.exportBusy" @click="editor.actions.submit">
        保存为自定义歌曲
      </button>
    </div>
  </section>
</template>
