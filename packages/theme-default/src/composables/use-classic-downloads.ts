import {
  getDownloadListEntries,
  useConfirmAction,
  filterQueueTracks,
  provideTrackNames,
  useEditingSession,
  provideEditingSession,
} from '@any-music/ui/library'
import type { UiThemeFeatureMap } from '@any-music/ui/theme'
import { computed } from 'vue'

import { usePresentationActivity } from './use-presentation-activity'

/** Task projections and actions only; never admits, reads, saves or persists a download. */
export function useClassicDownloads(props: { readonly feature: UiThemeFeatureMap['downloads'] }) {
  provideEditingSession(useEditingSession('downloads:tracks'))
  const state = computed(() => props.feature.state)
  provideTrackNames(computed(() => state.value.customNamesByTrackId))
  const entries = computed(() => getDownloadListEntries(state.value.batches, state.value.itemOrder))
  const counts = computed(() => {
    const result = { all: entries.value.length, downloading: 0, paused: 0, succeeded: 0, failed: 0 }
    for (const entry of entries.value) result[entry.state] += 1
    return result
  })
  const filteredIds = computed(
    () =>
      new Set(
        filterQueueTracks(
          entries.value.map(({ item }) => item.track),
          state.value.filters,
          state.value.addedAtMsByTrackId,
          state.value.customNamesByTrackId,
          state.value.customTagsByTrackId,
        ).map(({ id }) => id),
      ),
  )
  const visible = computed(() =>
    entries.value.filter(
      (entry) =>
        filteredIds.value.has(entry.item.track.id) &&
        (state.value.statusFilter === 'all' || entry.state === state.value.statusFilter),
    ),
  )
  const selected = computed(() => new Set(state.value.selectedItemIds))
  const selection = computed(() => entries.value.filter(({ item }) => selected.value.has(item.id)))
  const pausable = computed(() =>
    selection.value
      .filter((entry) => entry.state === 'downloading' && !entry.saving)
      .map(({ item }) => item.id),
  )
  const resumable = computed(() =>
    selection.value
      .filter(
        (entry) =>
          entry.state === 'paused' && !state.value.invalidTrackIds.includes(entry.item.track.id),
      )
      .map(({ item }) => item.id),
  )
  const retryable = computed(() =>
    selection.value
      .filter(
        (entry) =>
          (entry.state === 'failed' || entry.state === 'succeeded') &&
          !entry.saving &&
          !state.value.invalidTrackIds.includes(entry.item.track.id),
      )
      .map(({ item }) => item.id),
  )
  const removable = computed(() =>
    selection.value
      .filter((entry) => entry.state !== 'downloading' && !entry.saving)
      .map(({ item }) => item.id),
  )
  const allSelected = computed(
    () =>
      visible.value.length > 0 && visible.value.every(({ item }) => selected.value.has(item.id)),
  )
  const confirm = useConfirmAction(),
    activity = usePresentationActivity()
  const filters = computed(() => ({ ...state.value, selectedTrackIds: [] }))
  const statuses = [
    { id: 'all', name: '全部' },
    { id: 'downloading', name: '下载中' },
    { id: 'paused', name: '已暂停' },
    { id: 'succeeded', name: '已下载' },
    { id: 'failed', name: '下载失败' },
  ] as const
  function select(id: string) {
    const ids = new Set(state.value.selectedItemIds)
    if (ids.has(id)) ids.delete(id)
    else ids.add(id)
    props.feature.actions.select([...ids])
  }
  function toggleAll() {
    const ids = new Set(state.value.selectedItemIds)
    for (const { item } of visible.value) {
      if (allSelected.value) ids.delete(item.id)
      else ids.add(item.id)
    }
    props.feature.actions.select([...ids])
  }
  function resume(id: string) {
    if (props.feature.availability.status !== 'available') return
    const entry = entries.value.find(({ item }) => item.id === id)
    if (!entry || entry.saving || state.value.invalidTrackIds.includes(entry.item.track.id)) return
    if (entry.state === 'paused') void props.feature.actions.resume([id])
    else if (entry.state === 'failed' || entry.state === 'succeeded')
      void props.feature.actions.retry([id])
  }
  async function remove(itemIds: readonly string[] = removable.value) {
    const allowed = new Set(
      entries.value
        .filter((entry) => entry.state !== 'downloading' && !entry.saving)
        .map((entry) => entry.item.id),
    )
    const ids = itemIds.filter((id) => allowed.has(id))
    if (!ids.length) return
    const isCurrent = activity.checkpoint()
    if (
      await confirm({
        title: '移除下载记录',
        message: `移除已选的 ${ids.length} 条下载记录？已保存的文件会保留。`,
        tone: 'danger',
      })
    )
      if (isCurrent() && props.feature.availability.status === 'available')
        await props.feature.actions.remove(ids)
  }

  return {
    state,
    entries,
    counts,
    visible,
    selected,
    selection,
    pausable,
    resumable,
    retryable,
    removable,
    allSelected,
    filters,
    statuses,
    select,
    toggleAll,
    resume,
    remove,
  }
}
