import { DEFAULT_DESTINATION_IDS, PRODUCT_DESTINATIONS } from './product-navigation'
import type { ProductViewId } from './product-navigation'

export type AppThemePreference = 'system' | 'light' | 'dark'
export type SidebarSide = 'left' | 'right'

export interface AppShellPreferences {
  schemaVersion: 1
  sidebarSide: SidebarSide
  isSidebarCollapsed: boolean
  isMobileNavigationEnabled: boolean
  theme: AppThemePreference
  destinationOrder: readonly ProductViewId[]
  hiddenDestinationIds: readonly ProductViewId[]
}

export function createDefaultAppShellPreferences(): AppShellPreferences {
  return {
    schemaVersion: 1,
    sidebarSide: 'left',
    isSidebarCollapsed: false,
    isMobileNavigationEnabled: true,
    theme: 'system',
    destinationOrder: DEFAULT_DESTINATION_IDS,
    hiddenDestinationIds: [],
  }
}

/**
 * GM 存储属于不可信持久化边界；这里按当前导航表裁剪旧项并补入新增项，
 * 使升级不会让入口永久丢失，也不让任意字符串扩散到组件状态。
 */
export function normalizeAppShellPreferences(input: unknown): AppShellPreferences {
  const fallback = createDefaultAppShellPreferences()
  if (!isRecord(input)) return fallback

  const knownIds = new Set<ProductViewId>(DEFAULT_DESTINATION_IDS)
  const requestedOrder = Array.isArray(input.destinationOrder)
    ? input.destinationOrder.filter(
        (id): id is ProductViewId => typeof id === 'string' && knownIds.has(id as ProductViewId),
      )
    : []
  const destinationOrder = [
    ...new Set<ProductViewId>(requestedOrder),
    ...DEFAULT_DESTINATION_IDS.filter((id) => !requestedOrder.includes(id)),
  ]
  const hiddenDestinationIds = Array.isArray(input.hiddenDestinationIds)
    ? input.hiddenDestinationIds.filter(
        (id): id is ProductViewId =>
          typeof id === 'string' &&
          knownIds.has(id as ProductViewId) &&
          PRODUCT_DESTINATIONS.some((destination) => destination.id === id && destination.canHide),
      )
    : []

  return {
    schemaVersion: 1,
    sidebarSide: input.sidebarSide === 'right' ? 'right' : 'left',
    isSidebarCollapsed:
      typeof input.isSidebarCollapsed === 'boolean'
        ? input.isSidebarCollapsed
        : fallback.isSidebarCollapsed,
    isMobileNavigationEnabled:
      typeof input.isMobileNavigationEnabled === 'boolean'
        ? input.isMobileNavigationEnabled
        : fallback.isMobileNavigationEnabled,
    theme: input.theme === 'light' || input.theme === 'dark' ? input.theme : 'system',
    destinationOrder,
    hiddenDestinationIds: [...new Set(hiddenDestinationIds)],
  }
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === 'object' && input !== null && !Array.isArray(input)
}

/** Ordinary appearance selection; independent of the chosen UI layout. */
export type AppShellPreferenceKind = 'sidebar-side' | 'theme' | 'ui-theme'
