<script setup lang="ts">
import { cloneCatalogTrackFilterState } from '@any-music/ui/catalog'
import TrackCardGrid from '@any-music/ui/components/music-sources/TrackCardGrid.vue'
import {
  getDownloadEntryError,
  getDownloadListEntries,
  filterQueueTracks,
  useQueueReorder,
} from '@any-music/ui/library'
import type { UiThemeFeatureMap } from '@any-music/ui/theme'
import { computed, shallowRef, onDeactivated, useTemplateRef, watch } from 'vue'

import { useStudioActivity } from '../../composables/use-studio-activity'
import StudioDisplayControls from '../library/StudioDisplayControls.vue'
import StudioFilters from '../library/StudioFilters.vue'
import StudioStyledTrack from '../library/StudioStyledTrack.vue'
import StudioPageOverlays from '../overlays/StudioPageOverlays.vue'
import StudioTrackDialog from '../overlays/StudioTrackDialog.vue'
import StudioFeatureStatus from '../StudioFeatureStatus.vue'
const props = defineProps<{ feature: UiThemeFeatureMap['downloads'] }>()
const state = computed(() => props.feature.state)
const entries = computed(() => getDownloadListEntries(state.value.batches, state.value.itemOrder))
const actionItemId = shallowRef<string>()
const actionEntry = computed(() => entries.value.find(({ item }) => item.id === actionItemId.value))
const filtered = computed(
  () =>
    new Set(
      filterQueueTracks(
        entries.value.map((entry) => entry.item.track),
        state.value.filters,
        state.value.addedAtMsByTrackId,
        state.value.customNamesByTrackId,
        state.value.customTagsByTrackId,
      ).map((track) => track.id),
    ),
)
const visible = computed(() =>
  entries.value.filter(
    (entry) =>
      filtered.value.has(entry.item.track.id) &&
      (state.value.statusFilter === 'all' || entry.state === state.value.statusFilter),
  ),
)
const selected = computed(() =>
  entries.value.filter((entry) => state.value.selectedItemIds.includes(entry.item.id)),
)
const pausable = computed(() =>
  selected.value
    .filter((entry) => entry.state === 'downloading' && !entry.saving)
    .map((entry) => entry.item.id),
)
const resumable = computed(() =>
  selected.value
    .filter(
      (entry) =>
        entry.state === 'paused' && !state.value.invalidTrackIds.includes(entry.item.track.id),
    )
    .map((entry) => entry.item.id),
)
const retryable = computed(() =>
  selected.value
    .filter(
      (entry) =>
        ['failed', 'succeeded'].includes(entry.state) &&
        !entry.saving &&
        !state.value.invalidTrackIds.includes(entry.item.track.id),
    )
    .map((entry) => entry.item.id),
)
const removable = computed(() =>
  selected.value
    .filter((entry) => entry.state !== 'downloading' && !entry.saving)
    .map((entry) => entry.item.id),
)
const allSelected = computed(
  () =>
    visible.value.length > 0 &&
    visible.value.every((entry) => state.value.selectedItemIds.includes(entry.item.id)),
)
const statuses = [
  ['all', '全部'],
  ['downloading', '下载中'],
  ['paused', '已暂停'],
  ['succeeded', '已下载'],
  ['failed', '下载失败'],
] as const
const { available, confirmAction } = useStudioActivity(() => props.feature.availability)
const element = useTemplateRef<HTMLElement>('element')
const reorder = useQueueReorder({
  arrangementMode: 'flat',
  trackIds: () => visible.value.map(({ item }) => item.id),
  platformIds: [],
  scrollElement: element,
  getPlatformId: () => undefined,
  moveTrack: (id, target, ids) => {
    if (available()) props.feature.actions.moveItem(id, target, ids)
  },
  movePlatform: () => {},
})
watch(
  [
    () => state.value.statusFilter,
    () => state.value.filterDraft,
    () => state.value.displayMode,
    () => state.value.mobileColumns,
    () => props.feature.availability.status,
  ],
  reorder.clearDrag,
)
onDeactivated(reorder.clearDrag)
function toggle(id: string) {
  if (available())
    props.feature.actions.select(
      state.value.selectedItemIds.includes(id)
        ? state.value.selectedItemIds.filter((value) => value !== id)
        : [...state.value.selectedItemIds, id],
    )
}
function toggleAll() {
  if (!available()) return
  const ids = new Set(state.value.selectedItemIds)
  for (const entry of visible.value) {
    if (allSelected.value) ids.delete(entry.item.id)
    else ids.add(entry.item.id)
  }
  props.feature.actions.select([...ids])
}
function remove() {
  const ids = [...removable.value]
  if (ids.length)
    void confirmAction('移除下载记录', '已保存的文件会保留。确定移除已选记录？', () =>
      props.feature.actions.remove(ids),
    )
}
</script>
<template>
  <section ref="element" class="studio-library" aria-label="下载任务">
    <h1>
      下载 <small>{{ state.concurrency }} 并发</small>
    </h1>
    <StudioFeatureStatus :availability="feature.availability" :status="feature.status" />
    <fieldset :disabled="feature.availability.status !== 'available'">
      <div class="studio-actions">
        <button
          v-for="[id, title] in statuses"
          :key="id"
          type="button"
          :aria-pressed="state.statusFilter === id"
          @click="feature.actions.setStatusFilter(id)"
        >
          {{ title }}</button
        ><label
          ><input type="checkbox" :checked="allSelected" @change="toggleAll" />全选匹配任务</label
        ><span>已选 {{ selected.length }}</span
        ><StudioDisplayControls
          :state="state"
          :actions="feature.actions"
          :disabled="feature.availability.status !== 'available'"
        /><button
          type="button"
          @click="feature.actions.setFilterDraft(cloneCatalogTrackFilterState(state.filters))"
        >
          筛选歌曲</button
        ><button
          type="button"
          :disabled="!pausable.length"
          @click="feature.actions.pause(pausable)"
        >
          暂停已选</button
        ><button
          type="button"
          :disabled="!resumable.length"
          @click="feature.actions.resume(resumable)"
        >
          继续已选</button
        ><button
          type="button"
          :disabled="!pausable.length"
          @click="feature.actions.cancel(pausable)"
        >
          取消已选</button
        ><button
          type="button"
          :disabled="!retryable.length"
          @click="feature.actions.retry(retryable)"
        >
          重试已选</button
        ><button type="button" :disabled="!removable.length" @click="remove">移除已选</button>
      </div>
      <p v-if="!visible.length">当前没有匹配的下载任务。</p>
      <TrackCardGrid
        v-if="state.itemStyle && state.itemStyle !== 'default'"
        :display-mode="state.displayMode"
        :mobile-columns="state.mobileColumns"
      >
        <div
          v-for="entry in visible"
          :key="entry.item.id"
          class="studio-download-slot studio-minimal-cell"
          :class="{ 'studio-download--dragging': reorder.draggedId.value === entry.item.id }"
          data-queue-drop-kind="track"
          :data-queue-drop-id="entry.item.id"
          :style="reorder.getItemStyle('track', entry.item.id)"
        >
          <StudioStyledTrack
            :item-style="state.itemStyle"
            reorderable
            @cover-press="reorder.startTrackPress($event, entry.item.id)"
            @shift="reorder.shift('track', entry.item.id, $event)"
            @cancel-drag="reorder.clearDrag"
            :track="entry.item.track"
            :custom-tags="state.customTagsByTrackId.get(entry.item.track.id)"
            :title="state.customNamesByTrackId.get(entry.item.track.id) ?? entry.item.track.title"
            :invalid="state.invalidTrackIds.includes(entry.item.track.id)"
            :selected="state.selectedItemIds.includes(entry.item.id)"
            selectable
            :detail="statuses.find(([id]) => id === entry.state)?.[1]"
            @play="feature.actions.play(entry.item.track.id)"
            @select="toggle(entry.item.id)"
            @actions="actionItemId = entry.item.id"
          />
        </div>
      </TrackCardGrid>
      <div v-else class="studio-downloads">
        <article
          v-for="entry in visible"
          :key="entry.item.id"
          class="studio-download-slot"
          data-queue-drop-kind="track"
          :data-queue-drop-id="entry.item.id"
        >
          <div
            class="studio-download"
            :class="{ 'studio-download--dragging': reorder.draggedId.value === entry.item.id }"
            :style="reorder.getItemStyle('track', entry.item.id)"
          >
            <button
              class="studio-download__handle"
              type="button"
              data-queue-handle
              :aria-label="`长按拖动下载歌曲 ${entry.item.track.title}；方向键调整顺序`"
              @pointerdown.stop="reorder.startTrackPress($event, entry.item.id)"
              @contextmenu.prevent
              @dragstart.prevent
              @keydown.up.prevent="reorder.shift('track', entry.item.id, -1)"
              @keydown.down.prevent="reorder.shift('track', entry.item.id, 1)"
              @keydown.esc.stop="reorder.clearDrag"
            >
              排序
            </button>
            <label
              ><input
                type="checkbox"
                :aria-label="`选择下载任务 ${entry.item.id}`"
                :checked="state.selectedItemIds.includes(entry.item.id)"
                @change="toggle(entry.item.id)"
              />{{
                state.customNamesByTrackId.get(entry.item.track.id) ?? entry.item.track.title
              }}</label
            >
            <p>
              {{ statuses.find(([id]) => id === entry.state)?.[1] }}
              {{ entry.saving ? '正在保存…' : '' }}
            </p>
            <p role="status">{{ entry.item.progressMessage }}</p>
            <progress v-if="entry.state === 'downloading'" aria-label="下载进度" />
            <p v-if="getDownloadEntryError(entry)" role="alert">
              {{ getDownloadEntryError(entry) }}
            </p>
            <div class="studio-actions">
              <button
                type="button"
                :disabled="state.invalidTrackIds.includes(entry.item.track.id)"
                @click="feature.actions.play(entry.item.track.id)"
              >
                播放</button
              ><button type="button" @click="feature.actions.toggleFavorite(entry.item.track.id)">
                喜欢</button
              ><button type="button" @click="feature.actions.showTrackActions(entry.item.track.id)">
                歌曲操作</button
              ><button
                v-if="entry.state === 'downloading'"
                type="button"
                :disabled="entry.saving"
                @click="feature.actions.pause([entry.item.id])"
              >
                暂停</button
              ><button
                v-if="entry.state === 'paused'"
                type="button"
                :disabled="state.invalidTrackIds.includes(entry.item.track.id)"
                @click="feature.actions.resume([entry.item.id])"
              >
                继续</button
              ><button
                v-if="entry.state === 'failed' || entry.state === 'succeeded'"
                type="button"
                :disabled="entry.saving || state.invalidTrackIds.includes(entry.item.track.id)"
                @click="feature.actions.retry([entry.item.id])"
              >
                重试下载
              </button>
            </div>
          </div>
        </article>
      </div>
      <StudioFilters :state="state" :actions="feature.actions" scope="downloads:tracks" />
    </fieldset>
    <StudioPageOverlays :open="Boolean(actionEntry)"
      ><StudioTrackDialog
        v-if="actionEntry"
        :track-id="actionEntry.item.track.id"
        :state="state"
        :actions="feature.actions"
        :availability="feature.availability"
        queue-action="toggle"
        @queue="feature.actions.toggleQueue?.($event)"
        @close="actionItemId = undefined"
      >
        <template #details>
          <p role="status">
            {{ statuses.find(([id]) => id === actionEntry?.state)?.[1] }} ·
            {{ actionEntry.item.progressMessage }}
          </p>
          <p v-if="getDownloadEntryError(actionEntry)" role="alert">
            {{ getDownloadEntryError(actionEntry) }}
          </p>
          <div class="studio-actions">
            <button
              v-if="actionEntry.state === 'downloading'"
              type="button"
              :disabled="actionEntry.saving"
              @click="feature.actions.pause([actionEntry.item.id])"
            >
              暂停下载
            </button>
            <button
              v-if="actionEntry.state === 'paused'"
              type="button"
              :disabled="state.invalidTrackIds.includes(actionEntry.item.track.id)"
              @click="feature.actions.resume([actionEntry.item.id])"
            >
              继续下载
            </button>
            <button
              v-if="actionEntry.state === 'failed' || actionEntry.state === 'succeeded'"
              type="button"
              :disabled="
                actionEntry.saving || state.invalidTrackIds.includes(actionEntry.item.track.id)
              "
              @click="feature.actions.retry([actionEntry.item.id])"
            >
              重试下载
            </button>
            <button
              v-if="actionEntry.state === 'downloading' || actionEntry.state === 'paused'"
              type="button"
              :disabled="actionEntry.saving"
              @click="feature.actions.cancel([actionEntry.item.id])"
            >
              取消下载
            </button>
          </div>
        </template>
      </StudioTrackDialog></StudioPageOverlays
    >
  </section>
</template>

<style scoped>
.studio-minimal-cell {
  container: am-track-card / inline-size;
}
.studio-download-slot {
  position: relative;
  min-inline-size: 0;
}
.studio-download {
  transition: transform var(--am-motion-normal) var(--am-ease-emphasized);
}
.studio-download--dragging {
  position: relative;
  z-index: 2;
  transition: none;
  box-shadow: var(--am-shadow-card);
  outline: 1px solid var(--am-color-primary);
}
.studio-download__handle {
  min-inline-size: 44px;
  min-block-size: 44px;
  cursor: grab;
  user-select: none;
  -webkit-touch-callout: none;
}
@media (prefers-reduced-motion: reduce) {
  .studio-download {
    transition: none;
  }
}
</style>
