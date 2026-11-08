import { computed, ref, shallowRef } from 'vue'

import { editingStateKey, useEditingSession } from '../use-editing-session'
import type { EditingSession } from '../use-editing-session'
import { createPlaylistOverviewFilters } from './use-playlist-collection'
import type { PlaylistOverviewFilters, PlaylistTrackCountRange } from './use-playlist-collection'

export type PlaylistOverviewFilterDimension = 'keyword' | 'trackCountRanges' | 'tags' | 'cover'

export function readPlaylistTrackCount(input: string): number | undefined {
  const text = input.trim()
  const count = Number(text)
  return /^\d+$/.test(text) && Number.isSafeInteger(count) && count > 0 ? count : undefined
}

export function formatPlaylistTrackCountRange(range: PlaylistTrackCountRange): string {
  if (range.minCount === undefined) return `不超过 ${range.maxCount} 首`
  if (range.maxCount === undefined) return `不少于 ${range.minCount} 首`
  if (range.minCount === range.maxCount) return `${range.minCount} 首`
  return `${range.minCount}–${range.maxCount} 首`
}

function createFilterEditorState() {
  return {
    active: shallowRef<PlaylistOverviewFilterDimension | null>(null),
    previous: shallowRef<PlaylistOverviewFilterDimension>('keyword'),
    local: ref(createPlaylistOverviewFilters()),
    tagQuery: shallowRef(''),
    minimumCount: shallowRef(''),
    maximumCount: shallowRef(''),
    editingIndex: shallowRef<number>(),
  }
}
const filterEditorKey = editingStateKey<ReturnType<typeof createFilterEditorState>>(
  'playlist-overview-filter-editor',
)

/** Keep pending range input separate from the dimension draft and retain it across presentation changes. */
export function usePlaylistOverviewFilterEditor(
  editing: EditingSession = useEditingSession('playlist-overview'),
) {
  const state = editing.state(filterEditorKey, createFilterEditorState)
  const { local, minimumCount, maximumCount, editingIndex } = state
  const hasPendingRange = computed(() =>
    Boolean(minimumCount.value.trim() || maximumCount.value.trim()),
  )
  const countError = computed(() => {
    const min = readPlaylistTrackCount(minimumCount.value)
    const max = readPlaylistTrackCount(maximumCount.value)
    if (
      (minimumCount.value.trim() && min === undefined) ||
      (maximumCount.value.trim() && max === undefined)
    )
      return '请输入有效的正整数。'
    return min !== undefined && max !== undefined && min > max
      ? '最多歌曲数量不能小于最少歌曲数量。'
      : ''
  })
  const canAddRange = computed(() => hasPendingRange.value && !countError.value)
  function resetPendingRange() {
    minimumCount.value = ''
    maximumCount.value = ''
    editingIndex.value = undefined
  }
  function createRangeDraft(): PlaylistOverviewFilters {
    const ranges = [...local.value.trackCountRanges]
    const range = {
      minCount: readPlaylistTrackCount(minimumCount.value),
      maxCount: readPlaylistTrackCount(maximumCount.value),
    }
    if (editingIndex.value === undefined) ranges.push(range)
    else ranges[editingIndex.value] = range
    return {
      ...local.value,
      trackCountRanges: ranges.filter(
        (item, index) =>
          ranges.findIndex(
            (candidate) =>
              candidate.minCount === item.minCount && candidate.maxCount === item.maxCount,
          ) === index,
      ),
    }
  }
  const preview = computed(() =>
    state.active.value === 'trackCountRanges' && canAddRange.value
      ? createRangeDraft()
      : local.value,
  )
  function addRange(): boolean {
    if (!canAddRange.value) return false
    local.value = createRangeDraft()
    resetPendingRange()
    return true
  }
  function editRange(index: number) {
    const range = local.value.trackCountRanges[index]
    if (!range) return
    minimumCount.value = range.minCount === undefined ? '' : String(range.minCount)
    maximumCount.value = range.maxCount === undefined ? '' : String(range.maxCount)
    editingIndex.value = index
  }
  function removeRange(index: number) {
    local.value = {
      ...local.value,
      trackCountRanges: local.value.trackCountRanges.filter((_, candidate) => candidate !== index),
    }
    if (editingIndex.value === index) resetPendingRange()
    else if (editingIndex.value !== undefined && editingIndex.value > index) editingIndex.value -= 1
  }
  function confirmDraft(): boolean {
    return state.active.value !== 'trackCountRanges' || !hasPendingRange.value || addRange()
  }
  return {
    ...state,
    preview,
    countError,
    canAddRange,
    resetPendingRange,
    addRange,
    editRange,
    removeRange,
    confirmDraft,
  }
}
