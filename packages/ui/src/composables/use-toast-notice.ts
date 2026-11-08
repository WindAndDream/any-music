import { onScopeDispose, readonly, shallowRef } from 'vue'

import { usePausableTimeout } from './use-pausable-timeout'

interface UseToastNoticeOptions {
  durationMs?: number
  cooldownMs?: number
}

/** 单个瞬时提示槽：展示和退场后的冷却期间忽略新请求，不排队也不延长展示。 */
export function useToastNotice(options: UseToastNoticeOptions = {}) {
  const message = shallowRef<string>()
  let isBlocked = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = usePausableTimeout(() => {
    message.value = undefined
    // 包含 240ms 退场动画，再留出一小段间隔，持续连点不会堆叠或刷新提示。
    timer = setTimeout(
      () => {
        isBlocked = false
        timer = undefined
      },
      240 + (options.cooldownMs ?? 600),
    )
  })

  function show(text: string): boolean {
    if (isBlocked || !text.trim()) return false
    isBlocked = true
    message.value = text
    timeout.start(options.durationMs ?? 2200)
    return true
  }

  onScopeDispose(() => {
    clearTimeout(timer)
    isBlocked = true
    message.value = undefined
  })
  return {
    message: readonly(message),
    show,
    setPaused: timeout.setPaused,
    dismiss() {
      timeout.clear()
      clearTimeout(timer)
      message.value = undefined
      isBlocked = false
    },
  }
}
