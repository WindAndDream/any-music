<script setup lang="ts">
import type { MusicCreationPresentation } from '@any-music/ui/theme'
import { computed } from 'vue'
const props = defineProps<{ editor: MusicCreationPresentation }>()
const state = computed(() => props.editor.state)
const actions = computed(() => props.editor.actions)
</script>

<template>
  <section class="composer" aria-label="素材合集与自定义音乐创作">
    <button type="button" @click="actions.clearData">清空创作数据（保留已发布作品）</button>
    <component
      :is="editor.controls.Collections"
      :collections="state.materialCollections"
      :active-collection-id="state.activeCollectionId"
      @select="actions.selectCollection"
      @create="actions.createCollection($event)"
      @delete="
        (collectionId, deleteMaterialRecords) =>
          actions.deleteCollection(collectionId, deleteMaterialRecords)
      "
    />

    <div class="composer__workflow" aria-label="片段创作步骤">
      <span><b>1</b> 点击截取，进入待整理</span>
      <span><b>2</b> 选择合集并归档素材</span>
      <span><b>3</b> 设置范围，加入时间线</span>
      <span><b>4</b> 试听、下载或保存作品</span>
    </div>

    <component
      :is="editor.controls.Pending"
      :records="state.pendingRecords"
      :active-collection-id="state.activeCollectionId"
      :platform-names="state.platformNames"
      :segment-stats-by-track-id="state.segmentStatsByTrackId"
      @add-to-collection="actions.addPendingMaterial"
      @remove="actions.removePendingMaterial($event)"
    />

    <p v-if="state.materialCollections.length === 0" class="composer__empty">
      先创建一个素材合集，再从资料库加入普通音乐或已有自定义音乐。
    </p>

    <template v-else>
      <component
        :is="editor.controls.Filter"
        :model-value="state.filters"
        @update:model-value="actions.setFilters"
        :platforms="state.platformOptions"
        :tag-stats="state.tagStats"
      />

      <div class="composer__workspace">
        <section class="material-browser" aria-label="可用音乐素材">
          <header class="material-browser__header">
            <div>
              <strong>{{ state.activeCollection?.name ?? '未选择合集' }}</strong>
              <small>
                显示 {{ state.visibleRecords.length }} / 资料库
                {{ state.records.length }} 首，合集内
                {{ state.activeCollection?.trackIds.length ?? 0 }} 首
              </small>
            </div>
          </header>
          <p v-if="state.visibleRecords.length === 0" class="composer__empty">
            没有匹配的音乐素材。
          </p>
          <div v-else class="material-browser__items">
            <component
              :is="editor.controls.Material"
              v-for="record in state.visibleRecords"
              :key="record.track.id"
              :record="record"
              :platform-name="
                state.platformNames.get(record.track.source.pluginId) ??
                record.track.source.pluginId
              "
              :included="state.collectionTrackIds.has(record.track.id)"
              :segment-count="state.segmentStatsByTrackId.get(record.track.id)?.segmentCount ?? 0"
              :clipped-duration-ms="
                state.segmentStatsByTrackId.get(record.track.id)?.totalDurationMs ?? 0
              "
              :export-busy="state.exportBusy"
              @add-material="actions.addMaterial"
              @remove-material="actions.removeMaterial"
              @add-segment="actions.addSegment"
              @preview="actions.preview($event)"
              @download="actions.downloadSegment"
            />
          </div>
        </section>

        <div class="composer__timeline-column">
          <div class="composer__project">
            <label>
              自定义歌曲名称
              <input
                :value="state.title"
                @input="actions.setTitle(($event.target as HTMLInputElement).value)"
                maxlength="80"
                placeholder="例如：夜行片段混剪"
              />
            </label>
            <label>
              导出格式
              <select
                :value="state.exportFormat"
                @change="
                  actions.setExportFormat(
                    ($event.target as HTMLSelectElement).value as 'mp3' | 'wav',
                  )
                "
              >
                <option value="mp3">MP3 · 192 kbps</option>
                <option value="wav">WAV · PCM 16-bit</option>
              </select>
            </label>
            <span>成品时长 {{ actions.formatDuration(state.virtualDurationMs) }}</span>
          </div>

          <component
            :is="editor.controls.Timeline"
            :segments="state.recipe"
            :track-titles="state.trackTitles"
            :export-busy="state.exportBusy"
            @move="actions.moveSegment"
            @remove="actions.removeSegment"
            @preview="actions.preview($event)"
            @download="actions.downloadSegment"
          />

          <p v-if="state.localError || state.errorMessage" class="composer__error">
            {{ state.localError || state.errorMessage }}
          </p>
          <p v-if="state.exportMessage" class="composer__export-status">
            {{ state.exportMessage }}
          </p>
          <div class="composer__final-actions">
            <button
              type="button"
              :disabled="state.recipe.length === 0 || state.exportBusy"
              @click="actions.downloadDraft"
            >
              下载当前成品
            </button>
            <button
              class="composer__save"
              type="button"
              :disabled="state.exportBusy"
              @click="actions.submit"
            >
              保存为自定义歌曲
            </button>
          </div>
        </div>
      </div>
    </template>
  </section>
</template>
