import type { MusicPlaylist, Track } from '@any-music/core'
import { computed, onScopeDispose, toValue, watch } from 'vue'
import type { MaybeRefOrGetter } from 'vue'

import { getPlaylistAlreadyAddedMessage } from '../../product/action-feedback'
import { usePlaylistPickerOpen } from '../library/use-playlist-picker'
import { useActionFeedback } from '../use-action-feedback'
import { useConfirmAction } from '../use-confirmation-dialog'
import type { EditingSession } from '../use-editing-session'

/** 三种歌曲集合共用批量确认与去重；事实数据和写入结果由业务容器提供。 */
export function useTrackBatchActions(options: {
  tracks: MaybeRefOrGetter<readonly Track[]>
  queueTracks: MaybeRefOrGetter<readonly Track[]>
  queuedTrackIds: MaybeRefOrGetter<ReadonlySet<string>>
  favoriteTrackIds: MaybeRefOrGetter<ReadonlySet<string>>
  downloadedTrackIds: MaybeRefOrGetter<ReadonlySet<string>>
  playlists: MaybeRefOrGetter<readonly MusicPlaylist[]>
  downloadBusy: MaybeRefOrGetter<boolean>
  active: MaybeRefOrGetter<boolean>
  pickerEditing?: EditingSession
  /** Stable collection identity, including when two requests contain the same tracks. */
  contextKey?: MaybeRefOrGetter<string | null>
  clearSelection: () => void
  addToQueue: (tracks: readonly Track[]) => void
  addToFavorites: (tracks: readonly Track[]) => void
  download: (tracks: readonly Track[]) => void
  addToPlaylist: (playlistId: string, tracks: readonly Track[]) => void
}) {
  const confirm = useConfirmAction()
  const showFeedback = useActionFeedback()
  const isPlaylistPickerOpen = usePlaylistPickerOpen(options.pickerEditing)
  const tracks = computed(() => toValue(options.tracks))
  const areAllSelectedQueued = computed(
    () =>
      tracks.value.length > 0 &&
      tracks.value.every((track) => toValue(options.queuedTrackIds).has(track.id)),
  )
  const areAllSelectedFavorited = computed(
    () =>
      tracks.value.length > 0 &&
      tracks.value.every((track) => toValue(options.favoriteTrackIds).has(track.id)),
  )
  // 选择或页面变化后，尚未结束的确认不能提交到新的歌曲集合。
  const selectionKey = computed(() => JSON.stringify(tracks.value.map((track) => track.id)))
  let generation = 0
  watch(
    [selectionKey, () => toValue(options.active), () => toValue(options.contextKey)],
    () => {
      generation += 1
      isPlaylistPickerOpen.value = false
    },
    { flush: 'sync' },
  )
  onScopeDispose(() => {
    generation += 1
  })

  async function addSelectedToQueue(): Promise<void> {
    if (!toValue(options.active) || areAllSelectedQueued.value || !tracks.value.length) return
    const currentGeneration = generation
    const confirmed = await confirm({
      title: '添加到待听',
      message: `确定将已选的 ${tracks.value.length} 首歌曲添加到“待听”吗？已有歌曲会保持原位，新歌曲按勾选顺序添加。`,
      confirmLabel: `添加 ${tracks.value.length} 首`,
    })
    if (!confirmed || currentGeneration !== generation) return
    const pending = toValue(options.queueTracks).filter(
      (track) => !toValue(options.queuedTrackIds).has(track.id),
    )
    if (!pending.length) return
    options.addToQueue(pending)
    options.clearSelection()
  }

  async function addSelectedToFavorites(): Promise<void> {
    if (!toValue(options.active) || areAllSelectedFavorited.value || !tracks.value.length) return
    const currentGeneration = generation
    const confirmed = await confirm({
      title: '添加到我的喜欢',
      message: `确定将已选的 ${tracks.value.length} 首歌曲添加到“我的喜欢”吗？已喜欢的歌曲会保持不变。`,
      confirmLabel: `添加 ${tracks.value.length} 首`,
    })
    if (!confirmed || currentGeneration !== generation) return
    const pending = tracks.value.filter((track) => !toValue(options.favoriteTrackIds).has(track.id))
    if (!pending.length) return
    options.addToFavorites(pending)
    options.clearSelection()
  }

  async function downloadSelected(): Promise<void> {
    if (!toValue(options.active) || !tracks.value.length || toValue(options.downloadBusy)) return
    const pending = [...new Map(tracks.value.map((track) => [track.id, track])).values()]
    const currentGeneration = generation
    const confirmed = await confirm({
      title: '下载已选歌曲',
      message: `确定开始下载已选的 ${pending.length} 首歌曲吗？已下载的歌曲也可重新下载；支持保存目录校验时，名称和内容均一致的文件将跳过。可在“下载”查看进度。`,
      confirmLabel: `下载 ${pending.length} 首`,
    })
    if (!confirmed || currentGeneration !== generation || toValue(options.downloadBusy)) return
    options.download(pending)
    options.clearSelection()
  }

  function requestAddSelectedToPlaylist(): void {
    if (toValue(options.active) && tracks.value.length) isPlaylistPickerOpen.value = true
  }

  function addSelectedToPlaylist(playlistIds: readonly string[]): void {
    if (!isPlaylistPickerOpen.value || !toValue(options.active) || !tracks.value.length) return
    const selected = [...new Map(tracks.value.map((track) => [track.id, track])).values()]
    const targets = [...new Set(playlistIds)].flatMap(
      (id) => toValue(options.playlists).find((playlist) => playlist.id === id) ?? [],
    )
    if (!targets.length) return
    let added = false
    for (const target of targets) {
      const pending = selected.filter((track) => !target.trackIds.includes(track.id))
      if (!pending.length) continue
      options.addToPlaylist(target.id, pending)
      added = true
    }
    if (!added) {
      showFeedback({
        status: 'info',
        message:
          targets.length === 1
            ? getPlaylistAlreadyAddedMessage(targets[0]!.name)
            : '已选歌曲均已加入勾选的歌单，无需重复添加。',
      })
      return
    }
    options.clearSelection()
    isPlaylistPickerOpen.value = false
  }

  return {
    areAllSelectedQueued,
    areAllSelectedFavorited,
    isPlaylistPickerOpen,
    addSelectedToQueue,
    addSelectedToFavorites,
    downloadSelected,
    requestAddSelectedToPlaylist,
    addSelectedToPlaylist,
  }
}
