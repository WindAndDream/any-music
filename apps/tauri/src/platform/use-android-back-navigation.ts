import type { BackNavigation } from '@any-music/ui'
import { exit, onBackButtonPress } from '@tauri-apps/api/app'
import { onScopeDispose, shallowRef, watch } from 'vue'

const EXIT_CONFIRMATION_MS = 2000

/** Bind Android Back to product layers; finishing the Activity remains native-owned. */
export function useAndroidBackNavigation(navigation: BackNavigation | undefined) {
  const message = shallowRef<string>()
  let confirmationTimer: ReturnType<typeof setTimeout> | undefined
  let expiresAt = 0
  let disposed = false
  let isExiting = false
  let listener: Awaited<ReturnType<typeof onBackButtonPress>> | undefined

  function reset(): void {
    clearTimeout(confirmationTimer)
    confirmationTimer = undefined
    expiresAt = 0
    message.value = undefined
  }

  async function handleBack(): Promise<void> {
    if (disposed || isExiting || document.visibilityState === 'hidden') return
    if (navigation?.back()) {
      reset()
      return
    }
    if (expiresAt > performance.now()) {
      reset()
      isExiting = true
      try {
        await exit(0)
      } catch {
        isExiting = false
        if (!disposed) message.value = '退出失败，请重试'
      }
      return
    }
    reset()
    expiresAt = performance.now() + EXIT_CONFIRMATION_MS
    message.value = '再按一次返回键退出应用'
    confirmationTimer = setTimeout(reset, EXIT_CONFIRMATION_MS)
  }

  if (navigation) {
    watch(navigation.revision, reset, { flush: 'sync' })
    document.addEventListener('visibilitychange', reset)
    // Completed taps reset the pair. A system Back swipe may start/cancel a pointer sequence.
    document.addEventListener('click', reset, { capture: true })
    void onBackButtonPress(() => void handleBack())
      .then(async (registered) => {
        if (disposed) await registered.unregister()
        else listener = registered
      })
      .catch(() => {
        if (!disposed) message.value = '返回键初始化失败，请重新打开应用'
      })
  }
  onScopeDispose(() => {
    disposed = true
    reset()
    document.removeEventListener('visibilitychange', reset)
    document.removeEventListener('click', reset, { capture: true })
    void listener?.unregister().catch(() => {})
  })
  return { message }
}
