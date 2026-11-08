import { toValue, watch } from 'vue'
import type { MaybeRefOrGetter } from 'vue'

import { hasCatalogDrawerError } from '../../components/music-sources/catalog-drawer-presentation'
import type { CatalogDrawerView } from '../../product/catalog-drawer'

interface UseCatalogErrorNotificationsOptions {
  drawers: MaybeRefOrGetter<readonly CatalogDrawerView[]>
  onError: (drawerId: string) => void
}

/**
 * 首次加载和后续分页的新故障都通知错误弹窗；关闭弹窗、浏览或收藏不会重复通知。
 * 初始快照只记录已有故障，恢复重新进入加载态后，同一种错误仍可再次通知。
 */
export function useCatalogErrorNotifications(options: UseCatalogErrorNotificationsOptions): void {
  let previousFailures: Map<string, string | undefined> | undefined

  watch(
    () =>
      toValue(options.drawers).map((drawer) => ({
        id: drawer.id,
        failure:
          !drawer.isLoading && hasCatalogDrawerError(drawer)
            ? JSON.stringify([
                drawer.errorCode === 'operation-cancelled' ? undefined : drawer.status,
                drawer.errorCode,
                drawer.errorMessage,
                drawer.errorCode === 'operation-cancelled' ? undefined : drawer.invalidReason,
              ])
            : undefined,
      })),
    (snapshots) => {
      const failures = new Map(snapshots.map(({ id, failure }) => [id, failure]))
      const previous = previousFailures
      // 在通知回调前保存快照，回调导致的视图变化也不会重复报告同一错误。
      previousFailures = failures
      if (!previous) return
      for (const { id, failure } of snapshots) {
        if (failure && failure !== previous.get(id)) options.onError(id)
      }
    },
    { immediate: true },
  )
}
