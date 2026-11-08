import { computed, readonly, shallowRef, toValue, watch } from 'vue'
import type { MaybeRefOrGetter } from 'vue'

interface Options {
  title: MaybeRefOrGetter<string>
  compactTitle: MaybeRefOrGetter<string>
  availableElement: MaybeRefOrGetter<HTMLElement | null>
  titleElement: MaybeRefOrGetter<HTMLElement | null>
  compactTitleElement: MaybeRefOrGetter<HTMLElement | null>
}

/** 测量完整标题和“平台 · 原始输入”的自然宽度，避免按字符数量猜测省略状态。 */
export function useCatalogContextTitle(options: Options) {
  const canShowFullTitle = shallowRef(true)
  const isTruncated = shallowRef(false)
  const displayText = computed(() =>
    canShowFullTitle.value ? toValue(options.title) : toValue(options.compactTitle),
  )

  watch(
    () =>
      [
        toValue(options.availableElement),
        toValue(options.titleElement),
        toValue(options.compactTitleElement),
        toValue(options.title),
        toValue(options.compactTitle),
      ] as const,
    ([available, title, compactTitle], _previous, onCleanup) => {
      if (!available || !title || !compactTitle) return
      let isActive = true
      const measure = (): void => {
        // 隐藏或离场页面可能暂时没有宽度，等布局恢复后再作判断。
        if (!isActive || !available.clientWidth) return
        canShowFullTitle.value = title.scrollWidth <= available.clientWidth
        isTruncated.value =
          !canShowFullTitle.value && compactTitle.scrollWidth > available.clientWidth
      }
      measure()
      let disconnect: (() => void) | undefined
      if (typeof ResizeObserver !== 'undefined') {
        const observer = new ResizeObserver(measure)
        // 观察固定可用区域和两段自然宽度，文字/字体变化也能重测；展示切换不改变它们。
        for (const element of [available, title, compactTitle]) observer.observe(element)
        disconnect = () => observer.disconnect()
      } else if (typeof window !== 'undefined') {
        window.addEventListener('resize', measure)
        disconnect = () => window.removeEventListener('resize', measure)
      }
      onCleanup(() => {
        isActive = false
        disconnect?.()
      })
    },
    { immediate: true, flush: 'post' },
  )

  return { displayText, isTruncated: readonly(isTruncated) }
}
