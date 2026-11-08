import { createAppErrorState, formatAppErrorMessage, toAppErrorState } from '@any-music/core'
import type { AppErrorState } from '@any-music/core'
import { computed, onScopeDispose, reactive, readonly, watch } from 'vue'

import {
  getCatalogFilterDimensions,
  type CatalogFilterContext,
} from '../../components/music-sources/catalog-track-filter-presentation'
import {
  getActionSuccessMessage,
  getFilterHistorySavedMessage,
} from '../../product/action-feedback'
import { FILTER_HISTORY_SETTINGS_GROUPS } from '../../product/filter-history-settings'
import { editingStateKey, useEditingSession } from '../use-editing-session'
import { useSettingsFeedback } from '../use-settings-feedback'
import {
  MAX_CATALOG_FILTER_HISTORY_LIMIT,
  type CatalogFilterHistoryPreferences,
  type CatalogFilterHistorySettings,
} from './catalog-filter-history-settings'
import { useCatalogFilterHistory } from './use-catalog-filter-history'

export interface CatalogFilterHistoryPreferencesDraft {
  limits: Record<keyof CatalogFilterHistoryPreferences['limits'], number | string>
  collapseAfter: number | string
}

/** 区域独立校验和保存；修改一个区域不会应用或覆盖其他区域的会话草稿。 */
export function useCatalogFilterHistorySettings(options?: {
  settings: () => CatalogFilterHistorySettings | undefined
  save: (settings: CatalogFilterHistorySettings) => AppErrorState | void
}) {
  const injectedHistory = options ? undefined : useCatalogFilterHistory()
  const settings = computed(() => options?.settings() ?? injectedHistory!.settings.value)
  const session = useEditingSession('settings')
  let active = true
  onScopeDispose(() => (active = false))
  const showFeedback = useSettingsFeedback()
  const contexts = FILTER_HISTORY_SETTINGS_GROUPS.flatMap((group) =>
    group.regions.map((region) => region.context),
  )
  const regions = session.state(regionsKey, () =>
    reactive({
      drawers: createDraft(getPreferences(settings.value, 'drawers')),
      tracks: createDraft(getPreferences(settings.value, 'tracks')),
      queue: createDraft(getPreferences(settings.value, 'queue')),
      favorites: createDraft(getPreferences(settings.value, 'favorites')),
      downloads: createDraft(getPreferences(settings.value, 'downloads')),
    }),
  )
  const feedbackByContext = session.state(feedbackKey, () =>
    reactive({
      drawers: { statusMessage: '', errorMessage: '' },
      tracks: { statusMessage: '', errorMessage: '' },
      queue: { statusMessage: '', errorMessage: '' },
      favorites: { statusMessage: '', errorMessage: '' },
      downloads: { statusMessage: '', errorMessage: '' },
    }),
  )

  watch(
    settings,
    (current, previous) => {
      for (const context of contexts) {
        const next = getPreferences(current, context)
        const saved = getPreferences(previous, context)
        if (
          next.collapseAfter !== saved.collapseAfter ||
          getCatalogFilterDimensions(context).some(({ id }) => next.limits[id] !== saved.limits[id])
        ) {
          regions[context] = createDraft(next)
        }
      }
    },
    { flush: 'sync' },
  )
  for (const context of contexts) {
    watch(
      () => regions[context],
      () => {
        feedbackByContext[context].statusMessage = ''
        feedbackByContext[context].errorMessage = ''
      },
      { deep: true, flush: 'sync' },
    )
  }

  const hasUnsavedChangesByContext = computed(() => ({
    drawers: hasUnsavedChanges('drawers'),
    tracks: hasUnsavedChanges('tracks'),
    queue: hasUnsavedChanges('queue'),
    favorites: hasUnsavedChanges('favorites'),
    downloads: hasUnsavedChanges('downloads'),
  }))
  const summariesByContext = computed(() => ({
    drawers: getSummary('drawers'),
    tracks: getSummary('tracks'),
    queue: getSummary('queue'),
    favorites: getSummary('favorites'),
    downloads: getSummary('downloads'),
  }))

  function hasUnsavedChanges(context: CatalogFilterContext): boolean {
    const saved = getPreferences(settings.value, context)
    const draft = regions[context]
    return (
      readCount(draft.collapseAfter, 1) !== saved.collapseAfter ||
      getCatalogFilterDimensions(context).some(
        ({ id }) => readCount(draft.limits[id], 0) !== saved.limits[id],
      )
    )
  }

  function getSummary(context: CatalogFilterContext) {
    const saved = getPreferences(settings.value, context)
    return {
      dimensionCount: getCatalogFilterDimensions(context).length,
      collapseAfter: saved.collapseAfter,
    }
  }

  function submitSettings(context: CatalogFilterContext): void {
    if (!active || !session.active) return
    const region = FILTER_HISTORY_SETTINGS_GROUPS.flatMap((group) => group.regions).find(
      (candidate) => candidate.context === context,
    )
    if (!region) return
    const draft = regions[context]
    const feedback = feedbackByContext[context]
    feedback.statusMessage = ''
    feedback.errorMessage = ''
    function reportInvalidInput(message: string): void {
      feedback.errorMessage = message
      showFeedback({ status: 'error', error: createAppErrorState('invalid-input', message) })
    }
    const nextLimits = { ...getPreferences(settings.value, context).limits }
    for (const dimension of getCatalogFilterDimensions(context)) {
      const count = readCount(draft.limits[dimension.id], 0)
      if (count === undefined) {
        reportInvalidInput(
          `${region.title} · ${dimension.label}：保留数量须为 0 至 ${MAX_CATALOG_FILTER_HISTORY_LIMIT} 的整数。`,
        )
        return
      }
      nextLimits[dimension.id] = count
    }
    const collapseAfter = readCount(draft.collapseAfter, 1)
    if (collapseAfter === undefined) {
      reportInvalidInput(
        `${region.title}：默认显示数量须为 1 至 ${MAX_CATALOG_FILTER_HISTORY_LIMIT} 的整数。`,
      )
      return
    }
    const preferences = { limits: nextLimits, collapseAfter }
    // 完整校验当前区域后才裁剪其历史；未编辑的区域按原值保存。
    let error: AppErrorState | void
    try {
      const next = {
        ...settings.value,
        contexts: { ...settings.value.contexts, [context]: preferences },
      }
      error = options ? options.save(next) : injectedHistory!.setSettings(next)
    } catch (cause) {
      error = toAppErrorState(cause, 'storage-write-failed', '筛选历史设置保存失败。')
    }
    regions[context] = createDraft(preferences)
    if (error) {
      feedback.errorMessage = formatAppErrorMessage(error)
      showFeedback({ status: 'error', error })
      return
    }
    feedback.statusMessage = getActionSuccessMessage('filterHistorySettings')
    feedback.errorMessage = ''
    showFeedback({ status: 'success', message: getFilterHistorySavedMessage(region.title) })
  }

  return {
    regions,
    feedbackByContext: readonly(feedbackByContext),
    hasUnsavedChangesByContext,
    summariesByContext,
    submitSettings,
  }
}

const regionsKey = editingStateKey<
  Record<CatalogFilterContext, CatalogFilterHistoryPreferencesDraft>
>('settings:filter-history-regions')
const feedbackKey = editingStateKey<
  Record<CatalogFilterContext, { statusMessage: string; errorMessage: string }>
>('settings:filter-history-feedback')

function getPreferences(settings: CatalogFilterHistorySettings, context: CatalogFilterContext) {
  return settings.contexts?.[context] ?? settings
}

function createDraft(
  preferences: CatalogFilterHistoryPreferences,
): CatalogFilterHistoryPreferencesDraft {
  return { limits: { ...preferences.limits }, collapseAfter: preferences.collapseAfter }
}

function readCount(input: number | string, minimum: number): number | undefined {
  if (typeof input === 'string' && !input.trim()) return undefined
  const count = Number(input)
  return Number.isInteger(count) && count >= minimum && count <= MAX_CATALOG_FILTER_HISTORY_LIMIT
    ? count
    : undefined
}
