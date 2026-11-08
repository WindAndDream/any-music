import { countCatalogTrackFilters } from '@any-music/ui/catalog'
import {
  provideTrackNames,
  useCollectionNavigation,
  useConfirmAction,
  useHistoryCollection,
  usePlaylistPickerOpen,
} from '@any-music/ui/library'
import type { UiThemeFeatureMap } from '@any-music/ui/theme'
import { computed, nextTick, shallowRef, watch } from 'vue'
import type { ShallowRef } from 'vue'

import { useClassicCompactControls } from './use-classic-compact-controls'
import { usePresentationActivity } from './use-presentation-activity'

/** History keeps playback identities; song intents still go to the stable host library. */
export function useClassicHistory(
  props: Readonly<{ feature: UiThemeFeatureMap['history'] }>,
  element: ShallowRef<HTMLElement | null>,
) {
  const state = computed(() => props.feature.state)
  provideTrackNames(computed(() => state.value.customNamesByTrackId))
  const history = useHistoryCollection({
    entries: () => state.value.entries,
    tracks: () => state.value.tracks,
    names: () => state.value.customNamesByTrackId,
    customTags: () => state.value.customTagsByTrackId,
  })
  const filtered = computed(() => countCatalogTrackFilters(history.filters.value).total > 0)
  const groups = computed(() => {
    const ids = [...new Set(history.rows.value.map(({ track }) => track.source.pluginId))]
    return ids.map((id) => {
      const rows = history.filtered.value.filter(({ track }) => track.source.pluginId === id)
      return {
        id,
        name: state.value.platformNames.get(id) ?? id,
        count: rows.length,
        totalCount: history.rows.value.filter(({ track }) => track.source.pluginId === id).length,
        selectedCount: rows.filter(({ entry }) => history.selectedIds.value.includes(entry.id))
          .length,
        isCustom: rows.some(({ track }) => track.source.mediaKind === 'custom'),
      }
    })
  })
  const navigation = useCollectionNavigation({
    editing: history.editing,
    enabled: () => history.arrangement.value === 'platform',
    entryIds: () => groups.value.map(({ id }) => id),
    scrollContainer: () => element.value?.closest<HTMLElement>('.music-app-shell__content') ?? null,
  })
  watch(
    navigation.activeId,
    (id) => {
      history.activePlatform.value = id ?? null
    },
    { immediate: true, flush: 'sync' },
  )
  const activePlatform = computed(() =>
    groups.value.find(({ id }) => id === navigation.activeId.value),
  )
  const compactControls = useClassicCompactControls(element, () => state.value.mobileLayout)
  const actionEntryId = shallowRef<string | null>(null)
  const actionRow = computed(() =>
    history.rows.value.find(({ entry }) => entry.id === actionEntryId.value),
  )
  const displayOpen = shallowRef(false)
  const contentDisplayOpen = shallowRef(false)
  const playlistOpen = usePlaylistPickerOpen(history.editing)
  const confirm = useConfirmAction()
  const activity = usePresentationActivity()
  const available = () => props.feature.availability.status === 'available'
  const selectedTrackIds = computed(() => [
    ...new Set(history.selected.value.map(({ track }) => track.id)),
  ])
  const visibleTrackIds = computed(() => history.visible.value.map(({ track }) => track.id))
  const modalOpen = computed(
    () =>
      history.draft.value !== null ||
      displayOpen.value ||
      contentDisplayOpen.value ||
      Boolean(actionRow.value) ||
      playlistOpen.value,
  )
  async function clear() {
    if (!available() || !history.rows.value.length) return
    actionEntryId.value = null
    const isCurrent = activity.checkpoint()
    const confirmed = await confirm({
      title: '清空播放历史',
      message: '清空后无法撤销，但不会删除收藏、歌单或下载记录。',
      confirmLabel: '清空历史',
      tone: 'danger',
    })
    if (!confirmed || !isCurrent() || !available()) return
    await props.feature.actions.clear()
  }
  function play(trackId: string) {
    if (available()) void props.feature.actions.play(trackId, visibleTrackIds.value)
  }
  function favoriteSelected() {
    if (!available()) return
    for (const id of selectedTrackIds.value)
      if (!state.value.favoriteTrackIds.includes(id) && !state.value.invalidTrackIds.includes(id))
        void props.feature.actions.toggleFavorite(id)
  }
  function playSelected() {
    const ids = selectedTrackIds.value
    if (available() && ids[0]) void props.feature.actions.play(ids[0], ids)
  }
  function addToPlaylist(playlistIds: readonly string[]) {
    if (!playlistOpen.value || !available() || !selectedTrackIds.value.length) return
    const ids = selectedTrackIds.value.filter((id) => !state.value.invalidTrackIds.includes(id))
    if (!ids.length) return
    for (const playlistId of new Set(playlistIds)) {
      if (state.value.playlists?.some(({ id }) => id === playlistId))
        props.feature.actions.addToPlaylist(playlistId, ids)
    }
    playlistOpen.value = false
  }
  function deactivateLeavingView(view: Element) {
    const root = view.getRootNode() as Document | ShadowRoot
    if (root.activeElement && view.contains(root.activeElement))
      element.value?.focus({ preventScroll: true })
    view.setAttribute('inert', '')
    view.setAttribute('aria-hidden', 'true')
  }
  function activateView(view: Element) {
    view.removeAttribute('inert')
    view.removeAttribute('aria-hidden')
    navigation.prepareTransition(view)
  }
  async function finishViewTransition(view: Element) {
    await nextTick()
    if (view.isConnected && view.getAttribute('inert') === null)
      navigation.finishTransition(view, { restoreFocus: available() && !modalOpen.value })
  }
  return {
    history,
    state,
    filtered,
    groups,
    navigation,
    activePlatform,
    compactControls,
    actionEntryId,
    actionRow,
    displayOpen,
    contentDisplayOpen,
    playlistOpen,
    selectedTrackIds,
    modalOpen,
    available,
    clear,
    play,
    playSelected,
    favoriteSelected,
    addToPlaylist,
    deactivateLeavingView,
    activateView,
    finishViewTransition,
  }
}
