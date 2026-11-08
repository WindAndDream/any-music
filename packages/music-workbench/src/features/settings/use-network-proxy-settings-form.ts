import { createAppErrorState, formatAppErrorMessage, toAppErrorState } from '@any-music/core'
import type { AppErrorState } from '@any-music/core'
import { useSettingsFeedback } from '@any-music/ui'
import { computed, reactive, shallowRef, watch } from 'vue'

import {
  isSocksProxyType,
  type NetworkProxySettings,
  validateNetworkProxySettings,
} from './network-proxy-settings'

export interface NetworkProxySettingsFormProps {
  settings: NetworkProxySettings
}

export interface NetworkProxySettingsFormEmits {
  save: [settings: NetworkProxySettings]
}

type NetworkProxySettingsFormEmit = <EventName extends keyof NetworkProxySettingsFormEmits>(
  eventName: EventName,
  ...args: NetworkProxySettingsFormEmits[EventName]
) => void

export interface UseNetworkProxySettingsFormOptions {
  props: Readonly<NetworkProxySettingsFormProps>
  emit: NetworkProxySettingsFormEmit
}

/** 代理表单 composable 管理可丢弃草稿和校验反馈，不接触 GM 存储或请求实现。 */
export function useNetworkProxySettingsForm(options: UseNetworkProxySettingsFormOptions) {
  const { emit, props } = options
  const showFeedback = useSettingsFeedback()

  const proxyDraft = reactive<NetworkProxySettings>({ ...props.settings })
  const error = shallowRef<AppErrorState>()
  const errorMessage = computed(() => (error.value ? formatAppErrorMessage(error.value) : ''))
  const isSocksProxy = computed(() => isSocksProxyType(proxyDraft.type))
  const hasUnsavedChanges = computed(() =>
    Object.keys(proxyDraft).some((key) => {
      const field = key as keyof NetworkProxySettings
      return field !== 'isEnabled' && proxyDraft[field] !== props.settings[field]
    }),
  )

  function resetDraft(): void {
    Object.assign(proxyDraft, props.settings)
    error.value = undefined
  }

  watch(
    () => props.settings,
    (settings, previousSettings) => {
      // 开关只应用已保存配置，不能覆盖用户正在编辑的主机、端口和凭据草稿。
      const hasConfigurationChanged = Object.keys(settings).some((key) => {
        const field = key as keyof NetworkProxySettings
        return field !== 'isEnabled' && settings[field] !== previousSettings[field]
      })
      if (hasConfigurationChanged) Object.assign(proxyDraft, settings)
      else proxyDraft.isEnabled = settings.isEnabled
      error.value = undefined
    },
  )

  function submitSettings(): void {
    try {
      // 保存与启用是独立操作：填写或保存配置绝不隐式启动代理。
      const settings = validateNetworkProxySettings({
        ...proxyDraft,
        isEnabled: props.settings.isEnabled,
      })
      emit('save', settings)
      Object.assign(proxyDraft, settings)
      error.value = undefined
    } catch (cause) {
      error.value = toAppErrorState(cause, 'invalid-input', '代理设置无效。')
      showFeedback({ status: 'error', error: error.value })
    }
  }

  function toggleProxyEnabled(): void {
    try {
      if (!props.settings.isEnabled && !props.settings.host) {
        error.value = createAppErrorState(
          'invalid-input',
          '请先填写主机并保存代理配置，再启用代理。',
        )
        showFeedback({ status: 'error', error: error.value })
        return
      }
      emit(
        'save',
        validateNetworkProxySettings({ ...props.settings, isEnabled: !props.settings.isEnabled }),
      )
      error.value = undefined
    } catch (cause) {
      error.value = toAppErrorState(cause, 'invalid-input', '代理设置无效。')
      showFeedback({ status: 'error', error: error.value })
    }
  }

  return {
    errorMessage,
    hasUnsavedChanges,
    isSocksProxy,
    proxyDraft,
    resetDraft,
    submitSettings,
    toggleProxyEnabled,
  }
}

export type NetworkProxySettingsFormModel = ReturnType<typeof useNetworkProxySettingsForm>
