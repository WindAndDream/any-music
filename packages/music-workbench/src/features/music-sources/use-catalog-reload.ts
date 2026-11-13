import type { CatalogDrawerView, ConfirmAction } from '@any-music/ui'
import { onScopeDispose } from 'vue'

interface UseCatalogReloadOptions {
  getDrawer: (drawerId: string) => CatalogDrawerView | undefined
  confirm: ConfirmAction
  reload: (drawerId: string) => Promise<void>
  onReloadStart: (drawerId: string) => void
}

function canReload(drawer: CatalogDrawerView | undefined): drawer is CatalogDrawerView {
  return Boolean(
    drawer &&
    drawer.isSourceEnabled &&
    drawer.status !== 'disconnected' &&
    drawer.status !== 'missing' &&
    drawer.status !== 'paused' &&
    drawer.status !== 'restoring' &&
    !drawer.isLoading &&
    !drawer.isVerifying,
  )
}

/** 刷新和错误重试共用清空确认；确认期间不修改列表，开始前重新校验来源与加载状态。 */
export function useCatalogReload(options: UseCatalogReloadOptions) {
  const pendingDrawerIds = new Set<string>()
  let isDisposed = false
  onScopeDispose(() => {
    isDisposed = true
  })

  async function reloadDrawer(drawerId: string, action: 'recover' | 'refresh' = 'recover') {
    const drawer = options.getDrawer(drawerId)
    if (isDisposed || pendingDrawerIds.has(drawerId) || !canReload(drawer)) return
    pendingDrawerIds.add(drawerId)
    try {
      if (drawer.tracks.length > 0) {
        // 重试只重放列表请求；登录或安全验证仍由对应入口完成。
        const actionLabel = action === 'refresh' ? '刷新' : '重试'
        const confirmed = await options.confirm({
          title: '重新加载音乐列表',
          message: `当前已加载 ${drawer.tracks.length} 首歌曲。${actionLabel}会从第一页重新加载，当前结果将暂时清空。建议先将需要保留的歌曲加入“我的喜欢”。确定继续吗？`,
          confirmLabel: `${actionLabel}列表`,
        })
        if (!confirmed) return
      }
      if (isDisposed || !canReload(options.getDrawer(drawerId))) return
      options.onReloadStart(drawerId)
      await options.reload(drawerId)
    } finally {
      pendingDrawerIds.delete(drawerId)
    }
  }

  return { reloadDrawer }
}
