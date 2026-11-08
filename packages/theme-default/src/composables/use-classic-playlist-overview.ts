import {
  playlistEditorErrorMessage,
  reorderVisiblePlaylists,
  useConfirmAction,
  usePlaylistCollection,
  useQueueReorder,
} from '@any-music/ui/library'
import type { UiThemeFeatureMap } from '@any-music/ui/theme'
import { computed, onDeactivated, shallowRef, watch } from 'vue'
import type { ShallowRef } from 'vue'

import { useClassicCompactControls } from './use-classic-compact-controls'
import { usePresentationActivity } from './use-presentation-activity'

export function useClassicPlaylistOverview(
  props: Readonly<{ feature: UiThemeFeatureMap['playlists']; suspended?: boolean }>,
  grid: ShallowRef<HTMLElement | null>,
) {
  const state = computed(() => props.feature.state)
  const collection = usePlaylistCollection({
    playlists: () => state.value.playlists,
    customTagsByPlaylistId: () => state.value.customTagsByPlaylistId ?? new Map(),
  })
  const ids = computed(() => collection.visible.value.map(({ id }) => id))
  const compact = useClassicCompactControls(grid, () => state.value.mobileLayout)
  const displayOpen = shallowRef(false)
  const confirm = useConfirmAction()
  const activity = usePresentationActivity()
  const busy = shallowRef(false)
  const error = shallowRef('')
  const available = () =>
    props.feature.availability.status === 'available' && !busy.value && !props.suspended
  const reorder = useQueueReorder({
    arrangementMode: 'flat',
    trackIds: ids,
    platformIds: [],
    scrollElement: grid,
    getPlatformId: () => undefined,
    movePlatform: () => {},
    moveTrack: (id, target, visible) => {
      if (available())
        props.feature.actions.reorderPlaylists(
          reorderVisiblePlaylists(
            state.value.playlists.map((playlist) => playlist.id),
            id,
            target,
            visible,
          ),
        )
    },
  })
  const modalOpen = computed(() => displayOpen.value || collection.draft.value !== null)
  // A fresh host projection must not cancel its own committed landing. Direct shallowRef
  // sources force this multi-source watcher even when all displayed values are unchanged.
  watch(
    [
      () => modalOpen.value,
      () => collection.operatorOpen.value,
      () => state.value.displayMode,
      () => state.value.mobileColumns,
      () => props.feature.availability.status,
      () => props.suspended,
    ],
    reorder.clearDrag,
  )
  onDeactivated(reorder.clearDrag)
  async function removeSelected() {
    if (!available() || !collection.selected.value.length) return
    const selectedPlaylistIds = collection.selected.value.map(({ id }) => id)
    const current = activity.checkpoint()
    const accepted = await confirm({
      title: '删除已选歌单',
      message: `确定删除 ${selectedPlaylistIds.length} 个歌单吗？歌曲和“我的喜欢”不会被删除。`,
      tone: 'danger',
    })
    if (!accepted || !current() || !available()) return
    busy.value = true
    error.value = ''
    try {
      await props.feature.actions.remove(selectedPlaylistIds)
    } catch (cause) {
      if (current()) error.value = playlistEditorErrorMessage(cause)
    } finally {
      if (current()) busy.value = false
    }
  }
  async function downloadSelected() {
    const selectedSongIds = [...collection.selectedTrackIds.value]
    if (!available() || state.value.downloadBusy || !selectedSongIds.length) return
    const current = activity.checkpoint()
    if (
      await confirm({
        title: '下载歌单歌曲',
        message: `确定下载已选歌单中的 ${selectedSongIds.length} 首歌曲吗？重复歌曲只下载一次。`,
      })
    ) {
      if (current() && available() && !state.value.downloadBusy) {
        error.value = ''
        try {
          await props.feature.actions.download(selectedSongIds)
        } catch (cause) {
          if (current()) error.value = playlistEditorErrorMessage(cause)
        }
      }
    }
  }
  return {
    state,
    collection,
    ids,
    compact,
    displayOpen,
    modalOpen,
    reorder,
    busy,
    error,
    available,
    removeSelected,
    downloadSelected,
  }
}
