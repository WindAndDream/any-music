<script setup lang="ts">
import { provideCardPresentation } from '@any-music/card-styles/vue'
import { BottomSheet, useElementBlockSize } from '@any-music/ui'
import { getDownloadListEntries, providePlaylistPickerPresentation } from '@any-music/ui/library'
import type { UiThemeHostSlots, UiThemeRootProps } from '@any-music/ui/theme'
import { computed, h, nextTick, shallowRef, useSlots, useTemplateRef, watch } from 'vue'
import type { Component } from 'vue'

import DownloadSummary from './components/downloads/DownloadSummary.vue'
import ClassicTrackDialog from './components/overlays/ClassicTrackDialog.vue'
import PluginSummary from './components/plugins/PluginSummary.vue'
import ClassicShell from './components/shell/ClassicShell.vue'
import { provideClassicOverlays } from './composables/use-classic-overlays'

const props = defineProps<UiThemeRootProps>()
providePlaylistPickerPresentation({
  coverUrls: () => props.features.playlists.state.coverUrls,
  customTagsByPlaylistId: () => props.features.playlists.state.customTagsByPlaylistId,
  mobileLayout: () => props.features.shell.state.mobileLayout ?? props.form === 'mobile',
})
provideCardPresentation({
  itemStyle: () => {
    const id = props.features.shell.state.activeViewId
    return id === 'catalog' ||
      id === 'queue' ||
      id === 'favorites' ||
      id === 'playlists' ||
      id === 'downloads' ||
      id === 'history' ||
      id === 'custom-tracks'
      ? (props.features[id].state.itemStyle ?? 'minimal')
      : 'minimal'
  },
  player: () => props.features.player.state,
  actions: {
    play: () => props.features.player.actions.play(),
    pause: () => props.features.player.actions.pause(),
  },
})
defineSlots<UiThemeHostSlots>()
const slots = useSlots()
const playerOverlayTarget = shallowRef<HTMLElement | null>(null)
const settingsOverlayTarget = shallowRef<HTMLElement | null>(null)
const playerExpanded = shallowRef(false)
const playerSettingsOpen = shallowRef(false)
const settingsDetailOpen = shallowRef(false)
const pageOverlays = provideClassicOverlays()
const playerContent = useTemplateRef<HTMLElement>('playerContent')
const playerBlockSize = useElementBlockSize(playerContent)
const mobileLayout = computed(
  () => props.features.shell.state.mobileLayout ?? props.form === 'mobile',
)
const downloadedCount = computed(
  () =>
    getDownloadListEntries(props.features.downloads.state.batches).filter(
      (entry) => entry.state === 'succeeded',
    ).length,
)
const collectionSummary = computed(() => {
  const id = props.features.shell.state.activeViewId
  if (id === 'playlists')
    return {
      label: '我的歌单',
      count: props.features.playlists.state.playlists.length,
      unit: '个歌单',
      shortUnit: '个',
    }
  if (id === 'history')
    return {
      label: '播放历史',
      count: props.features.history.state.entries.length,
      unit: '条播放记录',
      shortUnit: '条',
    }
  if (id === 'queue')
    return {
      label: '待听',
      count: props.features.queue.state.queuedTrackIds.length,
      unit: '首歌曲',
      shortUnit: '首',
    }
  if (id === 'favorites')
    return {
      label: '我的喜欢',
      count: props.features.favorites.state.favoriteTrackIds.length,
      unit: '首歌曲',
      shortUnit: '首',
    }
  return null
})
const trackList = computed(() => {
  const key = props.features.shell.state.activeViewId
  return key === 'catalog' ||
    key === 'queue' ||
    key === 'favorites' ||
    key === 'playlists' ||
    key === 'custom-tracks' ||
    key === 'downloads'
    ? props.features[key]
    : null
})
// Retain the last track while its dialog plays the closing transition.
const actionTrackId = shallowRef('')
const trackActionsOpen = computed(
  () => props.features.overlays.state.active?.kind === 'track-actions',
)
let trackActionRevision = 0
watch(
  () => props.features.overlays.state.active,
  (active) => {
    trackActionRevision++
    if (active?.kind === 'track-actions') {
      actionTrackId.value = active.trackId
      pageOverlays.trackActionId.value = active.trackId
    }
  },
  { immediate: true, flush: 'sync' },
)
watch(
  () => props.features.shell.state.activeViewId,
  () => {
    trackActionRevision++
    pageOverlays.trackActionId.value = undefined
  },
  { flush: 'sync' },
)
async function finishTrackActions(id: string) {
  // AppDialog emits before its own next-tick return-focus work. Keep the opener until
  // that handoff finishes, and never clear a newer dialog opened during the close.
  const revision = trackActionRevision
  await nextTick()
  await nextTick()
  if (
    revision === trackActionRevision &&
    !trackActionsOpen.value &&
    pageOverlays.trackActionId.value === id
  )
    pageOverlays.trackActionId.value = undefined
}
// The key selects both sides of the typed view/feature map. Vue's dynamic-component
// template checker cannot retain that correlation across a union of page props.
function ActivePage() {
  const key = props.features.shell.state.activeViewId
  const view = props.views[key]
  return view
    ? h(
        view as Component,
        {
          feature: props.features[key],
          ...(key === 'catalog' || key === 'tags' || key === 'plugins'
            ? { mobileLayout: mobileLayout.value }
            : {}),
        },
        slots,
      )
    : null
}
function PlayerView() {
  return h(props.views.player as Component, {
    feature: props.features.player,
    mobileOverlayTarget: playerOverlayTarget.value,
    onMobileExpandedChange: (value: boolean) => {
      playerExpanded.value = value
    },
    onSettingsOpenChange: (value: boolean) => {
      playerSettingsOpen.value = value
    },
  })
}
function SettingsView() {
  return h(
    props.views.settings as Component,
    {
      feature: props.features.settings,
      overlayTarget: settingsOverlayTarget.value,
      onDetailOpenChange: (open: boolean) => {
        settingsDetailOpen.value = open
      },
    },
    slots,
  )
}
</script>

<template>
  <ClassicShell
    :feature="features.shell"
    :navigation="features.navigation"
    :form="form"
    :modal-open="
      playerSettingsOpen ||
      pageOverlays.modalOpen.value ||
      features.settings?.state.open ||
      features.overlays.state.active !== null
    "
    :player-modal-open="playerExpanded"
  >
    <ActivePage />
    <template
      v-if="
        ['catalog', 'queue', 'favorites', 'history', 'playlists'].includes(
          features.shell.state.activeViewId,
        ) ||
        (['downloads', 'tags', 'plugins'].includes(features.shell.state.activeViewId) &&
          mobileLayout)
      "
      #source
    >
      <span
        v-if="collectionSummary"
        class="product-top-bar__queue-count"
        :aria-label="`${collectionSummary.label}共 ${collectionSummary.count} ${collectionSummary.unit}`"
      >
        <strong>{{ collectionSummary.count }}</strong>
        {{ collectionSummary.shortUnit }}
      </span>
      <DownloadSummary
        v-else-if="features.shell.state.activeViewId === 'downloads'"
        :concurrency="features.downloads.state.concurrency"
        :downloaded-count="downloadedCount"
        compact
      />
      <PluginSummary
        v-else-if="features.shell.state.activeViewId === 'plugins'"
        :items="features.plugins.state.items"
        compact
      />
      <div
        ref="sourceTarget"
        v-show="['catalog', 'tags'].includes(features.shell.state.activeViewId)"
      ></div>
    </template>
    <template #player>
      <div ref="toolbarTarget"></div>
      <div
        :style="{ '--am-player-block-size': `${playerBlockSize}px` }"
        class="catalog-player-stage"
        :class="{ 'catalog-player-stage--operator-open': pageOverlays.operatorOpen.value }"
      >
        <div ref="playerContent"><PlayerView /></div>
        <div ref="operatorTarget" class="catalog-operator-overlay-target"></div>
      </div>
    </template>
    <template #overlays>
      <div ref="modalTarget" class="catalog-modal-overlay-target"></div>
      <div ref="playerOverlayTarget" class="classic-player-overlays"></div>
      <ClassicTrackDialog
        v-if="trackList && actionTrackId"
        :key="`${features.shell.state.activeViewId}:${actionTrackId}`"
        :open="trackActionsOpen"
        :track-id="actionTrackId"
        :state="trackList.state"
        :actions="trackList.actions"
        :availability="trackList.availability"
        @queue="
          trackList.state.queuedTrackIds.includes($event)
            ? features.queue.actions.remove([$event])
            : trackList.actions.enqueue([$event])
        "
        @close="features.overlays.actions.close()"
        @after-leave="finishTrackActions($event)"
      />
      <!-- Keep the sheet mounted so its transition owns both entry and exit. -->
      <BottomSheet
        :open="features.settings?.state.open ?? false"
        :suspended="features.settings?.state.suspended || settingsDetailOpen"
        title="设置"
        return-focus-selector='[data-am-focus-key="settings:open"], [data-am-focus-key="navigation:open"]'
        :description="
          features.settings?.state.isMobileLayout ? undefined : '让 Any Music 更合你的习惯。'
        "
        size="settings"
        @close="features.settings?.actions.close()"
        ><SettingsView v-if="features.settings"
      /></BottomSheet>
      <!-- Equal modal tokens paint in tree order: settings details follow their sheet,
           while global confirmation and feedback remain above both. -->
      <div ref="settingsOverlayTarget" class="classic-settings-overlays"></div>
      <component :is="views.overlays" :feature="features.overlays" />
    </template>
    <template v-if="features.shell.state.activeViewId === 'catalog'" #session>
      <slot
        v-if="features.catalog.state.activeDrawerId && $slots['request-account']"
        name="request-account"
        :drawer-id="features.catalog.state.activeDrawerId"
      />
      <slot v-else name="source-identity" :source-id="features.catalog.state.sourceId" />
    </template>
  </ClassicShell>
</template>

<style scoped>
.classic-player-overlays,
.classic-settings-overlays {
  position: absolute;
  inset: 0;
  pointer-events: none;
}
.classic-settings-overlays {
  z-index: var(--am-z-dialog);
}
</style>
