<script setup lang="ts">
import {
  canRefreshCatalogDrawer,
  countCatalogTrackFilters,
  useCatalogViewportOverlay,
} from '@any-music/ui/catalog'
import AppDialog from '@any-music/ui/components/AppDialog.vue'
import AppIcon from '@any-music/ui/components/AppIcon.vue'
import SidePanel from '@any-music/ui/components/SidePanel.vue'
import type { UiThemeFeatureMap, UiThemeHostSlots } from '@any-music/ui/theme'
import { computed, shallowRef, useId, useTemplateRef, watch } from 'vue'

import ClassicCollectionControls from '../library/ClassicCollectionControls.vue'
import ClassicFilterFooter from '../library/ClassicFilterFooter.vue'
import ClassicPageOverlays from '../overlays/ClassicPageOverlays.vue'
import CatalogContextDetailsDialog from './CatalogContextDetailsDialog.vue'
import CatalogContextTitle from './CatalogContextTitle.vue'
import CatalogDisplayModeDialog from './CatalogDisplayModeDialog.vue'
import CatalogDrawerActionsDialog from './CatalogDrawerActionsDialog.vue'
import CatalogDrawerList from './CatalogDrawerList.vue'
import CatalogErrorDetails from './CatalogErrorDetails.vue'
import CatalogErrorNotice from './CatalogErrorNotice.vue'
import CatalogHeadingHandle from './CatalogHeadingHandle.vue'
import CatalogPlaylistPickerDialog from './CatalogPlaylistPickerDialog.vue'
import CatalogTrackActionsDialog from './CatalogTrackActionsDialog.vue'
import CatalogTrackFilterPanel from './CatalogTrackFilterPanel.vue'
import CatalogTrackOperatorPanel from './CatalogTrackOperatorPanel.vue'
import CollectionFilterSheet from './CollectionFilterSheet.vue'
import MusicSourcePickerButton from './MusicSourcePickerButton.vue'
import MusicSourcePickerDialog from './MusicSourcePickerDialog.vue'
import SourceToolbar from './SourceToolbar.vue'
import TrackList from './TrackList.vue'
import { useClassicCatalog } from './use-classic-catalog'
const props = defineProps<{ feature: UiThemeFeatureMap['catalog']; mobileLayout?: boolean }>()
const heading = useTemplateRef<HTMLElement>('heading')
const stage = useTemplateRef<HTMLElement>('stage')
const nativeReady = shallowRef(false)
const { openOverlay, registerOverlayOpener } = useCatalogViewportOverlay()
const headingCollapsed = shallowRef(false)
const headingContextId = useId()
defineSlots<UiThemeHostSlots>()
const {
  state,
  drawerListSummary,
  updateDrawerSummary,
  modalOpen,
  batchActions,
  discoveryOpen,
  sourcePickerOpen,
  listFilterOpen,
  operatorOpen,
  displayOpen,
  contextOpen,
  actionDrawerId,
  errorDrawerId,
  actionTrackId,
  playlistPickerOpen,
  filterPreview,
  filterDetailOpen,
  drawer,
  source,
  sources,
  actionDrawer,
  errorDrawer,
  actionTrack,
  invalidIds,
  favoriteIds,
  selectedIds,
  selectedTracks,
  draft,
  previewTracks,
  tagStats,
  allVisibleSelected,
  modalTarget,
  operatorTarget,
  toggleSelected,
  toggleAll,
  submit,
  openFilters,
  play,
  download,
  favoriteDrawer,
  restoreNames,
  viewLoadedTracks,
  closeError,
} = useClassicCatalog(props)
const viewportKey = computed(() => `${drawer.value?.id}:${drawer.value?.refreshRevision ?? 0}`)
const preparedViewport = shallowRef<string>()
const trackFilterCount = computed(() => countCatalogTrackFilters(state.value.filters).total)
const prepareViewport = computed(
  () =>
    drawer.value?.pluginId === 'douyin' &&
    drawer.value.isSourceEnabled &&
    !drawer.value.paginationLocked &&
    trackFilterCount.value === 0,
)
function showTrackActions(id: string): void {
  actionTrackId.value = id
}
const allDrawerFavorited = computed(
  () =>
    Boolean(drawer.value?.tracks.length) &&
    drawer.value!.tracks.every(({ id }) => favoriteIds.value.has(id)),
)
const viewTransition = shallowRef('catalog-forward')
let returnDrawerId = drawer.value?.id
let listScrollTop = 0
watch(
  () => drawer.value?.id,
  (id) => {
    if (id) returnDrawerId = id
    viewTransition.value = id ? 'catalog-forward' : 'catalog-back'
    headingCollapsed.value = false
  },
)
function deactivateView(element: Element): void {
  if (element.getAttribute('data-catalog-view') === 'lists') listScrollTop = element.scrollTop
  const root = element.getRootNode()
  const activeElement = root instanceof ShadowRoot ? root.activeElement : document.activeElement
  if (activeElement && element.contains(activeElement)) stage.value?.focus({ preventScroll: true })
  element.setAttribute('inert', '')
  element.setAttribute('aria-hidden', 'true')
}
function activateView(element: Element): void {
  element.removeAttribute('inert')
  element.removeAttribute('aria-hidden')
}
function restoreListScroll(element: Element): void {
  if (element.getAttribute('data-catalog-view') === 'lists') element.scrollTop = listScrollTop
}
function toggleDrawerPinned(id: string): void {
  // Closing the dialog clears actionDrawer before this event; resolve the saved list by ID.
  const target = props.feature.state.drawers.find((item) => item.id === id)
  if (target) props.feature.actions.pinDrawer(id, !target.isPinned)
}
function finishView(element: Element): void {
  if (
    modalOpen.value ||
    !element.isConnected ||
    element.hasAttribute('inert') ||
    element.getAttribute('data-catalog-view') !== (drawer.value?.id ?? 'lists')
  )
    return
  const target = drawer.value
    ? element.querySelector<HTMLElement>('.catalog-page__back')
    : [...element.querySelectorAll<HTMLElement>('[data-catalog-drawer-id]')].find(
        (card) => card.dataset.catalogDrawerId === returnDrawerId,
      )
  target?.focus({ preventScroll: true })
}
</script>

<template>
  <section class="classic-catalog" aria-label="音乐列表">
    <p v-if="feature.availability.status !== 'available'" role="status">
      {{ feature.availability.reason }}
    </p>
    <div ref="stage" class="classic-catalog__stage" tabindex="-1">
      <Transition
        :name="viewTransition"
        @before-leave="deactivateView"
        @before-enter="activateView"
        @enter="restoreListScroll"
        @leave-cancelled="activateView"
        @after-enter="finishView"
      >
        <div
          :key="drawer?.id ?? 'lists'"
          class="classic-catalog__view catalog-page"
          :class="drawer ? 'catalog-page--tracks' : 'catalog-page--lists'"
          :data-catalog-view="drawer?.id ?? 'lists'"
          :data-am-scroll-key="drawer ? undefined : 'workspace'"
        >
          <template v-if="drawer">
            <div class="catalog-page__sticky-header">
              <header
                ref="heading"
                class="catalog-page__heading"
                :class="{ 'catalog-page__heading--collapsed': headingCollapsed }"
                :data-mobile-layout="mobileLayout"
              >
                <button
                  class="catalog-page__back"
                  type="button"
                  aria-label="返回音乐列表"
                  @click="feature.actions.closeDrawer"
                >
                  <AppIcon name="arrow-left" :size="18" />
                  <span class="catalog-page__back-label">返回音乐列表</span>
                </button>
                <div
                  v-show="!headingCollapsed"
                  :id="headingContextId"
                  class="catalog-page__context"
                >
                  <button
                    v-if="mobileLayout"
                    class="catalog-page__context-title catalog-page__context-platform"
                    type="button"
                    aria-haspopup="dialog"
                    :aria-expanded="contextOpen"
                    aria-label="查看音乐列表完整信息"
                    @click="contextOpen = true"
                  >
                    {{ drawer.pluginName }}
                  </button>
                  <CatalogContextTitle
                    v-else
                    class="catalog-page__context-title"
                    :title="drawer.title"
                    :input="drawer.input"
                    :plugin-name="drawer.pluginName"
                    :expanded="contextOpen"
                    @show-details="contextOpen = true"
                  />
                  <span class="catalog-page__context-summary">
                    <template v-if="!mobileLayout">{{ drawer.pluginName }} · </template>
                    歌曲总数 {{ drawer.total ?? '未知' }} · 已加载 {{ drawer.tracks.length }} 首
                  </span>
                </div>
                <CatalogHeadingHandle
                  :collapsed="headingCollapsed"
                  :controls="headingContextId"
                  :drag-only="mobileLayout"
                  :gesture-target="heading"
                  @update-collapsed="headingCollapsed = $event"
                />
                <div class="catalog-page__actions">
                  <button
                    type="button"
                    :aria-label="
                      allDrawerFavorited
                        ? '已加载歌曲均已喜欢'
                        : `喜欢已加载的 ${drawer.tracks.length} 首歌曲`
                    "
                    :disabled="
                      !drawer.tracks.length ||
                      allDrawerFavorited ||
                      feature.availability.status !== 'available'
                    "
                    @click="favoriteDrawer(drawer.id)"
                  >
                    <AppIcon name="heart" :size="17" />
                    <span class="catalog-page__favorite-label">{{
                      allDrawerFavorited
                        ? '已加载歌曲均已喜欢'
                        : `喜欢已加载 ${drawer.tracks.length} 首`
                    }}</span>
                  </button>
                  <button
                    type="button"
                    aria-label="刷新"
                    :disabled="
                      !canRefreshCatalogDrawer(drawer) ||
                      feature.availability.status !== 'available'
                    "
                    @click="feature.actions.refresh(drawer.id)"
                  >
                    <AppIcon name="refresh" :size="17" /><span>刷新</span>
                  </button>
                </div>
              </header>
              <CatalogErrorNotice :drawer="drawer" @show-error="errorDrawerId = $event" />
            </div>
            <div
              :key="drawer.refreshRevision"
              class="catalog-page__tracks-scroll"
              data-am-scroll-key="workspace"
            >
              <slot
                v-if="!prepareViewport || preparedViewport === viewportKey"
                name="catalog-viewport"
                :drawer="drawer"
                :selectable="operatorOpen"
                :suspended="modalOpen"
                :set-ready="(ready) => (nativeReady = ready)"
                :register-overlay-opener="registerOverlayOpener"
                :show-track-actions="showTrackActions"
              />
              <div v-if="!nativeReady" class="catalog-drawer">
                <div class="catalog-drawer__panel">
                  <TrackList
                    :selectable="operatorOpen"
                    :key="drawer.id"
                    :listing-id="drawer.id"
                    :tracks="state.tracks"
                    :custom-tags-by-track-id="state.customTagsByTrackId"
                    :current-track-id="state.currentTrackId ?? undefined"
                    :invalid-track-ids="invalidIds"
                    :favorite-track-ids="favoriteIds"
                    :selected-track-ids="selectedIds"
                    :display-mode="state.displayMode"
                    :item-style="state.itemStyle"
                    :mobile-columns="state.mobileColumns"
                    :download-busy="Boolean(state.downloadBusy)"
                    :loading="drawer.isLoading || drawer.status === 'restoring'"
                    :has-more="drawer.hasMore && drawer.isSourceEnabled && !drawer.paginationLocked"
                    :loaded-page-count="drawer.loadedPageCount"
                    :loaded-track-count="drawer.tracks.length"
                    :prepare-viewport="prepareViewport"
                    :prefetch="drawer.pluginId === 'douyin'"
                    error-message=""
                    @viewport-ready="preparedViewport = viewportKey"
                    @load-more="!drawer.isLoading && feature.actions.loadMore(drawer.id)"
                    @select="toggleSelected"
                    @play="play"
                    @download="download([$event])"
                    @favorite="feature.actions.toggleFavorite($event.id)"
                    @show-actions="openOverlay(() => showTrackActions($event.id))"
                  />
                </div>
              </div>
            </div>
          </template>
          <CatalogDrawerList
            v-else
            :drawers="state.drawers"
            :invalid-track-ids="invalidIds"
            discovery-label="发现"
            discovery-in-header
            :filter-open="listFilterOpen"
            :operator-open="operatorOpen"
            :overlay-target="modalTarget"
            :operator-overlay-target="operatorTarget"
            @summary-change="updateDrawerSummary"
            @discover="
              feature.state.accountMissing
                ? feature.actions.notifyMissingAccount?.()
                : (discoveryOpen = true)
            "
            @view="feature.actions.openDrawer"
            @show-error="errorDrawerId = $event"
            @show-actions="actionDrawerId = $event"
            @remove-many="$event.forEach(feature.actions.removeDrawer)"
            @restore-names="feature.actions.restoreDrawerNames"
            @move="feature.actions.moveDrawer"
            @close-filter="listFilterOpen = false"
            @close-operator="operatorOpen = false"
          >
            <template v-if="mobileLayout && $slots['source-identity']" #session
              ><slot name="source-identity" :source-id="state.sourceId"
            /></template>
          </CatalogDrawerList>
        </div>
      </Transition>
    </div>
    <ClassicPageOverlays :modal-open="modalOpen" :operator-open="operatorOpen">
      <template #source>
        <slot v-if="mobileLayout && drawer" name="request-account" :drawer-id="drawer.id" />
        <MusicSourcePickerButton
          v-else
          :source-name="drawer?.pluginName ?? source?.name ?? '暂无可用音乐源'"
          :locked="Boolean(drawer)"
          :expanded="sourcePickerOpen"
          @open="sourcePickerOpen = true"
        />
      </template>
      <template #toolbar
        ><ClassicCollectionControls
          :selected-count="
            drawer ? state.selectedTrackIds.length : (drawerListSummary?.selectedCount ?? 0)
          "
          :disabled="feature.availability.status !== 'available'"
          :total-count="drawer ? drawer.tracks.length : state.drawers.length"
          :operator-open="operatorOpen"
          :filter-count="drawer ? trackFilterCount : (drawerListSummary?.filterCount ?? 0)"
          filter-label="筛选器"
          :can-display="Boolean(drawer)"
          @filter="openFilters"
          @operator="operatorOpen = !operatorOpen"
          @display="openOverlay(() => (displayOpen = true))"
      /></template>
      <MusicSourcePickerDialog
        :open="sourcePickerOpen"
        :active-source-id="state.sourceId"
        :built-in-sources="sources.filter(({ provenance }) => provenance === 'built-in')"
        :external-sources="sources.filter(({ provenance }) => provenance !== 'built-in')"
        @select="feature.actions.selectSource"
        @close="sourcePickerOpen = false"
      />
      <AppDialog
        :open="discoveryOpen"
        title="搜索或导入音乐"
        :description="`当前音乐源：${source?.name ?? '暂无可用音乐源'}`"
        :initial-focus-selector="
          source?.capabilities.search ? '#am-source-search' : '#am-source-import'
        "
        size="wide"
        @close="discoveryOpen = false"
      >
        <SourceToolbar
          v-if="source"
          :key="source.id"
          :plugin-id="source.id"
          :supports-search="source.capabilities.search"
          :supports-import="source.capabilities.importUrl"
          :import-url-scopes="source.importUrlScopes"
          :search-query="state.searchQuery"
          :import-url="state.importUrl"
          @update:search-query="feature.actions.setSearchQuery"
          @update:import-url="feature.actions.setImportUrl"
          @search="submit('search')"
          @import-url="submit('import-url')"
        />
      </AppDialog>
      <CatalogContextDetailsDialog
        :open="contextOpen"
        :drawer="drawer"
        @close="contextOpen = false"
      />
      <CatalogDisplayModeDialog
        v-if="drawer"
        :item-style="state.itemStyle"
        @update-item-style="feature.actions.setItemStyle?.($event)"
        :open="displayOpen"
        :display-mode="state.displayMode"
        :mobile-columns="state.mobileColumns"
        @update-display-mode="feature.actions.setDisplayMode"
        @update-mobile-columns="feature.actions.setMobileColumns"
        @close="displayOpen = false"
      />
      <CatalogDrawerActionsDialog
        :open="Boolean(actionDrawer)"
        :drawer="actionDrawer"
        :favorite-track-ids="favoriteIds"
        @close="actionDrawerId = undefined"
        @favorite-all="favoriteDrawer"
        @rename="feature.actions.renameDrawer"
        @toggle-pinned="toggleDrawerPinned"
        @refresh="feature.actions.refresh"
      />
      <CatalogTrackActionsDialog
        :playlists="state.playlists"
        @add-to-playlist="(track, id) => feature.actions.addToPlaylist(id, [track.id])"
        :open="Boolean(actionTrack)"
        :track="actionTrack"
        :custom-tags="state.customTagsByTrackId.get(actionTrackId ?? '') ?? []"
        :invalid="invalidIds.has(actionTrackId ?? '')"
        :favorite="favoriteIds.has(actionTrackId ?? '')"
        :queued="state.queuedTrackIds.includes(actionTrackId ?? '')"
        :download-busy="Boolean(state.downloadBusy)"
        @close="actionTrackId = undefined"
        @play="play"
        @download="download([$event])"
        @favorite="feature.actions.toggleFavorite($event.id)"
        @queue="feature.actions.toggleQueue($event.id)"
        @compose="feature.actions.useAsMaterial([$event.id])"
        @rename="(track, name) => feature.actions.rename(track.id, name)"
        @add-tag="(track, tag) => feature.actions.addTag([track.id], tag)"
        @remove-tag="(track, tag) => feature.actions.removeTag(track.id, tag)"
      />
      <CatalogPlaylistPickerDialog
        :open="playlistPickerOpen"
        :playlists="state.playlists"
        :selected-count="selectedTracks.length"
        :overlay-target="modalTarget"
        @close="playlistPickerOpen = false"
        @select="batchActions.addSelectedToPlaylist"
      />
      <CollectionFilterSheet
        :open="state.filterDraft !== null"
        title="歌曲筛选器"
        @close="feature.actions.cancelFilters"
      >
        <CatalogTrackFilterPanel
          v-if="state.filterDraft !== null"
          :filters="draft"
          :history-scope="`catalog:tracks:${state.activeDrawerId}`"
          :tag-stats="tagStats"
          @update:filters="draft = $event"
          @preview-change="filterPreview = $event"
          @detail-open-change="filterDetailOpen = $event"
        />
        <template v-if="!filterDetailOpen" #footer>
          <ClassicFilterFooter
            :result-count="previewTracks.length"
            :total-count="drawer?.tracks.length ?? 0"
            :disabled="feature.availability.status !== 'available'"
            @cancel="feature.actions.cancelFilters"
            @apply="feature.actions.applyFilters"
          />
        </template>
      </CollectionFilterSheet>
      <AppDialog :open="Boolean(errorDrawer)" title="音乐列表错误处理" @close="closeError"
        ><CatalogErrorDetails
          v-if="errorDrawer"
          :drawer="errorDrawer"
          @retry="feature.actions.retry"
          @view="viewLoadedTracks"
          @verify="feature.actions.verify"
          @cancel-verification="feature.actions.cancelVerification"
          @open-plugins="feature.actions.openSourceSettings"
      /></AppDialog>

      <template #operator>
        <SidePanel
          v-if="drawer"
          :open="operatorOpen"
          title="歌曲操作器"
          stacked-actions
          :suspended="modalOpen || feature.availability.status !== 'available'"
          @close="operatorOpen = false"
        >
          <CatalogTrackOperatorPanel
            :selected-tracks="selectedTracks"
            :selected-count="selectedTracks.length"
            :visible-count="state.tracks.length"
            :has-selected-custom-names="
              selectedTracks.some(({ id }) => state.customNamesByTrackId.has(id))
            "
            :are-all-visible-selected="allVisibleSelected"
            :are-some-visible-selected="
              !allVisibleSelected && state.tracks.some(({ id }) => selectedIds.has(id))
            "
            :are-all-selected-favorited="selectedTracks.every(({ id }) => favoriteIds.has(id))"
            :are-all-selected-queued="
              selectedTracks.every(({ id }) => state.queuedTrackIds.includes(id))
            "
            :download-busy="Boolean(state.downloadBusy)"
            @toggle-all-visible="toggleAll"
            @add-selected-to-queue="batchActions.addSelectedToQueue"
            @download-selected="batchActions.downloadSelected"
            @add-selected-to-favorites="batchActions.addSelectedToFavorites"
            @add-to-playlist="batchActions.requestAddSelectedToPlaylist"
            @restore-names="restoreNames(state.selectedTrackIds)"
          />
        </SidePanel>
        <div ref="operatorTarget" class="classic-catalog__operator-target"></div>
      </template>
      <div ref="modalTarget"></div>
    </ClassicPageOverlays>
  </section>
</template>

<style scoped>
.catalog-page__tracks-scroll {
  position: relative;
}

.classic-catalog {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-inline-size: 0;
  min-block-size: 0;
  overflow: clip;
}
.classic-catalog__stage {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  grid-template-rows: minmax(0, 1fr);
  min-inline-size: 0;
  min-block-size: 0;
  flex: 1;
}
.classic-catalog__view {
  display: flex;
  flex-direction: column;
  grid-area: 1 / 1;
  inline-size: 100%;
  min-inline-size: 0;
  min-block-size: 0;
  flex: 1;
}
.catalog-forward-enter-active,
.catalog-forward-leave-active,
.catalog-back-enter-active,
.catalog-back-leave-active {
  transition:
    transform var(--am-motion-slow) var(--am-ease-emphasized),
    opacity var(--am-motion-slow) var(--am-ease-standard);
}
.catalog-forward-enter-from,
.catalog-back-leave-to {
  opacity: 0;
  transform: translateX(100%);
}
.catalog-forward-leave-to,
.catalog-back-enter-from {
  opacity: 0;
  transform: translateX(-100%);
}
.classic-catalog__view[aria-hidden='true'] {
  pointer-events: none;
}
@media (prefers-reduced-motion: reduce) {
  .catalog-forward-enter-active,
  .catalog-forward-leave-active,
  .catalog-back-enter-active,
  .catalog-back-leave-active {
    transition: none;
  }
}
</style>
