import {
  AppError,
  DEFAULT_DOWNLOAD_CONCURRENCY,
  normalizeDownloadConcurrency,
} from '@any-music/core'
import type { CatalogRequestKind } from '@any-music/ui'

import {
  DEFAULT_NETWORK_PROXY_SETTINGS,
  sanitizeNetworkProxySettings,
  type NetworkProxySettings,
} from '../settings/network-proxy-settings'
import {
  sanitizeCatalogResultSnapshot,
  type CatalogResultSnapshot,
} from './catalog-result-snapshot'

/** 工作区保存请求与稳定结果元数据；媒体地址和运行端会话禁止落盘。 */
export const MUSIC_SOURCE_WORKSPACE_SCHEMA_VERSION = 1

export type { CatalogRequestKind } from '@any-music/ui'

/** 单个结果抽屉的稳定请求与可直接续载的位置。 */
export interface CatalogDrawerRecipe {
  id: string
  pluginId: string
  kind: CatalogRequestKind
  input: string
  title: string
  /** 命名操作保存初始默认标题，平台改名/卸载后也可以可靠恢复。 */
  originalTitle?: string
  /** 缺失表示未置顶；只保存偏好，不触发列表加载。 */
  isPinned?: boolean
  isExpanded: boolean
  createdAtMs: number
  result?: CatalogResultSnapshot
}

/** 全局音乐源设置、输入草稿与结果抽屉的版本化持久化格式。 */
export interface MusicSourceWorkspaceSnapshot {
  schemaVersion: typeof MUSIC_SOURCE_WORKSPACE_SCHEMA_VERSION
  disabledPluginIds: readonly string[]
  /** 只记录用户主动选择的平台。 */
  activePluginId?: string
  proxySettings: NetworkProxySettings
  /** 整个应用共享的下载 worker 数；每个批次开始时读取一次快照。 */
  downloadConcurrency: number
  searchQuery: string
  importUrl: string
  drawers: readonly CatalogDrawerRecipe[]
  unavailableTrackIds?: readonly string[]
}

export const MAX_MUSIC_SOURCE_DRAWER_COUNT = 200
const MAX_INPUT_LENGTH = 4_096
const MAX_TITLE_LENGTH = 80
const MAX_PLUGIN_ID_LENGTH = 200

export function createEmptyMusicSourceWorkspace(): MusicSourceWorkspaceSnapshot {
  return {
    schemaVersion: MUSIC_SOURCE_WORKSPACE_SCHEMA_VERSION,
    disabledPluginIds: [],
    proxySettings: { ...DEFAULT_NETWORK_PROXY_SETTINGS },
    downloadConcurrency: DEFAULT_DOWNLOAD_CONCURRENCY,
    searchQuery: '',
    importUrl: '',
    drawers: [],
  }
}

/**
 * 校验不可信的稳定存储内容，并限制配方数量与文本长度，避免损坏快照拖垮界面。
 * 新增音乐源不写入 disabledPluginIds，因此会自然保持“默认启用”。
 */
export function sanitizeMusicSourceWorkspaceSnapshot(input: unknown): MusicSourceWorkspaceSnapshot {
  if (!isRecord(input) || input.schemaVersion !== MUSIC_SOURCE_WORKSPACE_SCHEMA_VERSION) {
    return createEmptyMusicSourceWorkspace()
  }

  const drawerIds = new Set<string>()
  const drawers: CatalogDrawerRecipe[] = []
  if (Array.isArray(input.drawers)) {
    for (const candidate of input.drawers) {
      if (drawers.length >= MAX_MUSIC_SOURCE_DRAWER_COUNT) break
      const drawer = sanitizeDrawer(candidate)
      if (!drawer || drawerIds.has(drawer.id)) continue
      drawerIds.add(drawer.id)
      drawers.push(drawer)
    }
  }

  return {
    schemaVersion: MUSIC_SOURCE_WORKSPACE_SCHEMA_VERSION,
    disabledPluginIds: readUniqueStrings(input.disabledPluginIds, MAX_PLUGIN_ID_LENGTH, 500),
    ...(readRequiredBoundedString(input.activePluginId, MAX_PLUGIN_ID_LENGTH)
      ? { activePluginId: readRequiredBoundedString(input.activePluginId, MAX_PLUGIN_ID_LENGTH) }
      : {}),
    // 未配置代理时使用直连。
    proxySettings: sanitizeNetworkProxySettings(input.proxySettings),
    // 未配置下载设置时使用双并发默认值。
    downloadConcurrency: normalizeDownloadConcurrency(input.downloadConcurrency),
    searchQuery: readBoundedString(input.searchQuery, MAX_INPUT_LENGTH),
    importUrl: readBoundedString(input.importUrl, MAX_INPUT_LENGTH),
    drawers,
    ...(Array.isArray(input.unavailableTrackIds)
      ? { unavailableTrackIds: readUniqueStrings(input.unavailableTrackIds, 1_000, 20_000) }
      : {}),
  }
}

/** 抽屉名称采用与其他用户命名一致的 NFKC 规范化和长度约束。 */
export function normalizeCatalogDrawerTitle(input: string): string {
  const title = input.normalize('NFKC').trim().replace(/\s+/g, ' ')
  if (!title) throw new AppError('invalid-input', '抽屉名称不能为空。')
  if (title.length > MAX_TITLE_LENGTH) {
    throw new AppError('invalid-input', `抽屉名称不能超过 ${MAX_TITLE_LENGTH} 个字符。`)
  }
  return title
}

function sanitizeDrawer(input: unknown): CatalogDrawerRecipe | undefined {
  if (!isRecord(input)) return undefined
  const id = readRequiredBoundedString(input.id, MAX_PLUGIN_ID_LENGTH)
  const pluginId = readRequiredBoundedString(input.pluginId, MAX_PLUGIN_ID_LENGTH)
  const requestInput = readRequiredBoundedString(input.input, MAX_INPUT_LENGTH)
  const title = readRequiredBoundedString(input.title, MAX_TITLE_LENGTH)
  const createdAtMs = readNonNegativeNumber(input.createdAtMs)
  if (
    !id ||
    !pluginId ||
    !requestInput ||
    !title ||
    (input.kind !== 'search' && input.kind !== 'import-url') ||
    typeof input.isExpanded !== 'boolean' ||
    createdAtMs === undefined
  ) {
    return undefined
  }
  return {
    id,
    pluginId,
    kind: input.kind,
    input: requestInput,
    title,
    ...(typeof input.originalTitle === 'string' && input.originalTitle.trim()
      ? { originalTitle: readBoundedString(input.originalTitle, MAX_TITLE_LENGTH) }
      : {}),
    ...(input.isPinned === true ? { isPinned: true } : {}),
    // 展开状态不跨刷新恢复，确保用户首次点击抽屉才会重放历史请求。
    isExpanded: false,
    createdAtMs,
    ...(input.result ? { result: sanitizeCatalogResultSnapshot(input.result, pluginId) } : {}),
  }
}

function readUniqueStrings(input: unknown, maxLength: number, maxCount: number): string[] {
  if (!Array.isArray(input)) return []
  const values = new Set<string>()
  for (const candidate of input) {
    if (values.size >= maxCount) break
    const value = readRequiredBoundedString(candidate, maxLength)
    if (value) values.add(value)
  }
  return [...values]
}

function readBoundedString(input: unknown, maxLength: number): string {
  return typeof input === 'string' ? input.slice(0, maxLength) : ''
}

function readRequiredBoundedString(input: unknown, maxLength: number): string | undefined {
  if (typeof input !== 'string') return undefined
  const value = input.trim()
  return value && value.length <= maxLength ? value : undefined
}

function readNonNegativeNumber(input: unknown): number | undefined {
  return typeof input === 'number' && Number.isFinite(input) && input >= 0 ? input : undefined
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return Boolean(input) && typeof input === 'object' && !Array.isArray(input)
}
