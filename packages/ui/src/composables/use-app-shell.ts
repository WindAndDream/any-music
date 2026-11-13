import { computed, onScopeDispose, readonly, shallowRef, watch } from 'vue'
import type { ComputedRef } from 'vue'

import type {
  AppShellPreferences,
  AppThemePreference,
  SidebarSide,
} from '../product/app-shell-preferences'
import { normalizeAppShellPreferences } from '../product/app-shell-preferences'
import { getProductDestination, PRODUCT_DESTINATIONS } from '../product/product-navigation'
import type { ProductDestination } from '../product/product-navigation'

/** Runtime-owned persistence port; GM storage, Tauri stores and mobile storage stay out of UI. */
export interface AppShellPreferencesRepository {
  load: () => AppShellPreferences
  save: (preferences: AppShellPreferences) => void
}

export interface UseAppShellOptions {
  preferencesRepository: AppShellPreferencesRepository
  /** Injectable for native webviews and deterministic tests; browser runtimes use window.matchMedia. */
  matchMedia?: (query: string) => MediaQueryList
}

/**
 * Shared shell state owns only responsive UI behavior. Persistence is an injected runtime port, so
 * all hosts keep the same navigation and preference semantics without importing each other.
 */
export function useAppShell(options: UseAppShellOptions) {
  const loaded = options.preferencesRepository.load()
  const sidebarSide = shallowRef<SidebarSide>(loaded.sidebarSide)
  const isSidebarCollapsed = shallowRef(loaded.isSidebarCollapsed)
  const isMobileNavigationEnabled = shallowRef(loaded.isMobileNavigationEnabled)
  const theme = shallowRef<AppThemePreference>(loaded.theme)
  const destinationOrder = shallowRef(loaded.destinationOrder)
  const hiddenDestinationIds = shallowRef(loaded.hiddenDestinationIds)
  const isMobileDrawerOpen = shallowRef(false)
  const isPreferencesOpen = shallowRef(false)
  const isProductHidden = shallowRef(false)
  const systemPrefersDark = shallowRef(false)
  const matchMedia = options.matchMedia ?? window.matchMedia.bind(window)
  const mediaQuery = matchMedia('(prefers-color-scheme: dark)')
  const mobileViewportQuery = matchMedia('(max-width: 768px)')
  const mediumViewportQuery = matchMedia('(max-width: 1024px)')
  const isMobileViewport = shallowRef(mobileViewportQuery.matches)
  const isMediumViewport = shallowRef(mediumViewportQuery.matches)
  // 中屏默认收起，但当前断点内的手动开合必须优先；跨断点后重新采用响应式默认值。
  const mediumSidebarCollapsed = shallowRef<boolean>()

  systemPrefersDark.value = mediaQuery.matches
  const handleSystemThemeChange = (event: MediaQueryListEvent): void => {
    systemPrefersDark.value = event.matches
  }
  mediaQuery.addEventListener('change', handleSystemThemeChange)
  const handleMobileViewportChange = (event: MediaQueryListEvent): void => {
    isMobileViewport.value = event.matches
    mediumSidebarCollapsed.value = undefined
    // 从窄屏切回桌面时清理临时抽屉状态，避免再次缩窄后意外弹出。
    if (!event.matches) isMobileDrawerOpen.value = false
  }
  const handleMediumViewportChange = (event: MediaQueryListEvent): void => {
    isMediumViewport.value = event.matches
    mediumSidebarCollapsed.value = undefined
  }
  mobileViewportQuery.addEventListener('change', handleMobileViewportChange)
  mediumViewportQuery.addEventListener('change', handleMediumViewportChange)

  const resolvedTheme = computed<'light' | 'dark'>(() => {
    if (theme.value !== 'system') return theme.value
    return systemPrefersDark.value ? 'dark' : 'light'
  })
  const visibleDestinations: ComputedRef<readonly ProductDestination[]> = computed(() =>
    destinationOrder.value
      .map(getProductDestination)
      .filter((destination) => !hiddenDestinationIds.value.includes(destination.id)),
  )
  const mobileDestinations = computed(() =>
    PRODUCT_DESTINATIONS.filter((destination) => destination.mobileSlot),
  )
  const effectiveSidebarCollapsed = computed(() => {
    if (isMobileViewport.value) return false
    if (isMediumViewport.value) return mediumSidebarCollapsed.value ?? true
    return isSidebarCollapsed.value
  })
  watch(
    [
      sidebarSide,
      isSidebarCollapsed,
      isMobileNavigationEnabled,
      theme,
      destinationOrder,
      hiddenDestinationIds,
    ],
    () => {
      options.preferencesRepository.save({
        schemaVersion: 1,
        sidebarSide: sidebarSide.value,
        isSidebarCollapsed: isSidebarCollapsed.value,
        isMobileNavigationEnabled: isMobileNavigationEnabled.value,
        theme: theme.value,
        destinationOrder: destinationOrder.value,
        hiddenDestinationIds: hiddenDestinationIds.value,
      })
    },
  )

  function setSidebarSide(nextSide: SidebarSide): void {
    sidebarSide.value = nextSide
    isMobileDrawerOpen.value = false
  }

  function setTheme(nextTheme: AppThemePreference): void {
    theme.value = nextTheme
  }

  function setMobileNavigationEnabled(isEnabled: boolean): void {
    isMobileNavigationEnabled.value = isEnabled
  }

  function toggleSidebarCollapsed(): void {
    // 窄屏侧栏是临时抽屉；“收起”必须关闭抽屉，不能改写下一次桌面布局的持久偏好。
    if (isMobileViewport.value) {
      closeMobileDrawer()
      return
    }
    // 从实际显示状态切换，避免自动收起时先反转桌面偏好而让第一次点击无效。
    const nextCollapsed = !effectiveSidebarCollapsed.value
    if (isMediumViewport.value) mediumSidebarCollapsed.value = nextCollapsed
    isSidebarCollapsed.value = nextCollapsed
  }

  function toggleMobileDrawer(): void {
    // 抽屉只在移动壳层存在；宽屏误触或陈旧事件不能让内容区进入 inert 状态。
    if (!isMobileViewport.value) return
    isMobileDrawerOpen.value = !isMobileDrawerOpen.value
  }

  function closeMobileDrawer(): void {
    isMobileDrawerOpen.value = false
  }

  function openPreferences(): void {
    isPreferencesOpen.value = true
    closeMobileDrawer()
  }

  function closePreferences(): void {
    isPreferencesOpen.value = false
  }

  function hideProduct(): void {
    isProductHidden.value = true
    closeMobileDrawer()
  }

  function showProduct(): void {
    isProductHidden.value = false
  }

  function moveDestination(id: ProductDestination['id'], offset: -1 | 1): void {
    const index = destinationOrder.value.indexOf(id)
    const nextIndex = index + offset
    if (index < 0 || nextIndex < 0 || nextIndex >= destinationOrder.value.length) return
    const nextOrder = [...destinationOrder.value]
    nextOrder.splice(index, 1)
    nextOrder.splice(nextIndex, 0, id)
    destinationOrder.value = nextOrder
  }

  function setDestinationVisible(id: ProductDestination['id'], isVisible: boolean): void {
    const destination = getProductDestination(id)
    if (!destination.canHide) return
    const hiddenIds = new Set(hiddenDestinationIds.value)
    if (isVisible) hiddenIds.delete(id)
    else hiddenIds.add(id)
    hiddenDestinationIds.value = [...hiddenIds]
  }

  onScopeDispose(() => {
    mediaQuery.removeEventListener('change', handleSystemThemeChange)
    mobileViewportQuery.removeEventListener('change', handleMobileViewportChange)
    mediumViewportQuery.removeEventListener('change', handleMediumViewportChange)
  })

  return {
    setPreferences(value: AppShellPreferences) {
      const next = normalizeAppShellPreferences(value)
      sidebarSide.value = next.sidebarSide
      isSidebarCollapsed.value = next.isSidebarCollapsed
      isMobileNavigationEnabled.value = next.isMobileNavigationEnabled
      theme.value = next.theme
      destinationOrder.value = next.destinationOrder
      hiddenDestinationIds.value = next.hiddenDestinationIds
    },
    sidebarSide: readonly(sidebarSide),
    isSidebarCollapsed: readonly(isSidebarCollapsed),
    effectiveSidebarCollapsed,
    isMobileNavigationEnabled: readonly(isMobileNavigationEnabled),
    theme: readonly(theme),
    resolvedTheme,
    destinationOrder: readonly(destinationOrder),
    hiddenDestinationIds: readonly(hiddenDestinationIds),
    visibleDestinations,
    mobileDestinations,
    isMobileViewport: readonly(isMobileViewport),
    isMobileDrawerOpen: readonly(isMobileDrawerOpen),
    isPreferencesOpen: readonly(isPreferencesOpen),
    isProductHidden: readonly(isProductHidden),
    setSidebarSide,
    setTheme,
    setMobileNavigationEnabled,
    toggleSidebarCollapsed,
    toggleMobileDrawer,
    closeMobileDrawer,
    openPreferences,
    closePreferences,
    hideProduct,
    showProduct,
    moveDestination,
    setDestinationVisible,
  }
}
