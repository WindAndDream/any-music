<script setup lang="ts">
import { cloneCatalogTrackFilterState } from '@any-music/ui/catalog'
import type { CatalogTrackFilterState } from '@any-music/ui/catalog'
import AppIcon from '@any-music/ui/components/AppIcon.vue'
import BottomSheet from '@any-music/ui/components/BottomSheet.vue'
import SidePanel from '@any-music/ui/components/SidePanel.vue'
import type { UiThemeFeatureMap } from '@any-music/ui/theme'
import { computed, shallowRef, useTemplateRef } from 'vue'

import { useClassicHistory } from '../../composables/use-classic-history'
import { useClassicOverlays } from '../../composables/use-classic-overlays'
import CatalogDisplayModeDialog from '../music-sources/CatalogDisplayModeDialog.vue'
import CatalogPlaylistPickerDialog from '../music-sources/CatalogPlaylistPickerDialog.vue'
import CatalogTrackFilterPanel from '../music-sources/CatalogTrackFilterPanel.vue'
import CatalogTrackOperatorPanel from '../music-sources/CatalogTrackOperatorPanel.vue'
import ClassicPageOverlays from '../overlays/ClassicPageOverlays.vue'
import ClassicCollectionControls from './ClassicCollectionControls.vue'
import ClassicFeatureStatus from './ClassicFeatureStatus.vue'
import ClassicFilterFooter from './ClassicFilterFooter.vue'
import ClassicHistoryContent from './ClassicHistoryContent.vue'
import HistoryTrackActionsDialog from './HistoryTrackActionsDialog.vue'

const props = defineProps<{ feature: UiThemeFeatureMap['history'] }>()
const presentation = useClassicHistory(props, useTemplateRef<HTMLElement>('scrollElement'))
const {
  history,
  state,
  displayOpen,
  contentDisplayOpen,
  playlistOpen,
  actionRow,
  actionEntryId,
  selectedTrackIds,
  compactControls,
} = presentation
const overlays = useClassicOverlays(() => false)
const detailOpen = shallowRef(false)
const previewFilters = shallowRef<CatalogTrackFilterState | null>(null)
const draft = computed({
  get: () => cloneCatalogTrackFilterState(history.draft.value ?? history.filters.value),
  set: (value: CatalogTrackFilterState) => {
    history.draft.value = value
  },
})
const preview = computed(() =>
  history
    .filterRows(previewFilters.value ?? draft.value)
    .filter(
      ({ track }) =>
        history.activePlatform.value === null ||
        track.source.pluginId === history.activePlatform.value,
    ),
)
const filterPlatformStats = computed(() =>
  presentation.groups.value.map(({ id, name, totalCount }) => ({ id, name, count: totalCount })),
)
const selectedTracks = computed(() =>
  selectedTrackIds.value.flatMap((id) => state.value.tracks.find((track) => track.id === id) ?? []),
)
const allFavorited = computed(
  () =>
    selectedTrackIds.value.length > 0 &&
    selectedTrackIds.value.every((id) => state.value.favoriteTrackIds.includes(id)),
)
const allQueued = computed(
  () =>
    selectedTrackIds.value.length > 0 &&
    selectedTrackIds.value.every((id) => state.value.queuedTrackIds.includes(id)),
)
function openFilters() {
  history.draft.value = cloneCatalogTrackFilterState(history.filters.value)
  previewFilters.value = null
}
</script>

<template>
  <section
    ref="scrollElement"
    class="listen-queue history-collection"
    tabindex="-1"
    aria-label="播放历史"
  >
    <ClassicFeatureStatus :availability="feature.availability" :status="feature.status" />
    <fieldset class="listen-queue__fields" :disabled="feature.availability.status !== 'available'">
      <div class="listen-queue__content">
        <Transition
          :name="`queue-view-${presentation.navigation.direction.value}`"
          @before-leave="presentation.deactivateLeavingView"
          @before-enter="presentation.activateView"
          @after-enter="presentation.finishViewTransition"
          @leave-cancelled="presentation.activateView"
        >
          <ClassicHistoryContent
            :key="presentation.navigation.viewKey.value"
            :data-collection-view="presentation.navigation.viewKey.value"
            :feature="feature"
            :presentation="presentation"
            :overlay-target="overlays?.modalTarget.value ?? null"
          />
        </Transition>
      </div>
      <ClassicPageOverlays
        :modal-open="presentation.modalOpen.value"
        :operator-open="history.operatorOpen.value"
      >
        <template #toolbar>
          <ClassicCollectionControls
            :selected-count="history.selected.value.length"
            :total-count="history.visible.value.length"
            :disabled="!presentation.available()"
            :operator-open="history.operatorOpen.value"
            can-display
            :icon-only-display="compactControls"
            filter-label="筛选播放记录"
            @filter="openFilters"
            @operator="history.operatorOpen.value = !history.operatorOpen.value"
            @display="displayOpen = true"
          />
        </template>
        <CatalogDisplayModeDialog
          :item-style="state.itemStyle"
          @update-item-style="feature.actions.setItemStyle?.($event)"
          :open="displayOpen"
          :display-mode="history.displayMode.value"
          :mobile-columns="history.mobileColumns.value"
          :suspended="!presentation.available()"
          @close="displayOpen = false"
          @update-display-mode="history.displayMode.value = $event"
          @update-mobile-columns="history.mobileColumns.value = $event"
        />
        <BottomSheet
          :open="history.draft.value !== null"
          title="播放历史筛选器"
          size="full"
          @close="history.draft.value = null"
        >
          <CatalogTrackFilterPanel
            v-if="history.draft.value !== null"
            v-model:filters="draft"
            filter-context="favorites"
            history-records
            :tag-stats="history.tagStats.value"
            :platform-scoped="history.activePlatform.value !== null"
            :platform-stats="filterPlatformStats"
            :result-count="preview.length"
            :total-count="history.scopedRows.value.length"
            history-scope="history:tracks"
            @detail-open-change="detailOpen = $event"
            @preview-change="previewFilters = $event"
          />
          <template v-if="!detailOpen" #footer>
            <ClassicFilterFooter
              :summary="`匹配 ${preview.length} / ${history.scopedRows.value.length} 条`"
              @cancel="history.draft.value = null"
              @apply="history.applyFilters()"
            />
          </template>
        </BottomSheet>
        <HistoryTrackActionsDialog
          :row="actionRow"
          :feature="feature"
          @close="actionEntryId = null"
          @play="presentation.play"
          @clear="presentation.clear"
        />
        <CatalogPlaylistPickerDialog
          :open="playlistOpen"
          :playlists="state.playlists ?? []"
          :selected-count="selectedTrackIds.length"
          :suspended="!presentation.available()"
          @close="playlistOpen = false"
          @select="presentation.addToPlaylist"
        />
        <template #operator>
          <SidePanel
            :open="history.operatorOpen.value"
            title="播放历史操作器"
            stacked-actions
            :suspended="
              !presentation.available() ||
              history.draft.value !== null ||
              displayOpen ||
              contentDisplayOpen ||
              Boolean(actionRow) ||
              playlistOpen
            "
            @close="history.operatorOpen.value = false"
          >
            <CatalogTrackOperatorPanel
              :selected-tracks="selectedTracks"
              :selected-count="history.selected.value.length"
              :visible-count="history.visible.value.length"
              count-unit="条"
              :are-all-visible-selected="history.allSelected.value"
              :are-some-visible-selected="
                history.selected.value.length > 0 && !history.allSelected.value
              "
              :are-all-selected-favorited="allFavorited"
              :are-all-selected-queued="allQueued"
              can-add-to-playlist
              :download-busy="Boolean(state.downloadBusy)"
              @toggle-all-visible="history.toggleAll"
              @add-to-playlist="playlistOpen = true"
              @add-selected-to-queue="feature.actions.enqueue(selectedTrackIds)"
              @download-selected="feature.actions.download(selectedTrackIds)"
              @add-selected-to-favorites="presentation.favoriteSelected"
            >
              <template #extensions>
                <button
                  type="button"
                  aria-label="播放已选"
                  :disabled="!selectedTrackIds.length"
                  @click="presentation.playSelected"
                >
                  <AppIcon name="play" :size="18" />播放已选
                </button>
                <button
                  class="catalog-actions__remove"
                  type="button"
                  aria-label="清空历史"
                  :disabled="!history.rows.value.length"
                  @click="presentation.clear"
                >
                  <AppIcon name="trash" :size="18" />清空历史
                </button>
              </template>
            </CatalogTrackOperatorPanel>
          </SidePanel>
        </template>
      </ClassicPageOverlays>
    </fieldset>
  </section>
</template>
