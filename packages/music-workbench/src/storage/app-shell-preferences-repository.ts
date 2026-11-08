import {
  createDefaultAppShellPreferences,
  normalizeAppShellPreferences,
  type AppShellPreferences,
} from '@any-music/ui'

import { readStored, writeStored } from '../runtime/storage'

const STORAGE_KEY = 'app-shell:v1'

/** 正式 Userscript 的布局偏好仓库；只持久化可跨页面恢复的稳定 UI 配置。 */
export const appShellPreferencesRepository = {
  load(): AppShellPreferences {
    try {
      return normalizeAppShellPreferences(readStored<unknown>(STORAGE_KEY))
    } catch (error) {
      // 布局偏好不可用不能阻止播放器打开；业务资料仍由各自仓库单独报告错误。
      console.warn('[Any Music] 无法读取界面偏好，已使用默认布局。', error)
      return createDefaultAppShellPreferences()
    }
  },
  save(preferences: AppShellPreferences): void {
    try {
      writeStored(STORAGE_KEY, preferences)
    } catch (error) {
      console.warn('[Any Music] 无法保存界面偏好，本次会话中的设置仍然有效。', error)
    }
  },
}
