<script setup lang="ts">
import { provideCardPresentation } from '@any-music/card-styles/vue'
import AppDialog from '@any-music/ui/components/AppDialog.vue'
import { providePlaylistPickerPresentation } from '@any-music/ui/library'
import type { UiThemeHostSlots, UiThemeRootProps } from '@any-music/ui/theme'
import { computed, h, shallowRef, useSlots } from 'vue'
import type { Component } from 'vue'

import StudioFilters from './components/library/StudioFilters.vue'
import StudioTrackDialog from './components/overlays/StudioTrackDialog.vue'
import { provideStudioOverlays } from './composables/use-studio-overlays'

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
const detailOpen = shallowRef(false)
const pageOverlays = provideStudioOverlays(() => {
  const active = props.features.overlays.state.active
  return active?.kind === 'track-actions' ? active.trackId : null
})
const modalOpen = computed(
  () =>
    pageOverlays.modalOpen.value ||
    props.features.settings.state.open ||
    props.features.overlays.state.active !== null,
)
const list = computed(() => {
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

// The active key correlates the view with its feature; no theme ID enters business logic.
function ActivePage() {
  const key = props.features.shell.state.activeViewId
  const view = props.views[key]
  return view
    ? h(view as Component, { feature: props.features[key] }, slots)
    : h('p', { role: 'status' }, '此功能在当前运行端不可用。')
}
function SettingsView() {
  return h(
    props.views.settings as Component,
    {
      feature: props.features.settings,
      onDetailOpenChange: (open: boolean) => {
        detailOpen.value = open
      },
    },
    slots,
  )
}
</script>

<template>
  <component :is="views.shell" :feature="features.shell" :form="form" :modal-open="modalOpen">
    <template #navigation>
      <component :is="views.navigation" :feature="features.navigation" />
    </template>
    <ActivePage />
    <template #player><component :is="views.player" :feature="features.player" /></template>
    <template #overlays>
      <div ref="pageModalTarget" class="studio-page-overlays"></div>
      <AppDialog
        v-if="features.settings.state.open"
        :open="features.settings.state.open"
        title="设置"
        return-focus-selector='[data-am-focus-key="settings:open"]'
        :suspended="
          features.settings.state.suspended || detailOpen || features.overlays.state.active !== null
        "
        @close="features.settings.actions.close"
        ><SettingsView
      /></AppDialog>
      <StudioTrackDialog
        v-if="features.overlays.state.active?.kind === 'track-actions' && list"
        :key="`${features.shell.state.activeViewId}:${features.overlays.state.active.trackId}`"
        :track-id="features.overlays.state.active.trackId"
        :state="list.state"
        :actions="list.actions"
        :availability="list.availability"
        queue-action="toggle"
        @queue="
          list.state.queuedTrackIds.includes($event)
            ? features.queue.actions.remove([$event])
            : list.actions.enqueue([$event])
        "
        @close="features.overlays.actions.close()"
      />
      <AppDialog
        v-if="features.overlays.state.active?.kind === 'filters' && list"
        :open="true"
        title="筛选歌曲"
        @close="features.overlays.actions.close()"
        ><StudioFilters
          :open="true"
          :state="list.state"
          :actions="list.actions"
          :scope="`${features.shell.state.activeViewId}:tracks`"
          @finished="features.overlays.actions.close()"
      /></AppDialog>
      <component :is="views.overlays" :feature="features.overlays" />
    </template>
  </component>
</template>
