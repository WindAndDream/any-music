<script setup lang="ts">
import { sanitizeTrackMetadataUrl } from '@any-music/core'
import type { Track } from '@any-music/core'
import { getPageScrollCheckpoint, useEditingSession } from '@any-music/ui/catalog'
import type { CatalogViewportContext, UiThemeFeatureMap } from '@any-music/ui/theme'
import { computed, onScopeDispose, useTemplateRef } from 'vue'

import type { CatalogAction, CatalogSnapshot } from '../../catalog-webview/contracts'
import { useAccountPage } from '../../platform/account-page'
import { useCatalogWebview } from '../../platform/use-catalog-webview'

const props = defineProps<
  CatalogViewportContext & {
    feature: UiThemeFeatureMap['catalog']
    theme: string
    colorScheme: 'light' | 'dark'
    density: string
    suspended: boolean
    accountId: string
  }
>()
const viewport = useTemplateRef<HTMLElement>('viewport')
const accountPage = useAccountPage()
const scrollCheckpoint = getPageScrollCheckpoint(useEditingSession('pagination:' + props.drawer.id))

// The remote document receives only display fields for this list. Account, media
// URLs, and unrelated workspace collections remain in the host.
const tracks = computed(() => props.feature.state.tracks.map(projectTrack))
const snapshot = computed<CatalogSnapshot>(() => {
  const { drawer, feature } = props
  const state = feature.state
  const ids = new Set(tracks.value.map(({ id }) => id))
  const relevant = <T>(values: ReadonlyMap<string, T>) => [...values].filter(([id]) => ids.has(id))
  return {
    theme: props.theme === 'studio' ? 'studio' : 'classic',
    colorScheme: props.colorScheme,
    density: props.density,
    selectable: props.selectable,
    tracks: tracks.value,
    currentTrackId: state.currentTrackId ?? undefined,
    selected: state.selectedTrackIds.filter((id) => ids.has(id)),
    favorite: state.favoriteTrackIds.filter((id) => ids.has(id)),
    invalid: state.invalidTrackIds.filter((id) => ids.has(id)),
    queued: state.queuedTrackIds.filter((id) => ids.has(id)),
    names: relevant(state.customNamesByTrackId),
    tags: relevant(state.customTagsByTrackId),
    itemStyle: state.itemStyle,
    displayMode: state.displayMode,
    mobileColumns: state.mobileColumns,
    downloadBusy: state.downloadBusy,
    drawer: {
      id: drawer.id,
      isLoading: drawer.isLoading,
      isSourceEnabled: drawer.isSourceEnabled,
      status: drawer.status,
      hasMore: drawer.hasMore,
      paginationLocked: drawer.paginationLocked,
      errorMessage: drawer.errorMessage,
      loadedPageCount: drawer.loadedPageCount,
    },
    loadedTrackCount: drawer.tracks.length,
  }
})

function projectTrack(track: Track): Track {
  return {
    id: track.id,
    title: track.title,
    artists: track.artists,
    durationMs: track.durationMs,
    artworkUrl: sanitizeTrackMetadataUrl(track.artworkUrl),
    publishedAtMs: track.publishedAtMs,
    description: track.description?.slice(0, 1024),
    sourceTags: track.sourceTags,
    statistics: track.statistics,
    source: {
      pluginId: track.source.pluginId,
      mediaKind: track.source.mediaKind,
      resourceId: track.source.resourceId,
      partId: track.source.partId,
    },
  }
}

function onAction(action: CatalogAction) {
  const { drawer, feature } = props
  const { actions, state } = feature
  if (action.type === 'more') {
    if (drawer.hasMore && !drawer.isLoading && !drawer.paginationLocked)
      void actions.loadMore(drawer.id)
    return
  }
  if (!state.tracks.some(({ id }) => id === action.id)) return
  switch (action.type) {
    case 'play':
      void actions.play(
        action.id,
        state.tracks.map(({ id }) => id),
      )
      break
    case 'select': {
      if (!props.selectable) return
      const selected = new Set(state.selectedTrackIds)
      if (!selected.delete(action.id)) selected.add(action.id)
      actions.select([...selected])
      break
    }
    case 'favorite':
      void actions.toggleFavorite(action.id)
      break
    case 'queue':
      actions.toggleQueue(action.id)
      break
    case 'download':
      void actions.download([action.id])
      break
    case 'actions':
      props.showTrackActions(action.id)
      break
  }
}

const { openOverlay } = useCatalogWebview(viewport, {
  accountId: props.accountId,
  query: props.drawer.input.trim(),
  get suspended() {
    return props.suspended || Boolean(accountPage.current.value)
  },
  get snapshot() {
    return snapshot.value
  },
  setReady: (ready) => props.setReady(ready),
  onAction,
  readScroll: () => scrollCheckpoint.read() ?? 0,
  saveScroll: scrollCheckpoint.save,
})
onScopeDispose(props.registerOverlayOpener(openOverlay))
</script>

<template>
  <div
    ref="viewport"
    class="catalog-webview-viewport"
    data-am-catalog-viewport
    aria-hidden="true"
  ></div>
</template>

<style scoped>
.catalog-webview-viewport {
  position: absolute;
  inset: 0;
  pointer-events: none;
}
</style>
