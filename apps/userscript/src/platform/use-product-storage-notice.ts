import { createAppErrorState, formatAppErrorMessage } from '@any-music/core'
import type { AppErrorState } from '@any-music/core'
import { computed, onScopeDispose, readonly, shallowRef } from 'vue'

/** A failed async save stays visible until reload; its writer is already frozen. */
export function useProductStorageNotice(target: EventTarget = window) {
  const error = shallowRef<AppErrorState>()
  const onFailure = () => {
    error.value = createAppErrorState(
      'storage-write-failed',
      '本地资料保存失败，已停止后续保存。请重新加载页面后检查资料。',
    )
  }
  target.addEventListener('any-music:storage-error', onFailure)
  onScopeDispose(() => {
    target.removeEventListener('any-music:storage-error', onFailure)
    error.value = undefined
  })
  return {
    error: readonly(error),
    message: computed(() => (error.value ? formatAppErrorMessage(error.value) : undefined)),
  }
}
