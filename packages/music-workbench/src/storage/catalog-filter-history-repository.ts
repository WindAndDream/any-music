import { AppError } from '@any-music/core'
import type { CatalogFilterHistoryRepository } from '@any-music/ui'

import { readStored, writeStored } from '../runtime/storage'

// 历史按筛选器归属保存，各维度独立去重和裁剪。
const STORAGE_KEY = 'catalog-filter-history:v2'
const SETTINGS_STORAGE_KEY = 'catalog-filter-history-settings:v1'

/** 只保存关键词和日期/时长快照，跨宿主页复用；存储失败仍保留本次会话历史。 */
export const catalogFilterHistoryRepository: CatalogFilterHistoryRepository = {
  load() {
    try {
      return readStored<unknown>(STORAGE_KEY)
    } catch (error) {
      console.warn('[Any Music] 无法读取筛选历史，本次会话将使用空历史。', error)
      return []
    }
  },
  save(entries) {
    try {
      writeStored(STORAGE_KEY, entries)
    } catch (error) {
      console.warn('[Any Music] 无法保存筛选历史，本次会话中的历史仍然有效。', error)
      return new AppError(
        'storage-write-failed',
        '筛选历史保存失败，本次会话仍可使用，刷新后可能丢失。',
        { cause: error },
      ).toState()
    }
  },
  // 产品区域独立保存历史偏好。
  loadSettings() {
    try {
      return readStored<unknown>(SETTINGS_STORAGE_KEY)
    } catch (error) {
      console.warn('[Any Music] 无法读取筛选历史设置，将使用默认值。', error)
      return undefined
    }
  },
  saveSettings(settings) {
    try {
      writeStored(SETTINGS_STORAGE_KEY, settings)
    } catch (error) {
      console.warn('[Any Music] 无法保存筛选历史设置，本次会话中的设置仍然有效。', error)
      return new AppError(
        'storage-write-failed',
        '筛选历史设置保存失败，本次会话仍然有效，刷新后可能丢失。',
        { cause: error },
      ).toState()
    }
  },
}
