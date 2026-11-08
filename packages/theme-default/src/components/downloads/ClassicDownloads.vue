<script setup lang="ts">
import { cloneCatalogTrackFilterState } from '@any-music/ui/catalog'
import TrackCardGrid from '@any-music/ui/components/music-sources/TrackCardGrid.vue'
import SidePanel from '@any-music/ui/components/SidePanel.vue'
import { useCatalogSelectionOperator, useQueueReorder } from '@any-music/ui/library'
import type { UiThemeFeatureMap } from '@any-music/ui/theme'
import { computed, onDeactivated, shallowRef, useTemplateRef, watch } from 'vue'

import { useClassicCompactControls } from '../../composables/use-classic-compact-controls'
import { useClassicDownloads } from '../../composables/use-classic-downloads'
import ClassicCollectionControls from '../library/ClassicCollectionControls.vue'
import ClassicFeatureStatus from '../library/ClassicFeatureStatus.vue'
import ClassicTrackFilters from '../library/ClassicTrackFilters.vue'
import CatalogDisplayModeDialog from '../music-sources/CatalogDisplayModeDialog.vue'
import ClassicPageOverlays from '../overlays/ClassicPageOverlays.vue'
import DownloadCollectionContent from './DownloadCollectionContent.vue'
import DownloadOperatorPanel from './DownloadOperatorPanel.vue'
import DownloadTrackActionsDialog from './DownloadTrackActionsDialog.vue'
import DownloadTrackRow from './DownloadTrackRow.vue'

const props = defineProps<{ feature: UiThemeFeatureMap['downloads'] }>()
const {
  state,
  entries,
  visible,
  selected,
  selection,
  pausable,
  resumable,
  retryable,
  removable,
  allSelected,
  filters,
  statuses,
  counts,
  select,
  toggleAll,
  resume,
  remove,
} = useClassicDownloads(props)
const actionItemId = shallowRef<string>()
const actionEntry = computed(() => entries.value.find(({ item }) => item.id === actionItemId.value))
const operatorOpen = shallowRef(false)
const displayOpen = shallowRef(false)
const scrollElement = useTemplateRef<HTMLElement>('scrollElement')
const compactControls = useClassicCompactControls(scrollElement, () => state.value.mobileLayout)
const reorder = useQueueReorder({
  arrangementMode: 'flat',
  trackIds: () => visible.value.map(({ item }) => item.id),
  platformIds: [],
  scrollElement,
  getPlatformId: () => undefined,
  moveTrack: (id, target, ids) => {
    if (props.feature.availability.status === 'available')
      props.feature.actions.moveItem(id, target, ids)
  },
  movePlatform: () => {},
})
// Scalar getters avoid shallowRef's forced multi-source notifications when the host
// republishes an otherwise unchanged projection after committing this drag.
watch(
  [
    () => operatorOpen.value,
    () => displayOpen.value,
    () => actionItemId.value,
    () => state.value.filterDraft,
    () => state.value.displayMode,
    () => state.value.mobileColumns,
    () => state.value.statusFilter,
    () => props.feature.availability.status,
  ],
  reorder.clearDrag,
)
onDeactivated(reorder.clearDrag)
useCatalogSelectionOperator({
  context: 'downloads',
  open: operatorOpen,
  clearSelection: () => props.feature.actions.select([]),
})
function toggleAllSelection(): void {
  toggleAll()
}
</script>

<template>
  <section ref="scrollElement" class="download-collection" aria-label="下载任务">
    <ClassicFeatureStatus :availability="feature.availability" :status="feature.status" />
    <fieldset
      class="download-collection__fields"
      :disabled="feature.availability.status !== 'available'"
    >
      <DownloadCollectionContent
        :concurrency="state.concurrency"
        :mobile-layout="state.mobileLayout"
        hide-display
        :status="state.statusFilter"
        :counts="counts"
        :statuses="statuses"
        :empty="!visible.length"
        @status="feature.actions.setStatusFilter"
        @display="displayOpen = true"
      >
        <TrackCardGrid :display-mode="state.displayMode" :mobile-columns="state.mobileColumns">
          <DownloadTrackRow
            :selectable="operatorOpen"
            v-for="entry in visible"
            :key="entry.item.id"
            :entry="entry"
            :custom-tags="state.customTagsByTrackId.get(entry.item.track.id)"
            :selected="selected.has(entry.item.id)"
            :context-label="
              state.platformNames.get(entry.item.track.source.pluginId) ??
              entry.item.track.source.pluginId
            "
            :display-mode="state.displayMode"
            :favorite="state.favoriteTrackIds.includes(entry.item.track.id)"
            :active="state.currentTrackId === entry.item.track.id"
            :invalid="state.invalidTrackIds.includes(entry.item.track.id)"
            reorderable
            :dragging="reorder.draggedId.value === entry.item.id"
            :get-reorder-style="(id) => reorder.getItemStyle('track', id)"
            @drag-start="reorder.startTrackPress"
            @shift="(id, direction) => reorder.shift('track', id, direction)"
            @drag-cancel="reorder.clearDrag"
            @select="select"
            @pause="feature.actions.pause([$event])"
            @resume="resume"
            @play="feature.actions.play($event.id)"
            @favorite="feature.actions.toggleFavorite($event.id)"
            @show-actions="actionItemId = $event"
          />
        </TrackCardGrid>
      </DownloadCollectionContent>
      <ClassicTrackFilters
        :disabled="feature.availability.status !== 'available'"
        :state="filters"
        :actions="feature.actions"
        scope="downloads-root"
      />
      <ClassicPageOverlays
        :operator-open="operatorOpen"
        :modal-open="displayOpen || Boolean(actionEntry)"
      >
        <DownloadTrackActionsDialog
          :playlists="state.playlists"
          @add-to-playlist="(track, id) => feature.actions.addToPlaylist(id, [track.id])"
          :entry="actionEntry"
          :favorite="
            Boolean(actionEntry && state.favoriteTrackIds.includes(actionEntry.item.track.id))
          "
          :queued="Boolean(actionEntry && state.queuedTrackIds.includes(actionEntry.item.track.id))"
          :invalid="
            Boolean(actionEntry && state.invalidTrackIds.includes(actionEntry.item.track.id))
          "
          :custom-tags="
            actionEntry ? (state.customTagsByTrackId.get(actionEntry.item.track.id) ?? []) : []
          "
          :cancelling="false"
          :suspended="feature.availability.status !== 'available'"
          @close="actionItemId = undefined"
          @pause="feature.actions.pause([$event])"
          @resume="resume"
          @cancel="feature.actions.cancel([$event])"
          @remove="remove([$event])"
          @play="feature.actions.play($event.id)"
          @queue="feature.actions.toggleQueue?.($event.id)"
          @favorite="feature.actions.toggleFavorite($event.id)"
          @rename="(track, name) => feature.actions.rename(track.id, name)"
          @compose="feature.actions.useAsMaterial([$event.id])"
          @add-tag="(track, tag) => feature.actions.addTag([track.id], tag)"
          @remove-tag="(track, tag) => feature.actions.removeTag(track.id, tag)"
        />
        <CatalogDisplayModeDialog
          :item-style="state.itemStyle"
          @update-item-style="feature.actions.setItemStyle?.($event)"
          :open="displayOpen"
          :display-mode="state.displayMode"
          :mobile-columns="state.mobileColumns"
          @update-display-mode="feature.actions.setDisplayMode"
          @update-mobile-columns="feature.actions.setMobileColumns"
          @close="displayOpen = false"
        />
        <template #toolbar
          ><ClassicCollectionControls
            :selected-count="selection.length"
            :disabled="feature.availability.status !== 'available'"
            :total-count="visible.length"
            :operator-open="operatorOpen"
            can-display
            :icon-only-display="compactControls"
            @filter="feature.actions.setFilterDraft(cloneCatalogTrackFilterState(state.filters))"
            @operator="operatorOpen = !operatorOpen"
            @display="displayOpen = true"
        /></template>
        <template #operator>
          <SidePanel
            :open="operatorOpen"
            title="下载操作器"
            stacked-actions
            :suspended="
              feature.availability.status !== 'available' ||
              state.filterDraft !== null ||
              displayOpen ||
              Boolean(actionEntry)
            "
            @close="operatorOpen = false"
          >
            <DownloadOperatorPanel
              :selected-count="selection.length"
              :visible-count="visible.length"
              :all-selected="allSelected"
              :some-selected="!allSelected && visible.some(({ item }) => selected.has(item.id))"
              action-label="继续已选"
              :can-resume="Boolean(resumable.length)"
              :can-retry="Boolean(retryable.length)"
              :can-pause="Boolean(pausable.length)"
              :can-cancel="Boolean(pausable.length)"
              :can-remove="Boolean(removable.length)"
              @toggle-all="toggleAllSelection"
              @pause="feature.actions.pause(pausable)"
              @resume="feature.actions.resume(resumable)"
              @retry="feature.actions.retry(retryable)"
              @cancel="feature.actions.cancel(pausable)"
              @remove="remove"
            />
          </SidePanel>
        </template>
      </ClassicPageOverlays>
    </fieldset>
  </section>
</template>

<style scoped>
.download-collection {
  --am-catalog-page-padding: clamp(var(--am-space-4), 2.2cqi, var(--am-space-7));
  container: am-download-collection / inline-size;
  display: flex;
  flex: 1 0 auto;
  flex-direction: column;
  inline-size: 100%;
  min-block-size: 0;
  min-inline-size: 0;
  overflow-x: clip;
  padding: var(--am-catalog-page-padding);
  padding-block-end: max(var(--am-catalog-page-padding), var(--am-space-6));
  background: var(--am-color-background);
}
.download-collection__fields {
  display: flex;
  flex: 1 0 auto;
  flex-direction: column;
  min-inline-size: 0;
  margin: 0;
  padding: 0;
  border: 0;
}
</style>
