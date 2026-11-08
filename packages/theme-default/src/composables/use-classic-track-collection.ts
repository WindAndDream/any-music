import type { Track } from '@any-music/core'
import {
  provideTrackNames,
  useConfirmAction,
  useEditingSession,
  provideEditingSession,
  editingStateKey,
  useCatalogSelectionOperator,
} from '@any-music/ui/catalog'
import { usePlaylistPickerOpen } from '@any-music/ui/library'
import type {
  UiThemeTrackListState,
  UiThemeTrackListActions,
  UiThemeAvailability,
  UiThemeStatus,
  UiThemeCollectionState,
  UiThemeCollectionActions,
} from '@any-music/ui/theme'
import { computed, shallowRef } from 'vue'
import type { DeepReadonly, ShallowRef } from 'vue'

import { usePresentationActivity } from './use-presentation-activity'

export type ClassicTrackCollectionProps = {
  title: string
  state: DeepReadonly<UiThemeTrackListState>
  actions: Readonly<UiThemeTrackListActions>
  availability: UiThemeAvailability
  status: UiThemeStatus
  currentTrackId?: string | null
  remove?: (ids: readonly string[]) => void | Promise<void>
  reorder?: (ids: readonly string[]) => void
  scope?: string
  collection?: {
    readonly state: DeepReadonly<UiThemeCollectionState>
    readonly actions: Readonly<UiThemeCollectionActions>
  }
}

/** One presentation scope for controlled selection, confirmation and keyboard/touch ordering. */
export function useClassicTrackCollection(
  props: Readonly<ClassicTrackCollectionProps>,
  displayedTracks: () => readonly Track[] = () => props.state.tracks,
) {
  const editing = useEditingSession(props.scope ?? `library-root:${props.title}`)
  provideEditingSession(editing)
  provideTrackNames(computed(() => props.state.customNamesByTrackId))
  const confirm = useConfirmAction()
  const activity = usePresentationActivity()
  const playlistOpen = usePlaylistPickerOpen(editing)
  const { operatorOpen } = editing.state(playlistPickerKey, () => ({
    operatorOpen: shallowRef(false),
  }))
  const selection = computed(() => new Set(props.state.selectedTrackIds))
  const selected = computed(() =>
    props.state.selectedTrackIds.filter((id) => displayedTracks().some((track) => track.id === id)),
  )
  useCatalogSelectionOperator({
    context: props.scope ?? `library-root:${props.title}`,
    open: operatorOpen,
    clearSelection: () => props.actions.select([]),
  })
  const allSelected = computed(
    () =>
      displayedTracks().length > 0 && displayedTracks().every(({ id }) => selection.value.has(id)),
  )
  function select(id: string) {
    if (!operatorOpen.value || props.availability.status !== 'available') return
    const ids = new Set(props.state.selectedTrackIds)
    if (ids.has(id)) ids.delete(id)
    else ids.add(id)
    props.actions.select([...ids])
  }
  function toggleAll() {
    if (!operatorOpen.value) return
    if (props.availability.status !== 'available') return
    const ids = new Set(props.state.selectedTrackIds)
    for (const { id } of displayedTracks()) {
      if (allSelected.value) ids.delete(id)
      else ids.add(id)
    }
    props.actions.select([...ids])
  }
  function move(id: string, offset: -1 | 1) {
    if (props.availability.status !== 'available') return
    const ids = displayedTracks().map((track) => track.id)
    const index = ids.indexOf(id),
      next = index + offset
    if (index < 0 || next < 0 || next >= ids.length) return
    ;[ids[index], ids[next]] = [ids[next]!, ids[index]!]
    props.reorder?.(ids)
  }
  async function download() {
    const ids = selected.value.filter((id) => !props.state.invalidTrackIds.includes(id))
    if (!ids.length || props.state.downloadBusy) return
    const isCurrent = activity.checkpoint()
    if (
      await confirm({
        title: '下载已选歌曲',
        message: `确定开始下载已选的 ${ids.length} 首歌曲吗？`,
        confirmLabel: `下载 ${ids.length} 首`,
      })
    )
      if (isCurrent() && props.availability.status === 'available' && !props.state.downloadBusy)
        await props.actions.download(ids)
  }
  function play(id: string) {
    if (!props.state.invalidTrackIds.includes(id))
      void props.actions.play(
        id,
        displayedTracks().map((track) => track.id),
      )
  }
  function downloadOne(id: string) {
    if (!props.state.invalidTrackIds.includes(id) && !props.state.downloadBusy)
      void props.actions.download([id])
  }
  async function favoriteSelected() {
    const ids = selected.value.filter(
      (id) =>
        !props.state.favoriteTrackIds.includes(id) && !props.state.invalidTrackIds.includes(id),
    )
    if (!ids.length) return
    const isCurrent = activity.checkpoint()
    if (
      await confirm({
        title: '添加到我的喜欢',
        message: `确定将已选的 ${ids.length} 首歌曲添加到“我的喜欢”吗？`,
      })
    ) {
      if (!isCurrent() || props.availability.status !== 'available') return
      for (const id of ids) void props.actions.toggleFavorite(id)
    }
  }
  function addToPlaylist(playlistIds: readonly string[]) {
    if (!playlistOpen.value) return
    if (props.availability.status !== 'available') return
    const ids = selected.value.filter((id) => !props.state.invalidTrackIds.includes(id))
    if (!ids.length) return
    for (const playlistId of new Set(playlistIds)) {
      if (props.state.playlists?.some(({ id }) => id === playlistId))
        props.actions.addToPlaylist(playlistId, ids)
    }
    playlistOpen.value = false
  }
  async function removeSelected() {
    const ids = [...selected.value]
    if (!ids.length || !props.remove) return
    const isCurrent = activity.checkpoint()
    if (
      await confirm({
        title: '移除已选歌曲',
        message: `确定移除已选的 ${ids.length} 首歌曲吗？`,
        tone: 'danger',
      })
    )
      if (isCurrent() && props.availability.status === 'available') await props.remove(ids)
  }

  return {
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
  }
}

const playlistPickerKey = editingStateKey<{
  operatorOpen: ShallowRef<boolean>
}>('classic-library-playlist-picker')
