<script setup lang="ts">
import { cloneCatalogTrackFilterState } from '@any-music/ui/catalog'
import TrackCardGrid from '@any-music/ui/components/music-sources/TrackCardGrid.vue'
import SidePanel from '@any-music/ui/components/SidePanel.vue'
import { usePresentationContinuity } from '@any-music/ui/library'
import { computed, shallowRef, useTemplateRef, watch } from 'vue'

import { useClassicCollectionPresentation } from '../../composables/use-classic-collection-presentation'
import { useClassicOverlays } from '../../composables/use-classic-overlays'
import { useClassicTrackCollection } from '../../composables/use-classic-track-collection'
import type { ClassicTrackCollectionProps } from '../../composables/use-classic-track-collection'
import CatalogDisplayModeDialog from '../music-sources/CatalogDisplayModeDialog.vue'
import CatalogPlaylistPickerDialog from '../music-sources/CatalogPlaylistPickerDialog.vue'
import CatalogTrackOperatorPanel from '../music-sources/CatalogTrackOperatorPanel.vue'
import TrackRow from '../music-sources/TrackRow.vue'
import ClassicPageOverlays from '../overlays/ClassicPageOverlays.vue'
import ClassicCollectionContent from './ClassicCollectionContent.vue'
import ClassicCollectionControls from './ClassicCollectionControls.vue'
import ClassicFeatureStatus from './ClassicFeatureStatus.vue'
import ClassicTrackFilters from './ClassicTrackFilters.vue'

const props = defineProps<ClassicTrackCollectionProps>()
const displayOpen = shallowRef(false)
const contentDisplayOpen = shallowRef(false)
const scrollElement = useTemplateRef<HTMLElement>('scrollElement')
const presentation = useClassicCollectionPresentation(props, scrollElement)
const continuityRevision = computed(() => ({
  view: presentation.navigation.viewKey.value,
  filters: props.state.filters,
  // An empty-state transition must also cancel restoration waiting for a lazy grid.
  empty: presentation.displayedTracks.value.length === 0,
}))
usePresentationContinuity({
  element: scrollElement,
  region: presentation.continuityRegion,
  scrollElement: () =>
    scrollElement.value?.closest<HTMLElement>('.music-app-shell__content') ?? null,
  revision: continuityRevision,
  // Empty results render the existing empty state, so no lazy grid adapter will arrive.
  waitForDelegate: () =>
    Boolean(presentation.virtualGrid.value && presentation.displayedTracks.value.length),
  delegate: () => presentation.virtualAdapter.value?.continuity,
})
const overlays = useClassicOverlays(() => false)
defineSlots<{
  header?: () => unknown
  navigation?: () => unknown
  'collection-actions'?: (props: { compact: boolean }) => unknown
}>()
const {
  playlistOpen,
  operatorOpen,
  selection,
  selected,
  allSelected,
  select,
  toggleAll,
  move,
  download,
  play,
  downloadOne,
  favoriteSelected,
  addToPlaylist,
  removeSelected,
} = useClassicTrackCollection(props, () => presentation.displayedTracks.value)
watch([operatorOpen, displayOpen, contentDisplayOpen], presentation.reorder.clearDrag)
</script>

<template>
  <section
    ref="scrollElement"
    :class="collection ? 'listen-queue' : 'classic-library'"
    :tabindex="collection ? -1 : undefined"
    :aria-label="title"
  >
    <header v-if="!collection">
      <h2>
        {{ title }} <small>{{ state.tracks.length }} 首</small>
      </h2>
      <slot name="header" />
    </header>
    <ClassicFeatureStatus :availability="availability" :status="status" />
    <fieldset
      :class="{ 'listen-queue__fields': collection }"
      :disabled="availability.status !== 'available'"
    >
      <div v-if="collection" class="listen-queue__content">
        <Transition
          :name="`queue-view-${presentation.navigation.direction.value}`"
          @before-leave="presentation.deactivateLeavingView"
          @before-enter="presentation.activateView"
          @after-enter="
            (element) =>
              presentation.finishViewTransition(
                element,
                !contentDisplayOpen && !displayOpen && !playlistOpen,
              )
          "
          @leave-cancelled="presentation.activateView"
        >
          <ClassicCollectionContent
            :selectable="operatorOpen"
            :key="presentation.navigation.viewKey.value"
            :data-collection-view="presentation.navigation.viewKey.value"
            :data-queue-platform-view="presentation.navigation.activeId.value"
            :title="title"
            :favorites="scope === 'favorites:tracks'"
            :playlist="scope?.startsWith('playlist:')"
            :state="presentation.displayState.value"
            :mobile-layout="collection.state.mobileLayout"
            :total-count="collection.state.totalCount"
            :presentation="presentation"
            :overlay-target="overlays?.modalTarget.value ?? null"
            :suspended="availability.status !== 'available' || state.filterDraft !== null"
            @select="select"
            @play="play"
            @favorite="actions.toggleFavorite($event.id)"
            @download="downloadOne($event.id)"
            @show-actions="actions.showTrackActions"
            @display-mode="presentation.setDisplayMode"
            @mobile-columns="presentation.setMobileColumns"
            @modal-open="contentDisplayOpen = $event"
          >
            <template v-if="$slots.header" #header><slot name="header" /></template>
            <template v-if="$slots.navigation" #navigation><slot name="navigation" /></template>
          </ClassicCollectionContent>
        </Transition>
      </div>
      <p v-else-if="!state.tracks.length && status.status !== 'loading'">当前没有歌曲。</p>
      <TrackCardGrid
        v-if="!collection"
        :display-mode="state.displayMode"
        :mobile-columns="state.mobileColumns"
      >
        <div v-for="(track, index) in state.tracks" :key="track.id" class="list__cell">
          <TrackRow
            :selectable="operatorOpen"
            :track="track"
            :custom-tags="state.customTagsByTrackId.get(track.id)"
            :selected="selection.has(track.id)"
            :favorite="state.favoriteTrackIds.includes(track.id)"
            :invalid="state.invalidTrackIds.includes(track.id)"
            :active="track.id === currentTrackId"
            :download-busy="Boolean(state.downloadBusy)"
            :display-mode="state.displayMode"
            @select="select"
            @play="play($event.id)"
            @favorite="actions.toggleFavorite($event.id)"
            @download="downloadOne($event.id)"
            @show-actions="actions.showTrackActions($event.id)"
          />
          <div v-if="reorder" class="classic-library__order">
            <button
              type="button"
              :disabled="index === 0"
              :aria-label="`上移《${track.title}》`"
              @click="move(track.id, -1)"
            >
              上移
            </button>
            <button
              type="button"
              :disabled="index === state.tracks.length - 1"
              :aria-label="`下移《${track.title}》`"
              @click="move(track.id, 1)"
            >
              下移
            </button>
          </div>
        </div>
      </TrackCardGrid>
      <ClassicTrackFilters
        :platform-id="presentation.navigation.activeId.value"
        :disabled="availability.status !== 'available'"
        :state="state"
        :actions="actions"
        :scope="scope ?? `library-root:${title}`"
      />
      <ClassicPageOverlays
        :modal-open="playlistOpen || displayOpen || contentDisplayOpen"
        :operator-open="operatorOpen"
      >
        <template #toolbar>
          <ClassicCollectionControls
            :selected-count="selected.length"
            :disabled="availability.status !== 'available'"
            :total-count="presentation.displayedTracks.value.length"
            :operator-open="operatorOpen"
            can-display
            :icon-only-display="Boolean(collection) && presentation.compactControls.value"
            @filter="actions.setFilterDraft(cloneCatalogTrackFilterState(state.filters))"
            @operator="operatorOpen = !operatorOpen"
            @display="displayOpen = true"
          >
            <template #before-display>
              <slot
                v-if="$slots['collection-actions']"
                name="collection-actions"
                :compact="presentation.compactControls.value"
              />
            </template>
          </ClassicCollectionControls>
        </template>
        <CatalogDisplayModeDialog
          :item-style="state.itemStyle"
          @update-item-style="actions.setItemStyle?.($event)"
          :open="displayOpen"
          :display-mode="presentation.displayState.value.displayMode"
          :mobile-columns="presentation.displayState.value.mobileColumns"
          @update-display-mode="presentation.setDisplayMode"
          @update-mobile-columns="presentation.setMobileColumns"
          @close="displayOpen = false"
        />
        <CatalogPlaylistPickerDialog
          :open="playlistOpen"
          :playlists="state.playlists ?? []"
          :selected-count="selected.length"
          :suspended="availability.status !== 'available'"
          @close="playlistOpen = false"
          @select="addToPlaylist"
        />
        <template #operator>
          <SidePanel
            :open="operatorOpen"
            :title="title + '操作器'"
            stacked-actions
            :suspended="
              availability.status !== 'available' ||
              playlistOpen ||
              displayOpen ||
              contentDisplayOpen ||
              state.filterDraft !== null
            "
            @close="operatorOpen = false"
          >
            <CatalogTrackOperatorPanel
              :context="
                scope === 'favorites:tracks'
                  ? 'favorites'
                  : scope === 'queue:tracks'
                    ? 'queue'
                    : 'tracks'
              "
              :selected-tracks="
                presentation.displayedTracks.value.filter(({ id }) => selection.has(id))
              "
              :selected-count="selected.length"
              :visible-count="presentation.displayedTracks.value.length"
              :are-all-visible-selected="allSelected"
              :are-some-visible-selected="
                !allSelected &&
                presentation.displayedTracks.value.some(({ id }) => selection.has(id))
              "
              :are-all-selected-favorited="
                selected.length > 0 && selected.every((id) => state.favoriteTrackIds.includes(id))
              "
              :are-all-selected-queued="
                selected.length > 0 && selected.every((id) => state.queuedTrackIds.includes(id))
              "
              can-add-to-playlist
              :download-busy="Boolean(state.downloadBusy)"
              @toggle-all-visible="toggleAll"
              @add-selected-to-queue="actions.enqueue(selected)"
              @download-selected="download"
              @add-selected-to-favorites="favoriteSelected"
              @add-to-playlist="playlistOpen = true"
              @remove-selected="removeSelected"
            >
              <template #extensions>
                <button
                  v-if="remove && scope !== 'favorites:tracks' && scope !== 'queue:tracks'"
                  type="button"
                  :disabled="!selected.length"
                  @click="removeSelected"
                >
                  移除已选
                </button>
              </template>
            </CatalogTrackOperatorPanel>
          </SidePanel>
        </template>
      </ClassicPageOverlays>
    </fieldset>
  </section>
</template>
