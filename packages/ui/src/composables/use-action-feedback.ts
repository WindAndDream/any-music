import { hasInjectionContext, inject, onScopeDispose, provide, readonly, shallowRef } from 'vue'
import type { InjectionKey } from 'vue'

import type { AppIconName } from '../components/app-icon'
import {
  formatActionFeedback,
  type ActionFeedbackResult,
  type ActionFeedbackTone,
} from '../product/action-feedback'
import { usePausableTimeout } from './use-pausable-timeout'

const actionFeedbackKey: InjectionKey<(result: ActionFeedbackResult) => void> =
  Symbol('action-feedback')

/** 操作结果与状态共享顶部提示槽：后到提示立即替换，颜色和图标随本次状态一起刷新。 */
export function provideActionFeedback() {
  const notice = shallowRef<{
    id: number
    tone: ActionFeedbackTone
    icon?: AppIconName
    message: string
  }>()
  let sequence = 0
  let isDisposed = false
  const timeout = usePausableTimeout(() => {
    notice.value = undefined
  })

  function show(result: ActionFeedbackResult): void {
    if (isDisposed) return
    notice.value = {
      id: ++sequence,
      tone: result.status,
      icon: result.icon,
      message: formatActionFeedback(result),
    }
    timeout.start(result.status === 'error' ? 5000 : 3000)
  }

  provide(actionFeedbackKey, show)
  onScopeDispose(() => {
    isDisposed = true
    notice.value = undefined
  })
  return {
    notice: readonly(notice),
    show,
    /** Plugins, themes and future gated features share one top notice with caller-owned copy. */
    showUnavailable(reason?: string): boolean {
      if (!reason) return false
      show({ status: 'info', message: reason })
      return true
    },
    setPaused: timeout.setPaused,
    dismiss() {
      timeout.clear()
      notice.value = undefined
    },
  }
}

export function useActionFeedback() {
  return hasInjectionContext() ? inject(actionFeedbackKey, () => {}) : () => {}
}
