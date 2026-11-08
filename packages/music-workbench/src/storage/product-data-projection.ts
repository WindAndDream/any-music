import { finalizeInterruptedDownloads, sanitizeDownloadHistorySnapshot } from '@any-music/core'
import type { LocalMusicLibrarySnapshot } from '@any-music/core'
import { normalizeAppShellPreferences } from '@any-music/ui'
import type { ProductViewId } from '@any-music/ui'

import { sanitizeMusicSourceWorkspaceSnapshot } from '../features/music-sources/music-source-workspace-state'
import { sanitizePlaybackQueueSnapshot } from '../features/player/playback-queue-state'
import { getWorkbenchViewKey } from '../plugin-adapters/workbench-ui'
import { sanitizeLocalMusicLibrarySnapshot } from './local-music-library-repository'
import { COMPOSER_NAMESPACE, TAG_NAMESPACE, copyJson, isRecord } from './product-data'
import type { ProductData, PluginDataNamespace } from './product-data'

export const PRODUCT_KEYS = [
  'local-library:v1',
  'playback-queue:v1',
  'music-source-workspace:v1',
  'catalog-filter-history:v2',
  'catalog-filter-history-settings:v1',
  'download-history:v1',
  'app-shell:v1',
  'ui-theme:v1',
  'favorite-collection:v1',
  'collection-display:queue:v1',
  'collection-display:favorites:v1',
  'collection-display:downloads:v1',
  'collection-display:playlists:v1',
  'download-collection-order:v1',
  'module-recovery:v1',
] as const
const HOST_KEYS: Record<string, string> = {
  'collection-display:queue:v1': 'queueDisplay',
  'collection-display:favorites:v1': 'favoritesDisplay',
  'collection-display:downloads:v1': 'downloadsDisplay',
  'collection-display:playlists:v1': 'playlistsDisplay',
  'download-collection-order:v1': 'downloadOrder',
  'catalog-filter-history-settings:v1': 'filterSettings',
  'ui-theme:v1': 'theme',
  'module-recovery:v1': 'recovery',
}

export function namespaceData(data: ProductData, id: string): Record<string, unknown> {
  const namespace = data.namespaces.find((entry) => entry.pluginId === id)
  if (!namespace) return {}
  if (namespace.schemaVersion !== 1 || !isRecord(namespace.data)) return {}
  return namespace.data
}
export function setNamespace(data: ProductData, id: string, value: unknown): void {
  // A namespace writer must never overwrite unknown newer data.
  const existing = data.namespaces.find((entry) => entry.pluginId === id)
  if (existing && (existing.schemaVersion !== 1 || !isRecord(existing.data)))
    throw new Error('Plugin data requires a newer writer; preserved read-only')
  namespaceData(data, id)
  const next: PluginDataNamespace = { pluginId: id, schemaVersion: 1, data: copyJson(value) }
  const index = data.namespaces.findIndex((entry) => entry.pluginId === id)
  if (index < 0) data.namespaces.push(next)
  else data.namespaces[index] = next
}
function canWriteNamespace(data: ProductData, id: string): boolean {
  const existing = data.namespaces.find((entry) => entry.pluginId === id)
  return !existing || (existing.schemaVersion === 1 && isRecord(existing.data))
}

/** Only host records enter the library partition; plugin namespaces have dedicated writers. */
export function writeHostLibrary(data: ProductData, library: LocalMusicLibrarySnapshot): void {
  const { tracks, customTracks, ...core } = library
  data.core.library = {
    ...core,
    tracks: tracks.map(({ customTags: _tags, ...record }) => record),
    customTracks: customTracks.map(
      ({ compiledSegments: _compiled, materialCollectionId: _collection, ...asset }) => asset,
    ),
  }
}

/** Compile published recipes for playback without reading plugin-owned data. */
export function readHostLibrary(data: ProductData): LocalMusicLibrarySnapshot {
  return sanitizeLocalMusicLibrarySnapshot(data.core.library)
}

function splitFilters(data: ProductData, input: unknown): void {
  const entries = Array.isArray(input) ? input : []
  const dormant: unknown[] = []
  data.host.filters = entries.map((entry, index) => {
    if (!isRecord(entry) || !isRecord(entry.filters) || !Object.hasOwn(entry.filters, 'tags'))
      return entry
    const { tags, ...filters } = entry.filters
    dormant.push({ index, scopeId: entry.scopeId, dimension: entry.dimension, tags })
    return Object.assign({}, entry, { filters })
  })
  if (!canWriteNamespace(data, TAG_NAMESPACE)) {
    if (
      dormant.some(
        (condition) =>
          isRecord(condition) && Array.isArray(condition.tags) && condition.tags.length > 0,
      )
    )
      throw new Error('Plugin data requires a newer writer; preserved read-only')
    return
  }
  setNamespace(data, TAG_NAMESPACE, {
    ...namespaceData(data, TAG_NAMESPACE),
    filterConditions: dormant,
  })
}
function joinFilters(data: ProductData): unknown[] {
  const dormant = namespaceData(data, TAG_NAMESPACE).filterConditions
  const byIndex = new Map(
    (Array.isArray(dormant) ? dormant : []).filter(isRecord).map((item) => [item.index, item]),
  )
  return (Array.isArray(data.host.filters) ? data.host.filters : []).map((entry, index) => {
    const condition = byIndex.get(index)
    return condition &&
      isRecord(entry) &&
      isRecord(entry.filters) &&
      condition.scopeId === entry.scopeId &&
      condition.dimension === entry.dimension
      ? Object.assign({}, entry, { filters: { ...entry.filters, tags: condition.tags } })
      : entry
  })
}

export function readProductValue(data: ProductData, key: string, proxy: unknown): unknown {
  if (key === 'plugin:feature.composer:v1') {
    const entry = data.namespaces.find((namespace) => namespace.pluginId === COMPOSER_NAMESPACE)
    if (entry && (entry.schemaVersion !== 1 || !isRecord(entry.data)))
      throw new Error('Unsupported creation namespace; preserved read-only')
    return entry?.data
  }
  if (key === 'plugin:feature.tags:v1') {
    const entry = data.namespaces.find((namespace) => namespace.pluginId === TAG_NAMESPACE)
    if (entry && (entry.schemaVersion !== 1 || !isRecord(entry.data)))
      throw new Error('Unsupported tag namespace; preserved read-only')
    return entry?.data
  }
  if (key === 'local-library:v1') return readHostLibrary(data)
  if (key === 'playback-queue:v1') return data.core.queue
  if (key === 'download-history:v1') return data.core.downloads
  if (key === 'favorite-collection:v1') return data.core.favorites
  if (key === 'music-source-workspace:v1')
    return {
      ...(data.host.workspace as object),
      disabledPluginIds: data.host.disabledPluginIds,
      proxySettings: proxy,
    }
  if (key === 'catalog-filter-history:v2') return joinFilters(data)
  if (key === 'app-shell:v1') return data.host.shell
  if (Object.hasOwn(HOST_KEYS, key)) return data.host[HOST_KEYS[key]!]
  throw new Error(`Unknown product storage key: ${key}`)
}

export function writeProductValue(data: ProductData, key: string, value: unknown): void {
  if (key === 'plugin:feature.composer:v1') {
    if (
      !isRecord(value) ||
      !Array.isArray(value.materialCollections) ||
      !Array.isArray(value.pendingMaterialTrackIds) ||
      !isRecord(value.materialCollectionByTrackId)
    )
      throw new Error('Invalid creation namespace')
    setNamespace(data, COMPOSER_NAMESPACE, value)
  } else if (key === 'plugin:feature.tags:v1') {
    if (!isRecord(value) || !Array.isArray(value.associations))
      throw new Error('Invalid tag namespace')
    setNamespace(data, TAG_NAMESPACE, value)
  } else if (key === 'local-library:v1') {
    assertCurrentSchema(value, [6])
    writeHostLibrary(data, sanitizeLocalMusicLibrarySnapshot(value))
  } else if (key === 'playback-queue:v1') {
    assertCurrentSchema(value, [1])
    data.core.queue = sanitizePlaybackQueueSnapshot(value)
  } else if (key === 'download-history:v1') {
    assertCurrentSchema(value, [2])
    data.core.downloads = sanitizeDownloadHistorySnapshot(value)
  } else if (key === 'favorite-collection:v1') {
    assertCurrentSchema(value, [1])
    if (!isRecord(value)) throw new Error('Invalid favorite ordering')
    data.core.favorites = {
      schemaVersion: 1,
      trackIds: Array.isArray(value.trackIds)
        ? value.trackIds.filter((id) => typeof id === 'string')
        : [],
      arrangementMode: value.arrangementMode === 'platform' ? 'platform' : 'flat',
    }
  } else if (key === 'music-source-workspace:v1') {
    assertCurrentSchema(value, [1])
    const {
      disabledPluginIds,
      proxySettings: _proxy,
      ...workspace
    } = sanitizeMusicSourceWorkspaceSnapshot(value)
    data.host.workspace = workspace
    data.host.disabledPluginIds = disabledPluginIds
  } else if (key === 'catalog-filter-history:v2') splitFilters(data, value)
  else if (key === 'app-shell:v1') {
    assertCurrentSchema(value, [1])
    const shell = normalizeAppShellPreferences(value)
    data.host.shell = shell
    data.host.navigation = {
      order: shell.destinationOrder.map((id: ProductViewId) => getWorkbenchViewKey(id)),
      hidden: shell.hiddenDestinationIds.map((id: ProductViewId) => getWorkbenchViewKey(id)),
    }
  } else if (Object.hasOwn(HOST_KEYS, key)) data.host[HOST_KEYS[key]!] = value
  else throw new Error(`Unknown product storage key: ${key}`)
}
function assertCurrentSchema(value: unknown, versions: number[]): void {
  if (
    isRecord(value) &&
    value.schemaVersion !== undefined &&
    !versions.includes(value.schemaVersion as number)
  )
    throw new Error('Unknown repository schema; retained read-only')
}

export function createProductData(
  values: Record<string, unknown> = {},
  now = Date.now(),
): ProductData {
  const data: ProductData = {
    schemaVersion: 1,
    core: {} as ProductData['core'],
    host: {},
    namespaces: [],
  }
  for (const key of PRODUCT_KEYS) {
    const value = values[key]
    if (
      value !== undefined ||
      [
        'local-library:v1',
        'playback-queue:v1',
        'music-source-workspace:v1',
        'download-history:v1',
        'app-shell:v1',
      ].includes(key)
    )
      writeProductValue(data, key, value)
  }
  data.core.downloads = finalizeInterruptedDownloads(
    sanitizeDownloadHistorySnapshot(data.core.downloads),
    now,
  )
  return copyJson(data)
}
