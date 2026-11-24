import { computed, shallowRef, watch } from 'vue'

import type { UiPluginCenterItem } from '../../product/theme-features'

const PLUGIN_ENABLE_LOADING_DELAY_MS = 200

/** Keep the disabled label through a brief enablement load. */
export function usePluginStatusPresentation<Item extends UiPluginCenterItem | undefined>(
  getItem: () => Item,
) {
  const deferLoading = shallowRef(false)
  watch(
    [() => getItem()?.id, () => getItem()?.enabled, () => getItem()?.status.status],
    ([id, enabled, status], [previousId, wasEnabled], onCleanup) => {
      deferLoading.value =
        id === previousId && wasEnabled === false && enabled === true && status === 'loading'
      if (!deferLoading.value) return

      const timer = setTimeout(() => {
        deferLoading.value = false
      }, PLUGIN_ENABLE_LOADING_DELAY_MS)
      onCleanup(() => clearTimeout(timer))
    },
  )
  return computed(() => {
    const item = getItem()
    return item && deferLoading.value
      ? { ...item, enabled: false, status: { status: 'ready' as const } }
      : item
  })
}
