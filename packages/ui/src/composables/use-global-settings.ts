import type {
  AppErrorState,
  LibraryUserProfile,
  MusicSourceAvailability,
  MusicSourceDescriptor,
} from '@any-music/core'
import {
  MAX_DOWNLOAD_CONCURRENCY,
  MAX_PLAYBACK_HISTORY_LIMIT,
  MIN_DOWNLOAD_CONCURRENCY,
  MIN_PLAYBACK_HISTORY_LIMIT,
  AppError,
  formatAppErrorMessage,
  toAppErrorState,
} from '@any-music/core'
import { computed, onScopeDispose, shallowRef, watch } from 'vue'
import type { ShallowRef, VNodeChild } from 'vue'

import type {
  ResourceCacheSettingsContext,
  SettingsDetailContext,
} from '../product/settings-detail-context'
import type { SettingsSectionId } from '../product/settings-navigation'
import type { CatalogFilterHistorySettings } from './music-sources/catalog-filter-history-settings'
import { editingStateKey, useEditingSession } from './use-editing-session'
import { useSettingsFeedback } from './use-settings-feedback'

export interface GlobalSettingsProps {
  plugins: readonly { readonly descriptor: MusicSourceDescriptor }[]
  availabilityByPluginId: Readonly<Record<string, MusicSourceAvailability>>
  enabledPluginIds: readonly string[]
  externalSourcesEnabled?: boolean
  profile: LibraryUserProfile
  historyLimit: number
  downloadConcurrency: number
  isMobileLayout?: boolean
  initialSection?: SettingsSectionId | null
  /** 运行端只提供状态摘要，不把代理模型或凭证暴露给共享 UI。 */
  networkSummary?: string
  accountSummary?: string
  networkTitle?: string
  networkDescription?: string
  appearanceSummary?: string
  /** 子配置浮层留在运行端提供的产品根宿主，避免被设置子页裁切。 */
  overlayTarget?: HTMLElement | null
  suspended?: boolean
  filterHistorySettings?: CatalogFilterHistorySettings
  setFilterHistorySettings?: (settings: CatalogFilterHistorySettings) => AppErrorState | void
  displayDefaults?: import('../product/track-display-preferences').CollectionDisplayDefaults
  setDisplayDefault?: import('../product/track-display-preferences').SetCollectionDisplayDefault
}

export interface GlobalSettingsSlots {
  'cache-settings'?: (context: ResourceCacheSettingsContext) => VNodeChild
  'download-settings'?: () => VNodeChild
  'network-settings'?: () => VNodeChild
  'account-settings'?: (context: SettingsDetailContext) => VNodeChild
  'external-source-settings'?: () => VNodeChild
  'appearance-settings'?: () => VNodeChild
  'navigation-settings'?: () => VNodeChild
}

export interface GlobalSettingsEmits {
  setPluginEnabled: [pluginId: string, isEnabled: boolean]
  checkPlugin: [pluginId: string]
  setHistoryLimit: [limit: number]
  setDownloadConcurrency: [concurrency: number]
  updateLocalUserDisplayName: [displayName: string]
  detailOpenChange: [isOpen: boolean]
  selectSection: [section: SettingsSectionId | null]
}

type GlobalSettingsEmit = <EventName extends keyof GlobalSettingsEmits>(
  eventName: EventName,
  ...args: GlobalSettingsEmits[EventName]
) => void

export interface UseGlobalSettingsOptions {
  props: Readonly<GlobalSettingsProps>
  emit: GlobalSettingsEmit
}

/** 设置草稿只发出修改意图；持久化与运行时副作用仍由工作台功能门面负责。 */
export function useGlobalSettings(options: UseGlobalSettingsOptions) {
  const { emit, props } = options
  const showFeedback = useSettingsFeedback()
  const session = useEditingSession('settings')
  let active = true
  onScopeDispose(() => (active = false))

  const profileName = session.state(profileNameKey, () => shallowRef(props.profile.displayName))
  const historyLimitInput = session.state(historyLimitInputKey, () =>
    shallowRef<number | string>(props.historyLimit),
  )
  const downloadConcurrencyInput = session.state(downloadConcurrencyInputKey, () =>
    shallowRef<number | string>(props.downloadConcurrency),
  )
  const profileError = session.state(profileErrorKey, () => shallowRef(''))
  const historyError = session.state(historyErrorKey, () => shallowRef(''))
  const downloadError = session.state(downloadErrorKey, () => shallowRef(''))
  watch(profileName, () => (profileError.value = ''), { flush: 'sync' })
  watch(historyLimitInput, () => (historyError.value = ''), { flush: 'sync' })
  watch(downloadConcurrencyInput, () => (downloadError.value = ''), { flush: 'sync' })
  const pluginGroups = computed(() => [
    {
      id: 'built-in',
      title: '本地内置音乐源',
      plugins: props.plugins.filter((plugin) => plugin.descriptor.provenance === 'built-in'),
    },
    ...(props.externalSourcesEnabled
      ? [
          {
            id: 'external',
            title: '外置音乐源',
            plugins: props.plugins.filter((plugin) => plugin.descriptor.provenance === 'external'),
          },
        ]
      : []),
  ])

  watch(
    () => props.profile.displayName,
    (displayName) => {
      profileName.value = displayName
    },
  )
  watch(
    () => props.historyLimit,
    (historyLimit) => {
      historyLimitInput.value = historyLimit
    },
  )
  watch(
    () => props.downloadConcurrency,
    (downloadConcurrency) => {
      downloadConcurrencyInput.value = downloadConcurrency
    },
  )
  function setPluginEnabled(pluginId: string, isEnabled: boolean): void {
    if (!active || !session.active || props.suspended) return
    emit('setPluginEnabled', pluginId, isEnabled)
  }
  function checkPlugin(pluginId: string): void {
    if (active && session.active && !props.suspended) emit('checkPlugin', pluginId)
  }

  function submitProfile(): void {
    submitValidatedSetting(() => {
      const name = profileName.value.normalize('NFKC').trim().replace(/\s+/g, ' ')
      if (!name || name.length > 80) {
        throw new AppError('invalid-input', '创作者名称不能为空，且不能超过 80 个字符。')
      }
      emit('updateLocalUserDisplayName', profileName.value)
    }, profileError)
  }

  function submitHistoryLimit(): void {
    submitValidatedSetting(() => {
      emit(
        'setHistoryLimit',
        readCount(
          historyLimitInput.value,
          MIN_PLAYBACK_HISTORY_LIMIT,
          MAX_PLAYBACK_HISTORY_LIMIT,
          '历史记录数量',
        ),
      )
    }, historyError)
  }

  function submitDownloadConcurrency(): void {
    submitValidatedSetting(() => {
      emit(
        'setDownloadConcurrency',
        readCount(
          downloadConcurrencyInput.value,
          MIN_DOWNLOAD_CONCURRENCY,
          MAX_DOWNLOAD_CONCURRENCY,
          '下载并发',
        ),
      )
    }, downloadError)
  }

  function submitValidatedSetting(action: () => void, errorMessage: ShallowRef<string>): void {
    if (!active || !session.active || props.suspended) return
    try {
      action()
      errorMessage.value = ''
    } catch (cause) {
      const error = toAppErrorState(cause, 'invalid-input', '设置无效。')
      errorMessage.value = formatAppErrorMessage(error)
      showFeedback({ status: 'error', error })
    }
  }

  return {
    downloadConcurrencyInput,
    downloadError,
    historyLimitInput,
    historyError,
    maxDownloadConcurrency: MAX_DOWNLOAD_CONCURRENCY,
    maxPlaybackHistoryLimit: MAX_PLAYBACK_HISTORY_LIMIT,
    minDownloadConcurrency: MIN_DOWNLOAD_CONCURRENCY,
    minPlaybackHistoryLimit: MIN_PLAYBACK_HISTORY_LIMIT,
    pluginGroups,
    profileName,
    profileError,
    setPluginEnabled,
    checkPlugin,
    submitDownloadConcurrency,
    submitHistoryLimit,
    submitProfile,
  }
}

function readCount(
  input: number | string,
  minimum: number,
  maximum: number,
  label: string,
): number {
  const count = typeof input === 'string' && !input.trim() ? NaN : Number(input)
  if (!Number.isInteger(count) || count < minimum || count > maximum) {
    throw new AppError('invalid-input', `${label}须为 ${minimum} 至 ${maximum} 的整数。`)
  }
  return count
}

const profileNameKey = editingStateKey<ShallowRef<string>>(
  'composables/use-global-settings.ts:profileName',
)
const historyLimitInputKey = editingStateKey<ShallowRef<number | string>>(
  'composables/use-global-settings.ts:historyLimitInput',
)
const downloadConcurrencyInputKey = editingStateKey<ShallowRef<number | string>>(
  'composables/use-global-settings.ts:downloadConcurrencyInput',
)
const profileErrorKey = editingStateKey<ShallowRef<string>>('settings:profile-error')
const historyErrorKey = editingStateKey<ShallowRef<string>>('settings:history-error')
const downloadErrorKey = editingStateKey<ShallowRef<string>>('settings:download-error')
