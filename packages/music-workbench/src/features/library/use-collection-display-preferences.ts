import { toAppErrorState } from '@any-music/core'
import type { AppErrorState } from '@any-music/core'
import type {
  CollectionDisplayId,
  CollectionDisplayRegion,
  CollectionDisplayPreferences,
} from '@any-music/ui/library'
import { shallowRef } from 'vue'

import { readStored, writeStored } from '../../runtime/storage'

/** Stable view preferences use the injected runtime namespace, never page/WebView storage. */
export function useCollectionDisplayPreferences(collection: CollectionDisplayId) {
  const key = `collection-display:${collection}:v1`
  const preferences = shallowRef<Readonly<Record<string, CollectionDisplayPreferences>>>(load())
  let needsSave = false

  function load(): Record<string, CollectionDisplayPreferences> {
    try {
      const stored = readStored<unknown>(key)
      if (
        !stored ||
        typeof stored !== 'object' ||
        !('schemaVersion' in stored) ||
        stored.schemaVersion !== 1 ||
        !('views' in stored) ||
        !stored.views ||
        typeof stored.views !== 'object'
      )
        return {}
      return Object.fromEntries(
        Object.entries(stored.views)
          .slice(0, 103)
          .flatMap(([scope, value]) => {
            if (!isScope(scope) || !value || typeof value !== 'object') return []
            const { displayMode, mobileColumns, itemStyle, layout } =
              value as Partial<CollectionDisplayPreferences>
            return [
              [
                scope,
                {
                  displayMode:
                    displayMode === 'comfortable' || displayMode === 'compact'
                      ? displayMode
                      : 'standard',
                  mobileColumns: mobileColumns === 2 ? 2 : 1,
                  ...(itemStyle === 'minimal' || itemStyle === 'default' ? { itemStyle } : {}),
                  ...(['grid', 'list', 'fill', 'rows'].includes(layout ?? '') ? { layout } : {}),
                },
              ],
            ]
          }),
      )
    } catch (error) {
      console.warn('[Any Music] 无法读取列表展示偏好，已使用默认展示方式。', error)
      return {}
    }
  }
  function get(scope: string): CollectionDisplayPreferences {
    const region =
      scope === 'playlist-cards' || (collection === 'playlists' && scope.startsWith('overview:'))
        ? 'playlist-cards'
        : 'tracks'
    return {
      itemStyle: 'minimal',
      ...(preferences.value[scope] ?? getDefault(region)),
    }
  }
  function getDefault(region: CollectionDisplayRegion): CollectionDisplayPreferences {
    return {
      itemStyle: 'minimal',
      ...(preferences.value[`default:${region}`] ?? { displayMode: 'standard', mobileColumns: 1 }),
    }
  }
  function set(scope: string, patch: Partial<CollectionDisplayPreferences>): AppErrorState | void {
    if (
      !isScope(scope) ||
      (!scope.startsWith('default:') &&
        !Object.hasOwn(preferences.value, scope) &&
        Object.keys(preferences.value).filter((scopeKey) => !scopeKey.startsWith('default:'))
          .length >= 100)
    )
      return
    const previous = scope.startsWith('default:')
      ? getDefault(scope.slice(8) as CollectionDisplayRegion)
      : get(scope)
    const next = { ...previous, ...patch }
    if (
      next.displayMode === previous.displayMode &&
      next.mobileColumns === previous.mobileColumns &&
      next.layout === previous.layout &&
      next.itemStyle === previous.itemStyle &&
      !needsSave
    )
      return
    preferences.value = { ...preferences.value, [scope]: next }
    try {
      writeStored(key, { schemaVersion: 1, views: preferences.value })
      needsSave = false
    } catch (error) {
      needsSave = true
      console.warn('[Any Music] 无法保存列表展示偏好，本次会话中的设置仍然有效。', error)
      return toAppErrorState(
        error,
        'storage-write-failed',
        '展示方式保存失败，本次会话仍可使用，刷新后可能丢失。',
      )
    }
  }
  return {
    preferences,
    get,
    set,
    getDefault,
    setDefault: (region: CollectionDisplayRegion, patch: Partial<CollectionDisplayPreferences>) =>
      set(`default:${region}`, patch),
  }
}

function isScope(scope: string): boolean {
  return (
    (scope.length <= 1_000 &&
      /^(overview|playlist:[a-f0-9-]{36}):(flat|platform(?::.+)?)$/.test(scope)) ||
    scope === 'flat' ||
    scope === 'items' ||
    scope === 'playlist-cards' ||
    scope === 'platform' ||
    ['default:tracks', 'default:playlist-cards', 'default:associated-tracks'].includes(scope) ||
    ['all', 'downloading', 'paused', 'succeeded', 'failed'].includes(scope) ||
    (scope.startsWith('platform:') && scope.length > 9 && scope.length <= 1_000)
  )
}
