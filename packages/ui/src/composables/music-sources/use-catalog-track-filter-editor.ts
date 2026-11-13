import { computed, readonly, shallowRef, toValue } from 'vue'
import type { MaybeRefOrGetter, Ref } from 'vue'

import {
  commitCatalogTrackFilterDimension,
  readCatalogTrackDurationMinutes,
  type CatalogTrackFilterDimension,
} from '../../components/music-sources/catalog-track-filter-presentation'
import { editingStateKey, useEditingSession } from '../use-editing-session'
import type { EditingSession } from '../use-editing-session'
import { getCatalogCalendarToday, isCatalogCalendarDate } from './catalog-filter-calendar'
import type { CatalogFilterHistoryEntry } from './use-catalog-filter-history'
import type { CatalogTrackFilterState } from './use-catalog-track-filters'

interface CatalogTrackFilterEditorOptions {
  filters: Ref<CatalogTrackFilterState>
  dimension: MaybeRefOrGetter<CatalogTrackFilterDimension>
  initialIndex?: number
  /** Explicit owner for layouts that compose the editor in the providing component itself. */
  editing?: EditingSession
}

/** 隔离编辑器的起止阶段、单条修改和历史恢复；任何动作都只更新外层提供的草稿。 */
export function useCatalogTrackFilterEditor(options: CatalogTrackFilterEditorOptions) {
  const filters = options.filters
  const state = (options.editing ?? useEditingSession())
    .scope('range-editor')
    .state(rangeEditorKey, createRangeEditorState)
  const {
    publishedStage,
    pendingStart,
    pendingEnd,
    calendarMonth,
    minimumMinutes,
    maximumMinutes,
    editingIndex,
    hasPendingPublishedRange,
    errorMessage,
  } = state
  const searchQuery = computed({
    get: () => filters.value.searchFilters[0]?.query ?? '',
    set: (query: string) => {
      filters.value = { ...filters.value, searchFilters: query.trim() ? [{ query }] : [] }
    },
  })
  const canAddPublishedRange = computed(
    () =>
      isCatalogCalendarDate(pendingStart.value) &&
      isCatalogCalendarDate(pendingEnd.value) &&
      pendingEnd.value >= pendingStart.value,
  )
  const hasPendingDurationRange = computed(() =>
    Boolean(minimumMinutes.value.trim() || maximumMinutes.value.trim()),
  )
  const durationError = computed(() => {
    const minMs = readCatalogTrackDurationMinutes(minimumMinutes.value)
    const maxMs = readCatalogTrackDurationMinutes(maximumMinutes.value)
    if (
      (minimumMinutes.value.trim() && minMs === undefined) ||
      (maximumMinutes.value.trim() && maxMs === undefined)
    )
      return '请输入有效的非负分钟数。'
    return minMs !== undefined && maxMs !== undefined && minMs > maxMs
      ? '最长时长不能小于最短时长。'
      : ''
  })
  const canAddDurationRange = computed(() => hasPendingDurationRange.value && !durationError.value)

  /** 合法的待添加/待更新区间也参与预览，但不写入草稿或历史；不完整输入沿用已选条件。 */
  const previewFilters = computed(() => {
    const dimension = toValue(options.dimension)
    if (dimension === 'published' && hasPendingPublishedRange.value && canAddPublishedRange.value)
      return createPublishedRangeDraft()
    if (dimension === 'duration' && canAddDurationRange.value) return createDurationRangeDraft()
    return filters.value
  })

  function resetPendingRange(): void {
    editingIndex.value = undefined
    hasPendingPublishedRange.value = false
    pendingStart.value = getCatalogCalendarToday()
    calendarMonth.value = pendingStart.value.slice(0, 7)
    pendingEnd.value = ''
    publishedStage.value = 'start'
    minimumMinutes.value = ''
    maximumMinutes.value = ''
    errorMessage.value = ''
  }

  function selectPublishedDate(date: string): void {
    if (
      !isCatalogCalendarDate(date) ||
      (publishedStage.value === 'end' && date < pendingStart.value) ||
      (publishedStage.value === 'start' && pendingEnd.value && date > pendingEnd.value)
    )
      return
    // 只修改当前端点；跨越另一端点的日期由日历禁用，不能悄悄联动改写用户已选值。
    if (publishedStage.value === 'start') pendingStart.value = date
    else pendingEnd.value = date
    calendarMonth.value = date.slice(0, 7)
    hasPendingPublishedRange.value = true
    errorMessage.value = ''
  }

  /** 首次设置结束默认同一天；之后切换端点只定位日历，不改写另一端点。 */
  function setPublishedStage(stage: 'start' | 'end'): void {
    publishedStage.value = stage
    if (stage === 'end' && (!pendingEnd.value || pendingEnd.value < pendingStart.value))
      pendingEnd.value = pendingStart.value
    calendarMonth.value = (stage === 'start' ? pendingStart.value : pendingEnd.value).slice(0, 7)
    hasPendingPublishedRange.value = true
    errorMessage.value = ''
  }

  function editRange(index: number, source = filters.value): void {
    resetPendingRange()
    if (toValue(options.dimension) === 'published') {
      const range = source.publishedRanges[index]
      if (!range) return
      pendingStart.value = range.from || range.to || getCatalogCalendarToday()
      pendingEnd.value = range.to
      calendarMonth.value = (range.to || pendingStart.value).slice(0, 7)
      publishedStage.value = range.to ? 'end' : 'start'
      hasPendingPublishedRange.value = true
    } else if (toValue(options.dimension) === 'duration') {
      const range = source.durationRanges[index]
      if (!range) return
      minimumMinutes.value = formatDurationInput(range.minMs)
      maximumMinutes.value = formatDurationInput(range.maxMs)
    }
    editingIndex.value = index
  }

  /** 预览与提交共用同一快照生成规则，修改原条目时保留同组其他区间并去重。 */
  function createPublishedRangeDraft(): CatalogTrackFilterState {
    const ranges = [...filters.value.publishedRanges]
    const range = { from: pendingStart.value, to: pendingEnd.value }
    if (editingIndex.value !== undefined) ranges[editingIndex.value] = range
    else ranges.push(range)
    return commitCatalogTrackFilterDimension(
      filters.value,
      { ...filters.value, publishedRanges: ranges },
      'published',
    )
  }

  function createDurationRangeDraft(): CatalogTrackFilterState {
    const ranges = [...filters.value.durationRanges]
    const range = {
      minMs: readCatalogTrackDurationMinutes(minimumMinutes.value),
      maxMs: readCatalogTrackDurationMinutes(maximumMinutes.value),
    }
    if (editingIndex.value !== undefined) ranges[editingIndex.value] = range
    else ranges.push(range)
    return commitCatalogTrackFilterDimension(
      filters.value,
      { ...filters.value, durationRanges: ranges },
      'duration',
    )
  }

  function addPublishedRange(): boolean {
    if (!canAddPublishedRange.value) {
      errorMessage.value = '请设置结束日期，结束日期不能早于起始日期。'
      return false
    }
    filters.value = createPublishedRangeDraft()
    resetPendingRange()
    return true
  }

  function addDurationRange(): boolean {
    if (!canAddDurationRange.value) {
      errorMessage.value = durationError.value || '请填写最短或最长时长。'
      return false
    }
    filters.value = createDurationRangeDraft()
    resetPendingRange()
    return true
  }

  function removeRange(index: number): void {
    const dimension = toValue(options.dimension)
    if (dimension === 'published')
      filters.value = {
        ...filters.value,
        publishedRanges: filters.value.publishedRanges.filter(
          (_, rangeIndex) => rangeIndex !== index,
        ),
      }
    else if (dimension === 'duration')
      filters.value = {
        ...filters.value,
        durationRanges: filters.value.durationRanges.filter(
          (_, rangeIndex) => rangeIndex !== index,
        ),
      }
    if (editingIndex.value === index) resetPendingRange()
    else if (editingIndex.value !== undefined && editingIndex.value > index) editingIndex.value -= 1
  }

  function restoreHistory(entry: CatalogFilterHistoryEntry): void {
    if (entry.dimension !== toValue(options.dimension)) return
    const restored = commitCatalogTrackFilterDimension(
      filters.value,
      entry.filters,
      entry.dimension,
    )
    filters.value = restored
    resetPendingRange()
    // 历史是整组替换；同时带入第一个区间，让用户可以立即继续调整它。
    // 受控 v-model 的 props 要到下一帧才回流，因此从刚恢复的快照读取控件值。
    if (entry.dimension === 'published' || entry.dimension === 'duration') editRange(0, restored)
  }

  /** 底部确定同样提交尚未加入的合法输入，错误时保持编辑器打开，避免静默丢失输入。 */
  function confirmDraft(): boolean {
    const dimension = toValue(options.dimension)
    if (dimension === 'published' && hasPendingPublishedRange.value) return addPublishedRange()
    if (dimension === 'duration' && hasPendingDurationRange.value) return addDurationRange()
    return true
  }

  if (
    !state.initialized &&
    options.initialIndex !== undefined &&
    (toValue(options.dimension) === 'published' || toValue(options.dimension) === 'duration')
  )
    editRange(options.initialIndex)
  state.initialized = true

  return {
    previewFilters,
    searchQuery,
    pendingStart: readonly(pendingStart),
    pendingEnd: readonly(pendingEnd),
    publishedStage: readonly(publishedStage),
    calendarMonth,
    minimumMinutes,
    maximumMinutes,
    editingIndex: readonly(editingIndex),
    errorMessage: readonly(errorMessage),
    durationError,
    canAddPublishedRange,
    canAddDurationRange,
    selectPublishedDate,
    setPublishedStage,
    editRange,
    addPublishedRange,
    addDurationRange,
    removeRange,
    restoreHistory,
    confirmDraft,
    resetPendingRange,
  }
}

function formatDurationInput(durationMs: number | undefined): string {
  return durationMs === undefined ? '' : String(durationMs / 60_000)
}

function createRangeEditorState() {
  const publishedStage = shallowRef<'start' | 'end'>('start')
  const pendingStart = shallowRef(getCatalogCalendarToday())
  const pendingEnd = shallowRef('')
  const calendarMonth = shallowRef(pendingStart.value.slice(0, 7))
  const minimumMinutes = shallowRef('')
  const maximumMinutes = shallowRef('')
  const editingIndex = shallowRef<number>()
  const hasPendingPublishedRange = shallowRef(false)
  const errorMessage = shallowRef('')

  return {
    initialized: false,
    publishedStage,
    pendingStart,
    pendingEnd,
    calendarMonth,
    minimumMinutes,
    maximumMinutes,
    editingIndex,
    hasPendingPublishedRange,
    errorMessage,
  }
}
const rangeEditorKey = editingStateKey<ReturnType<typeof createRangeEditorState>>('range-editor')
