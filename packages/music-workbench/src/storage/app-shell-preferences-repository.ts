import {
  createDefaultAppShellPreferences,
  normalizeAppShellPreferences,
  type AppShellPreferences,
} from '@any-music/ui'

import { readStored, writeStored } from '../runtime/storage'
import { getWorkbenchRuntime } from '../runtime/workbench-runtime'

const STORAGE_KEY = 'app-shell:v1'

/** Keep desktop rail toggles independent of complete product-generation writes. */
export const appShellPreferencesRepository = {
  load(): AppShellPreferences {
    try {
      const preferences = normalizeAppShellPreferences(readStored<unknown>(STORAGE_KEY))
      const collapsed = getWorkbenchRuntime().sidebarCollapsePreference?.read()
      return { ...preferences, isSidebarCollapsed: collapsed ?? preferences.isSidebarCollapsed }
    } catch (error) {
      // 布局偏好不可用不能阻止播放器打开；业务资料仍由各自仓库单独报告错误。
      console.warn('[Any Music] 无法读取界面偏好，已使用默认布局。', error)
      return createDefaultAppShellPreferences()
    }
  },
  save(preferences: AppShellPreferences): void {
    try {
      const sidebar = getWorkbenchRuntime().sidebarCollapsePreference
      if (!sidebar) {
        writeStored(STORAGE_KEY, preferences)
        return
      }
      const current = normalizeAppShellPreferences(readStored<unknown>(STORAGE_KEY))
      const collapsed = sidebar.read() ?? current.isSidebarCollapsed
      // Keep other shell settings on the product snapshot's existing transactional path.
      const currentWithNewCollapse = {
        ...current,
        isSidebarCollapsed: preferences.isSidebarCollapsed,
      }
      if (JSON.stringify(currentWithNewCollapse) !== JSON.stringify(preferences))
        writeStored(STORAGE_KEY, preferences)
      if (preferences.isSidebarCollapsed !== collapsed)
        sidebar.write(preferences.isSidebarCollapsed)
    } catch (error) {
      console.warn('[Any Music] 无法保存界面偏好，本次会话中的设置仍然有效。', error)
    }
  },
}
