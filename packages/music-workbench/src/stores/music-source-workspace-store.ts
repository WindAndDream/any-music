import {
  formatAppErrorMessage,
  normalizeDownloadConcurrency,
  toAppErrorState,
} from '@any-music/core'
import type { AppErrorState } from '@any-music/core'
import { acceptHMRUpdate, defineStore } from 'pinia'
import { computed, onScopeDispose, shallowRef, watch } from 'vue'

import {
  sanitizeCatalogResultSnapshot,
  type CatalogResultSnapshot,
} from '../features/music-sources/catalog-result-snapshot'
import {
  createEmptyMusicSourceWorkspace,
  MAX_MUSIC_SOURCE_DRAWER_COUNT,
  MUSIC_SOURCE_WORKSPACE_SCHEMA_VERSION,
  normalizeCatalogDrawerTitle,
  type CatalogDrawerRecipe,
  type MusicSourceWorkspaceSnapshot,
} from '../features/music-sources/music-source-workspace-state'
import {
  type NetworkProxySettings,
  validateNetworkProxySettings,
} from '../features/settings/network-proxy-settings'
import { musicSourceWorkspaceRepository } from '../storage/music-source-workspace-repository'

const PERSIST_THROTTLE_MS = 300

/**
 * 音乐源工作区的 Pinia 单一状态源。
 *
 * Store 保存设置、请求和稳定结果快照；迭代器、账号租约及媒体地址只属于运行时。
 */
export const useMusicSourceWorkspaceStore = defineStore('music-source-workspace', () => {
  const loaded = loadInitialSnapshot()
  const disabledPluginIds = shallowRef<readonly string[]>(loaded.snapshot.disabledPluginIds)
  const activePluginId = shallowRef(loaded.snapshot.activePluginId)
  const proxySettings = shallowRef<NetworkProxySettings>(loaded.snapshot.proxySettings)
  const downloadConcurrency = shallowRef(loaded.snapshot.downloadConcurrency)
  const searchQuery = shallowRef(loaded.snapshot.searchQuery)
  const importUrl = shallowRef(loaded.snapshot.importUrl)
  const drawerRecipes = shallowRef<readonly CatalogDrawerRecipe[]>(loaded.snapshot.drawers)
  const unavailableTrackIds = shallowRef<readonly string[]>(
    loaded.snapshot.unavailableTrackIds ?? [],
  )
  const persistenceErrorState = shallowRef<AppErrorState | undefined>(loaded.error)
  const persistenceError = computed(() =>
    persistenceErrorState.value ? formatAppErrorMessage(persistenceErrorState.value) : '',
  )
  let persistTimer: number | undefined

  function isPluginEnabled(pluginId: string): boolean {
    return !disabledPluginIds.value.includes(pluginId)
  }

  function setActivePluginId(pluginId: string): void {
    activePluginId.value = pluginId
  }

  function setPluginEnabled(pluginId: string, isEnabled: boolean): void {
    const ids = new Set(disabledPluginIds.value)
    if (isEnabled) ids.delete(pluginId)
    else ids.add(pluginId)
    disabledPluginIds.value = [...ids]
  }

  function setProxySettings(settings: NetworkProxySettings): void {
    // 整体替换保证 shallowRef、持久化 watcher 与运行时 HTTP 配置看到同一份原子快照。
    proxySettings.value = validateNetworkProxySettings(settings)
  }

  function setDownloadConcurrency(concurrency: number): void {
    downloadConcurrency.value = normalizeDownloadConcurrency(concurrency)
  }

  function addDrawerRecipe(recipe: CatalogDrawerRecipe): void {
    drawerRecipes.value = [
      recipe,
      ...drawerRecipes.value.filter((drawer) => drawer.id !== recipe.id),
    ].slice(0, MAX_MUSIC_SOURCE_DRAWER_COUNT)
  }

  function moveDrawerToFront(drawerId: string): void {
    const drawer = drawerRecipes.value.find((candidate) => candidate.id === drawerId)
    if (!drawer || drawerRecipes.value[0]?.id === drawerId) return
    drawerRecipes.value = [
      drawer,
      ...drawerRecipes.value.filter((candidate) => candidate !== drawer),
    ]
  }

  /** O(n + k) 重排可见槽位；筛选隐藏项保留原位，置顶与普通列表不可跨组。 */
  function moveDrawer(drawerId: string, targetId: string, visibleIds: readonly string[]): boolean {
    const source = drawerRecipes.value.find((drawer) => drawer.id === drawerId)
    if (!source) return false
    const eligible = new Set(visibleIds)
    const canMove = (drawer: CatalogDrawerRecipe) =>
      eligible.has(drawer.id) && Boolean(drawer.isPinned) === Boolean(source.isPinned)
    const visible = drawerRecipes.value.filter(canMove)
    const from = visible.findIndex((drawer) => drawer.id === drawerId)
    const to = visible.findIndex((drawer) => drawer.id === targetId)
    if (from < 0 || to < 0 || from === to) return false
    visible.splice(to, 0, visible.splice(from, 1)[0]!)
    let index = 0
    drawerRecipes.value = drawerRecipes.value.map((drawer) =>
      canMove(drawer) ? visible[index++]! : drawer,
    )
    return true
  }

  function renameDrawer(drawerId: string, title: string, originalTitle?: string): void {
    updateDrawerRecipe(drawerId, {
      title: normalizeCatalogDrawerTitle(title),
      ...(originalTitle ? { originalTitle } : {}),
    })
  }

  /** 批量恢复只遍历配方一次；空集合和已经使用原名的列表不发布新快照。 */
  function restoreDrawerNames(originalTitles: ReadonlyMap<string, string>): number {
    let restoredCount = 0
    const next = drawerRecipes.value.map((drawer) => {
      const title = originalTitles.get(drawer.id)
      if (!title || title === drawer.title) return drawer
      restoredCount += 1
      return { ...drawer, title, originalTitle: title }
    })
    if (restoredCount > 0) drawerRecipes.value = next
    return restoredCount
  }

  function setDrawerExpanded(drawerId: string, isExpanded: boolean): void {
    updateDrawerRecipe(drawerId, { isExpanded })
  }

  /** 置顶只更新稳定偏好，原始请求顺序保留供取消置顶时恢复。 */
  function setDrawerPinned(drawerId: string, isPinned: boolean): void {
    updateDrawerRecipe(drawerId, { isPinned })
  }

  function removeDrawerRecipe(drawerId: string): void {
    removeDrawerRecipes(new Set([drawerId]))
  }

  function removeDrawerRecipes(drawerIds: ReadonlySet<string>): void {
    const next = drawerRecipes.value.filter((drawer) => !drawerIds.has(drawer.id))
    if (next.length !== drawerRecipes.value.length) drawerRecipes.value = next
  }

  function setDrawerResult(drawerId: string, result: CatalogResultSnapshot): void {
    drawerRecipes.value = drawerRecipes.value.map((drawer) =>
      drawer.id === drawerId
        ? { ...drawer, result: sanitizeCatalogResultSnapshot(result, drawer.pluginId) }
        : drawer,
    )
  }

  function setTrackUnavailable(trackId: string, unavailable: boolean): void {
    const ids = new Set(unavailableTrackIds.value)
    if (ids.has(trackId) === unavailable) return
    if (unavailable) ids.add(trackId)
    else ids.delete(trackId)
    unavailableTrackIds.value = [...ids].slice(-20_000)
  }

  function updateDrawerRecipe(
    drawerId: string,
    patch: Partial<
      Pick<CatalogDrawerRecipe, 'title' | 'originalTitle' | 'isExpanded' | 'isPinned'>
    >,
  ): void {
    drawerRecipes.value = drawerRecipes.value.map((drawer) =>
      drawer.id === drawerId ? { ...drawer, ...patch } : drawer,
    )
  }

  function persistNow(): void {
    if (persistTimer !== undefined) window.clearTimeout(persistTimer)
    persistTimer = undefined
    const snapshot: MusicSourceWorkspaceSnapshot = {
      schemaVersion: MUSIC_SOURCE_WORKSPACE_SCHEMA_VERSION,
      disabledPluginIds: disabledPluginIds.value,
      ...(activePluginId.value ? { activePluginId: activePluginId.value } : {}),
      proxySettings: proxySettings.value,
      downloadConcurrency: downloadConcurrency.value,
      searchQuery: searchQuery.value,
      importUrl: importUrl.value,
      drawers: drawerRecipes.value,
      unavailableTrackIds: unavailableTrackIds.value,
    }
    try {
      musicSourceWorkspaceRepository.save(snapshot)
      persistenceErrorState.value = undefined
    } catch (error) {
      persistenceErrorState.value = toAppErrorState(
        error,
        'storage-write-failed',
        '音乐源工作区保存失败。',
      )
    }
  }

  function schedulePersist(): void {
    if (persistTimer !== undefined) return
    persistTimer = window.setTimeout(persistNow, PERSIST_THROTTLE_MS)
  }

  // shallowRef 状态只通过 action 整体替换，因此无需昂贵的 deep watch。
  watch(
    [
      activePluginId,
      disabledPluginIds,
      proxySettings,
      downloadConcurrency,
      searchQuery,
      importUrl,
      drawerRecipes,
      unavailableTrackIds,
    ],
    schedulePersist,
    { flush: 'sync' },
  )
  // disposePinia 会结束 store 作用域；退出宿主页前先提交最后快照并清掉待执行计时器。
  onScopeDispose(persistNow)

  return {
    disabledPluginIds,
    activePluginId,
    setActivePluginId,
    proxySettings,
    downloadConcurrency,
    searchQuery,
    importUrl,
    drawerRecipes,
    unavailableTrackIds,
    setDrawerResult,
    setTrackUnavailable,
    persistenceError,
    persistenceErrorState,
    isPluginEnabled,
    setPluginEnabled,
    setProxySettings,
    setDownloadConcurrency,
    addDrawerRecipe,
    moveDrawerToFront,
    moveDrawer,
    renameDrawer,
    restoreDrawerNames,
    setDrawerExpanded,
    setDrawerPinned,
    removeDrawerRecipe,
    removeDrawerRecipes,
    persistNow,
  }
})

function loadInitialSnapshot(): {
  snapshot: MusicSourceWorkspaceSnapshot
  error?: AppErrorState
} {
  try {
    return { snapshot: musicSourceWorkspaceRepository.load() }
  } catch (error) {
    return {
      snapshot: createEmptyMusicSourceWorkspace(),
      error: toAppErrorState(error, 'storage-read-failed', '音乐源工作区读取失败。'),
    }
  }
}

if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useMusicSourceWorkspaceStore, import.meta.hot))
}
