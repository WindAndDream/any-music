import { countCatalogTrackFilters } from '@any-music/ui/catalog'
import {
  getTrackDisplayPreferences,
  useCollectionNavigation,
  useEditingSession,
  useQueueReorder,
} from '@any-music/ui/library'
import { computed, inject, nextTick, onDeactivated, shallowRef, watch } from 'vue'
import type { ShallowRef } from 'vue'

import {
  classicVirtualFavoritesCanaryKey,
  classicVirtualPlaylistCanaryKey,
  classicVirtualQueueCanaryKey,
} from './classic-virtual-favorites-canary'
import type {
  ClassicVirtualTrackGridAdapter,
  ClassicVirtualTrackGridBinding,
} from './classic-virtual-favorites-canary'
import { useClassicCompactControls } from './use-classic-compact-controls'
import type { ClassicTrackCollectionProps } from './use-classic-track-collection'

/** Theme-only navigation/gestures; every ordering mutation goes to the existing host collection. */
export function useClassicCollectionPresentation(
  props: Readonly<ClassicTrackCollectionProps>,
  element: ShallowRef<HTMLElement | null>,
) {
  const editing = useEditingSession(props.scope ?? `library-root:${props.title}`)
  const compactControls = useClassicCompactControls(element, () =>
    Boolean(props.collection?.state.mobileLayout),
  )
  const arrangement = computed(() => props.collection?.state.arrangementMode ?? 'flat')
  // No production provider enables this temporary admission gate.
  const favoritesCanary = inject(classicVirtualFavoritesCanaryKey, false)
  const queueCanary = inject(classicVirtualQueueCanaryKey, false)
  const playlistCanary = inject(classicVirtualPlaylistCanaryKey, false)
  const virtualAdapter = shallowRef<ClassicVirtualTrackGridAdapter>()
  const virtualCollectionView = computed(() =>
    Boolean(
      props.collection &&
      (props.scope === 'favorites:tracks'
        ? favoritesCanary
        : props.scope === 'queue:tracks'
          ? queueCanary
          : props.scope?.startsWith('playlist:') && playlistCanary),
    ),
  )
  // Playlist identities stay in the region so equal track/platform IDs cannot share a handoff.
  const continuityRegion = computed(() => {
    if (!props.collection || !props.scope) return null
    const scope = props.scope
    const base =
      scope === 'favorites:tracks'
        ? 'favorites'
        : scope === 'queue:tracks'
          ? 'queue'
          : scope.startsWith('playlist:')
            ? scope
            : null
    return base
      ? `${base}:${arrangement.value === 'flat' || activePlatform.value ? 'tracks' : 'platforms'}`
      : null
  })
  function waitOverviewAdapter(
    signal: AbortSignal,
  ): Promise<ClassicVirtualTrackGridAdapter | undefined> {
    if (signal.aborted) return Promise.resolve(undefined)
    if (virtualAdapter.value?.focusEntry) return Promise.resolve(virtualAdapter.value)
    return new Promise((resolve) => {
      const stop = watch(virtualAdapter, (adapter) => {
        if (adapter?.focusEntry) finish(adapter)
      })
      const abort = () => finish(undefined)
      function finish(adapter: ClassicVirtualTrackGridAdapter | undefined) {
        stop()
        signal.removeEventListener('abort', abort)
        resolve(adapter)
      }
      signal.addEventListener('abort', abort, { once: true })
    })
  }
  const scrollContainer = computed(
    () => element.value?.closest<HTMLElement>('.music-app-shell__content') ?? null,
  )
  const platformIds = computed(() => {
    const available = new Set(props.state.tracks.map((track) => track.source.pluginId))
    return [...new Set([...(props.collection?.state.platformOrder ?? []), ...available])].filter(
      (id) => available.has(id),
    )
  })
  const navigation = useCollectionNavigation({
    editing,
    enabled: () => Boolean(props.collection) && arrangement.value === 'platform',
    entryIds: platformIds,
    scrollContainer,
    get focusEntry() {
      return virtualCollectionView.value
        ? async (id: string, signal: AbortSignal) =>
            (await waitOverviewAdapter(signal))?.focusEntry?.(id, signal) ?? false
        : undefined
    },
    get captureOverview() {
      return virtualCollectionView.value ? virtualAdapter.value?.captureOverview : undefined
    },
    get restoreOverview() {
      return virtualCollectionView.value
        ? async (
            snapshot: Parameters<NonNullable<ClassicVirtualTrackGridAdapter['restoreOverview']>>[0],
            signal: AbortSignal,
          ) => (await waitOverviewAdapter(signal))?.restoreOverview?.(snapshot, signal) ?? false
        : undefined
    },
  })
  watch(
    navigation.viewKey,
    () => {
      virtualAdapter.value?.cancelNavigation()
      virtualAdapter.value = undefined
    },
    { flush: 'sync' },
  )
  const groups = computed(() => {
    // A growing platform overview must not rescan the full track result once per platform.
    const grouped = new Map<
      string,
      { tracks: (typeof props.state.tracks)[number][]; isCustom: boolean }
    >()
    for (const track of props.state.tracks) {
      const id = track.source.pluginId
      let group = grouped.get(id)
      if (!group) {
        group = { tracks: [], isCustom: false }
        grouped.set(id, group)
      }
      group.tracks.push(track)
      group.isCustom ||= track.source.mediaKind === 'custom'
    }
    return platformIds.value.map((id) => ({
      id,
      name: props.state.platformNames.get(id) ?? id,
      tracks: grouped.get(id)!.tracks,
      totalCount: props.collection?.state.platformTrackCounts.get(id) ?? 0,
      isCustom: grouped.get(id)!.isCustom,
    }))
  })
  const activePlatform = computed(() =>
    groups.value.find(({ id }) => id === navigation.activeId.value),
  )
  const displayScope = computed(() =>
    navigation.activeId.value ? `platform:${navigation.activeId.value}` : arrangement.value,
  )
  const displayState = computed(() => ({
    ...props.state,
    ...getTrackDisplayPreferences(props.state, displayScope.value),
  }))
  const displayedTracks = computed(() => activePlatform.value?.tracks ?? props.state.tracks)
  const positions = computed(
    () => new Map(props.state.tracks.map((track, index) => [track.id, index + 1])),
  )
  const filtered = computed(() => countCatalogTrackFilters(props.state.filters).total > 0)
  const available = () => props.availability.status === 'available'
  // Group checks run for every logical candidate, including unmounted tracks. Index once
  // per controlled result instead of scanning that result for each reorder comparison.
  const platformByTrackId = computed(
    () => new Map(props.state.tracks.map((track) => [track.id, track.source.pluginId])),
  )
  const reorder = useQueueReorder({
    arrangementMode: arrangement,
    trackIds: () => displayedTracks.value.map(({ id }) => id),
    platformIds,
    scrollElement: element,
    get autoScrollElement() {
      return virtualCollectionView.value ? scrollContainer : undefined
    },
    get createGeometry() {
      return virtualCollectionView.value ? virtualAdapter.value?.createGeometry : undefined
    },
    get retainItem() {
      return virtualCollectionView.value ? virtualAdapter.value?.retainItem : undefined
    },
    get focusItem() {
      return virtualCollectionView.value ? virtualAdapter.value?.focusItem : undefined
    },
    getPlatformId: (id) => platformByTrackId.value.get(id),
    moveTrack: (id, target, ids) => {
      if (available()) props.collection?.actions.moveTrack(id, target, ids)
    },
    movePlatform: (id, target, ids) => {
      if (available()) props.collection?.actions.movePlatform(id, target, ids)
    },
  })
  // Registration belongs to the mounted surface. A fresh controlled snapshot must not
  // unregister it during its own reorder commit and cancel the pending landing.
  const registerVirtualAdapter: ClassicVirtualTrackGridBinding['register'] = (adapter) => {
    virtualAdapter.value = adapter
    return () => {
      // A leaving transition must not detach the newer incoming surface.
      if (virtualAdapter.value === adapter) {
        reorder.clearDrag()
        adapter.cancelNavigation()
        virtualAdapter.value = undefined
      }
    }
  }
  const virtualGrid = computed<ClassicVirtualTrackGridBinding | undefined>(() =>
    virtualCollectionView.value
      ? {
          scrollElement: scrollContainer.value,
          resetKey: navigation.viewKey.value,
          layoutGeneration: props.state.itemStyle ?? 'minimal',
          register: registerVirtualAdapter,
        }
      : undefined,
  )
  function setArrangement(mode: 'flat' | 'platform') {
    if (available()) props.collection?.actions.setArrangementMode(mode)
  }
  function togglePlatform(id: string) {
    if (!available()) return
    const tracks = groups.value.find((group) => group.id === id)?.tracks ?? []
    const selected = new Set(props.state.selectedTrackIds)
    const all = tracks.every((track) => selected.has(track.id))
    for (const track of tracks) {
      if (all) selected.delete(track.id)
      else selected.add(track.id)
    }
    props.actions.select([...selected])
  }
  watch(
    [
      navigation.viewKey,
      () => displayState.value.displayMode,
      () => displayState.value.mobileColumns,
      () => props.state.filterDraft,
    ],
    reorder.clearDrag,
  )
  function deactivateLeavingView(view: Element) {
    const root = view.getRootNode() as Document | ShadowRoot
    if (root.activeElement && view.contains(root.activeElement))
      element.value?.focus({ preventScroll: true })
    view.setAttribute('inert', '')
    view.setAttribute('aria-hidden', 'true')
  }
  function activateView(view: Element) {
    virtualAdapter.value?.cancelNavigation()
    view.removeAttribute('inert')
    view.removeAttribute('aria-hidden')
    navigation.prepareTransition(view)
  }
  async function finishViewTransition(view: Element, restoreFocus = true) {
    // Restore navigation after the incoming view has committed its layout.
    await nextTick()
    if (view.isConnected && view.getAttribute('inert') === null)
      navigation.finishTransition(view, {
        restoreFocus: restoreFocus && available() && props.state.filterDraft === null,
      })
  }
  onDeactivated(reorder.clearDrag)
  return {
    arrangement,
    navigation,
    groups,
    activePlatform,
    displayState,
    compactControls,
    virtualGrid,
    virtualAdapter,
    continuityRegion,
    setDisplayMode: (mode: typeof props.state.displayMode) =>
      props.actions.setDisplayMode(mode, displayScope.value),
    setMobileColumns: (columns: typeof props.state.mobileColumns) =>
      props.actions.setMobileColumns(columns, displayScope.value),
    displayedTracks,
    positions,
    filtered,
    reorder,
    setArrangement,
    togglePlatform,
    deactivateLeavingView,
    activateView,
    finishViewTransition,
  }
}
