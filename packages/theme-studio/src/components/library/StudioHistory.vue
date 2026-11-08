<script setup lang="ts">
import { cloneCatalogTrackFilterState } from '@any-music/ui/catalog'
import type { CatalogTrackFilterState } from '@any-music/ui/catalog'
import TrackCardGrid from '@any-music/ui/components/music-sources/TrackCardGrid.vue'
import { useHistoryCollection, usePlaylistPickerOpen } from '@any-music/ui/library'
import type { UiThemeFeatureMap } from '@any-music/ui/theme'
import { computed, shallowRef } from 'vue'

import { useStudioActivity } from '../../composables/use-studio-activity'
import StudioPageOverlays from '../overlays/StudioPageOverlays.vue'
import StudioTrackDialog from '../overlays/StudioTrackDialog.vue'
import StudioFeatureStatus from '../StudioFeatureStatus.vue'
import StudioDisplayControls from './StudioDisplayControls.vue'
import StudioFilters from './StudioFilters.vue'
import StudioPlaylistPickerDialog from './StudioPlaylistPickerDialog.vue'
import StudioStyledTrack from './StudioStyledTrack.vue'

const props = defineProps<{ feature: UiThemeFeatureMap['history'] }>()
const state = computed(() => props.feature.state)
const history = useHistoryCollection({
  entries: () => state.value.entries,
  tracks: () => state.value.tracks,
  names: () => state.value.customNamesByTrackId,
  customTags: () => state.value.customTagsByTrackId,
})
const playlistOpen = usePlaylistPickerOpen(history.editing)
const actionEntryId = shallowRef<string | null>(null)
const actionRow = computed(() =>
  history.rows.value.find(({ entry }) => entry.id === actionEntryId.value),
)
const displayState = computed(() => ({
  displayMode: history.displayMode.value,
  mobileColumns: history.mobileColumns.value,
  itemStyle: state.value.itemStyle,
}))
const displayActions = {
  setDisplayMode: (value: typeof history.displayMode.value) => {
    history.displayMode.value = value
  },
  setMobileColumns: (value: typeof history.mobileColumns.value) => {
    history.mobileColumns.value = value
  },
  setItemStyle: (value: 'default' | 'minimal') => props.feature.actions.setItemStyle?.(value),
}
const { available, confirmAction } = useStudioActivity(() => props.feature.availability)
const filterState = computed(() => ({
  tracks: history.scopedRows.value.map(({ track }) => track),
  filterDraft: history.draft.value,
  filters: history.filters.value,
  platformNames: state.value.platformNames,
  customTagsByTrackId: state.value.customTagsByTrackId,
}))
const filterActions = {
  setFilterDraft: (draft: CatalogTrackFilterState | null) => {
    history.draft.value = draft
  },
  applyFilters: history.applyFilters,
  cancelFilters: () => {
    history.draft.value = null
  },
}
const groups = computed(() =>
  [...new Set(history.filtered.value.map(({ track }) => track.source.pluginId))].map((id) => ({
    id,
    name: state.value.platformNames.get(id) ?? id,
    count: history.filtered.value.filter(({ track }) => track.source.pluginId === id).length,
    selected: history.filtered.value.filter(
      ({ entry, track }) =>
        track.source.pluginId === id && history.selectedIds.value.includes(entry.id),
    ).length,
  })),
)
function selectedIds() {
  return history.selected.value.map(({ track }) => track.id)
}
function playSelected() {
  const ids = selectedIds()
  if (ids[0]) void props.feature.actions.play(ids[0], ids)
}
function addToPlaylists(playlistIds: readonly string[]) {
  if (!playlistOpen.value || !available()) return
  const ids = [...new Set(selectedIds())].filter((id) => !state.value.invalidTrackIds.includes(id))
  if (!ids.length) return
  for (const id of new Set(playlistIds)) {
    if (state.value.playlists?.some((playlist) => playlist.id === id))
      props.feature.actions.addToPlaylist(id, ids)
  }
  playlistOpen.value = false
}
function clear() {
  void confirmAction(
    '清空播放历史',
    '清空后无法撤销，但不会删除收藏、歌单或下载记录。',
    props.feature.actions.clear,
  )
}
</script>
<template>
  <section class="studio-library" aria-label="播放历史">
    <header>
      <h1>播放历史</h1>
      <p>{{ history.rows.value.length }} 条播放记录</p>
    </header>
    <StudioFeatureStatus :availability="feature.availability" :status="feature.status" />
    <fieldset :disabled="feature.availability.status !== 'available'">
      <div class="studio-actions" role="group" aria-label="播放历史排列方式">
        <button
          type="button"
          :aria-pressed="history.arrangement.value === 'flat'"
          @click="history.setArrangement('flat')"
        >
          全部记录
        </button>
        <button
          type="button"
          :aria-pressed="history.arrangement.value === 'platform'"
          @click="history.setArrangement('platform')"
        >
          按平台
        </button>
        <StudioDisplayControls
          :state="displayState"
          :actions="displayActions"
          :disabled="feature.availability.status !== 'available'"
        />
        <button
          type="button"
          @click="history.draft.value = cloneCatalogTrackFilterState(history.filters.value)"
        >
          筛选器
        </button>
        <button
          type="button"
          :aria-expanded="history.operatorOpen.value"
          @click="history.operatorOpen.value = !history.operatorOpen.value"
        >
          操作器
        </button>
      </div>
      <div
        v-if="history.operatorOpen.value"
        class="studio-actions"
        role="group"
        aria-label="播放历史操作器"
      >
        <label
          ><input
            type="checkbox"
            :checked="history.allSelected.value"
            :indeterminate="history.selected.value.length > 0 && !history.allSelected.value"
            :disabled="!history.visible.value.length"
            @change="history.toggleAll()"
          />全选</label
        >
        <span>已选 {{ history.selected.value.length }} 条</span>
        <button type="button" :disabled="!history.selected.value.length" @click="playSelected">
          播放已选
        </button>
        <button
          type="button"
          :disabled="!history.selected.value.length"
          @click="feature.actions.enqueue(selectedIds())"
        >
          加入待听
        </button>
        <button
          type="button"
          :disabled="!history.selected.value.length"
          @click="playlistOpen = true"
        >
          加入歌单
        </button>
        <button type="button" :disabled="!history.rows.value.length" @click="clear">
          清空历史
        </button>
      </div>
      <StudioFilters
        :platform-scoped="history.activePlatform.value !== null"
        :state="filterState"
        :actions="filterActions"
        scope="history:tracks"
        :editing="history.editing"
        context="favorites"
        history-records
      />
      <button
        v-if="history.activePlatform.value"
        type="button"
        @click="history.activePlatform.value = null"
      >
        返回平台
      </button>
      <p v-if="!history.filtered.value.length" role="status">
        {{ history.rows.value.length ? '没有匹配的播放记录。' : '暂无播放历史。' }}
      </p>
      <div
        v-else-if="history.arrangement.value === 'platform' && !history.activePlatform.value"
        class="studio-actions"
      >
        <div v-for="group in groups" :key="group.id" class="studio-history__platform">
          <button type="button" @click="history.activePlatform.value = group.id">
            {{ group.name }} · {{ group.count }} 条记录
          </button>
          <div class="studio-history__selection-slot">
            <label v-if="history.operatorOpen.value" class="studio-history__select">
              <input
                type="checkbox"
                :checked="group.selected === group.count"
                :indeterminate="group.selected > 0 && group.selected < group.count"
                :aria-label="`选择${group.name}的播放记录`"
                @change="history.togglePlatform(group.id)"
              />
            </label>
          </div>
        </div>
      </div>
      <TrackCardGrid
        v-else-if="state.itemStyle && state.itemStyle !== 'default'"
        :display-mode="history.displayMode.value"
        :mobile-columns="history.mobileColumns.value"
      >
        <div
          v-for="{ entry, track } in history.visible.value"
          :key="entry.id"
          class="studio-minimal-cell"
        >
          <StudioStyledTrack
            :item-style="state.itemStyle"
            :track="track"
            :custom-tags="state.customTagsByTrackId.get(track.id)"
            :title="state.customNamesByTrackId.get(track.id) ?? track.title"
            :invalid="state.invalidTrackIds.includes(track.id)"
            :selected="history.selectedIds.value.includes(entry.id)"
            :selectable="history.operatorOpen.value"
            :focus-id="entry.id"
            :selection-description="`${state.customNamesByTrackId.get(track.id) ?? track.title} 于 ${new Date(entry.startedAtMs).toLocaleString()} 的播放记录`"
            @select="history.select(entry.id)"
            @play="
              feature.actions.play(
                track.id,
                history.visible.value.map((row) => row.track.id),
              )
            "
            @actions="actionEntryId = entry.id"
          />
        </div>
      </TrackCardGrid>
      <div v-else class="studio-table-scroll">
        <table
          class="studio-track-table"
          :data-density="history.displayMode.value"
          :data-mobile-columns="history.mobileColumns.value"
        >
          <caption>
            {{
              history.visible.value.length
            }}
            条播放记录
          </caption>
          <thead>
            <tr>
              <th class="studio-history__selection-cell" scope="col">
                <span v-if="history.operatorOpen.value">选择</span>
              </th>
              <th scope="col">音乐 / 作者</th>
              <th scope="col">播放时间与进度</th>
              <th scope="col">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="{ entry, track } in history.visible.value" :key="entry.id">
              <td class="studio-history__selection-cell">
                <div class="studio-history__selection-slot">
                  <label v-if="history.operatorOpen.value" class="studio-history__select">
                    <input
                      type="checkbox"
                      :checked="history.selectedIds.value.includes(entry.id)"
                      :aria-label="`选择 ${state.customNamesByTrackId.get(track.id) ?? track.title} 于 ${new Date(entry.startedAtMs).toLocaleString()} 的播放记录`"
                      @change="history.select(entry.id)"
                    />
                  </label>
                </div>
              </td>
              <td>
                <strong>{{ state.customNamesByTrackId.get(track.id) ?? track.title }}</strong>
                <div>{{ track.artists.map((artist) => artist.name).join(' / ') }}</div>
              </td>
              <td>
                <time>{{ new Date(entry.startedAtMs).toLocaleString() }}</time>
                <span>{{
                  entry.completed
                    ? '已播完'
                    : entry.durationMs
                      ? `${Math.round(Math.min(100, (entry.positionMs / entry.durationMs) * 100))}%`
                      : `${Math.round(entry.positionMs / 1000)}s`
                }}</span>
              </td>
              <td>
                <button
                  type="button"
                  @click="
                    feature.actions.play(
                      track.id,
                      history.visible.value.map((row) => row.track.id),
                    )
                  "
                >
                  播放
                </button>
                <button type="button" @click="feature.actions.enqueue([track.id])">加入待听</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </fieldset>
    <StudioPageOverlays :open="Boolean(actionRow) || playlistOpen"
      ><StudioTrackDialog
        v-if="actionRow"
        :track-id="actionRow.track.id"
        :state="state"
        :actions="feature.actions"
        :availability="feature.availability"
        queue-action="toggle"
        @close="actionEntryId = null"
        @queue="feature.actions.toggleQueue($event)"
      >
        <template #details
          ><p>{{ new Date(actionRow.entry.startedAtMs).toLocaleString() }}</p></template
        >
      </StudioTrackDialog>
      <StudioPlaylistPickerDialog
        :open="playlistOpen"
        :playlists="state.playlists ?? []"
        :selected-count="selectedIds().length"
        :suspended="!available()"
        @close="playlistOpen = false"
        @select="addToPlaylists"
      />
    </StudioPageOverlays>
  </section>
</template>

<style scoped>
.studio-minimal-cell {
  container: am-track-card / inline-size;
  min-inline-size: 0;
}
.studio-history__platform {
  display: flex;
  align-items: center;
  gap: var(--am-space-2);
}
.studio-history__selection-cell {
  inline-size: 44px;
}
.studio-history__selection-slot {
  /* Keep the column and row geometry while the checkbox is absent. */
  display: grid;
  inline-size: 44px;
  block-size: 44px;
  flex: 0 0 44px;
  place-items: center;
}
.studio-history__select {
  display: grid;
  inline-size: 44px;
  block-size: 44px;
  place-items: center;
  cursor: pointer;
}
.studio-history__select input {
  inline-size: 20px;
  block-size: 20px;
  margin: 0;
}
</style>
