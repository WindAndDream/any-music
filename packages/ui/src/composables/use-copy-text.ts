import { AppError, toAppErrorState, formatAppErrorMessage } from '@any-music/core'
import { onScopeDispose, readonly, shallowRef, toValue, watch } from 'vue'
import type { MaybeRefOrGetter } from 'vue'

import { writeClipboardText } from '../product/clipboard'

interface CopyTextOptions {
  /** 上下文切换或关闭后，旧复制结果不能写回新弹窗。 */
  context: MaybeRefOrGetter<string | undefined>
  enabled: MaybeRefOrGetter<boolean>
  container: MaybeRefOrGetter<HTMLElement | null>
  getText: () => string
  successMessage: MaybeRefOrGetter<string>
}

/** 只在显式点击时生成文本，复用进行中的复制并清理迟到的反馈。 */
export function useCopyText(options: CopyTextOptions) {
  const isCopying = shallowRef(false)
  const feedback = shallowRef<{ status: 'success' | 'error'; message: string }>()
  let generation = 0
  watch(
    () => toValue(options.context),
    () => {
      generation += 1
      feedback.value = undefined
    },
    { flush: 'sync' },
  )
  onScopeDispose(() => {
    generation += 1
  })

  async function copy(): Promise<void> {
    const container = toValue(options.container)
    if (isCopying.value || !toValue(options.enabled) || !toValue(options.context) || !container)
      return
    const expectedGeneration = generation
    isCopying.value = true
    feedback.value = undefined
    try {
      await writeClipboardText(options.getText(), container)
      if (expectedGeneration === generation) {
        feedback.value = { status: 'success', message: toValue(options.successMessage) }
      }
    } catch (cause) {
      if (expectedGeneration === generation) {
        const error = toAppErrorState(
          new AppError('unsupported-operation', '复制失败，请重试或手动复制。', { cause }),
        )
        feedback.value = { status: 'error', message: formatAppErrorMessage(error) }
      }
    } finally {
      isCopying.value = false
    }
  }

  return { isCopying: readonly(isCopying), feedback: readonly(feedback), copy }
}
