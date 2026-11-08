import { afterEach, describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick, shallowRef } from 'vue'
import type { EffectScope } from 'vue'

import { useCatalogErrorNotifications } from '../../../src/composables/music-sources/use-catalog-error-notifications'
import type { CatalogDrawerView } from '../../../src/product/catalog-drawer'

const scopes: EffectScope[] = []
afterEach(() => {
  for (const scope of scopes.splice(0)) scope.stop()
})

function createDrawer(overrides: Partial<CatalogDrawerView> = {}): CatalogDrawerView {
  return {
    id: 'drawer:douyin',
    pluginId: 'douyin',
    pluginName: '抖音',
    kind: 'search',
    input: '音乐',
    title: '抖音搜索：音乐',
    isExpanded: true,
    isSourceEnabled: true,
    loadedPageCount: 1,
    tracks: [],
    hasMore: true,
    isLoading: false,
    status: 'ready',
    errorMessage: '',
    invalidReason: '',
    ...overrides,
  }
}

/** 用公开列表投影驱动通知，覆盖异步请求与关闭弹窗后仍保留部分歌曲的场景。 */
function createNotifications(initialDrawers: readonly CatalogDrawerView[] = []) {
  const drawers = shallowRef(initialDrawers)
  const onError = vi.fn()
  const scope = effectScope()
  scopes.push(scope)
  scope.run(() => useCatalogErrorNotifications({ drawers, onError }))
  return { drawers, onError, scope }
}

describe('useCatalogErrorNotifications', () => {
  it.each(['ready', 'error', 'invalid', 'restoring'] as const)(
    'does not report disconnection after a %s state, including stale errors and unloading',
    async (status) => {
      const initial = createDrawer({ status, errorCode: 'network-error', errorMessage: '旧错误' })
      const { drawers, onError } = createNotifications([initial])
      drawers.value = [{ ...initial, isSourceEnabled: false }]
      await nextTick()
      drawers.value = [{ ...drawers.value[0]!, status: 'disconnected' }]
      await nextTick()
      drawers.value = [{ ...drawers.value[0]!, status: 'missing' }]
      await nextTick()
      expect(onError).not.toHaveBeenCalled()
    },
  )

  it.each(['search', 'import-url'] as const)(
    'notifies a new %s first-page failure without requiring a songs view',
    async (kind) => {
      const { drawers, onError } = createNotifications()
      drawers.value = [
        createDrawer({
          kind,
          status: 'invalid',
          errorCode: 'invalid-response',
          errorMessage: '来源返回异常。',
          hasMore: false,
          loadedPageCount: 0,
        }),
      ]
      await nextTick()
      expect(onError).toHaveBeenCalledExactlyOnceWith('drawer:douyin')
    },
  )

  it.each(['pagination-unavailable', 'verification-required', 'network-error'] as const)(
    'notifies %s after partial results and does not repeat during browsing',
    async (errorCode) => {
      const initial = createDrawer({ tracks: [{ id: 'douyin:1' }] as never })
      const { drawers, onError } = createNotifications([initial])
      drawers.value = [{ ...initial, isLoading: true }]
      await nextTick()
      expect(onError).not.toHaveBeenCalled()

      const failed = {
        ...initial,
        status: 'error' as const,
        errorCode,
        errorMessage: '无法继续加载，已保留当前结果。',
        hasMore: false,
      }
      drawers.value = [failed]
      await nextTick()
      expect(onError).toHaveBeenCalledExactlyOnceWith(initial.id)
      expect(drawers.value[0]?.tracks).toEqual(initial.tracks)

      drawers.value = [{ ...failed, isExpanded: false }]
      await nextTick()
      drawers.value = [{ ...failed, isExpanded: true, title: '重命名后的列表' }]
      await nextTick()
      expect(onError).toHaveBeenCalledTimes(1)
    },
  )

  it('reports the same failure again after an explicit recovery attempt', async () => {
    const failed = createDrawer({ status: 'error', errorCode: 'network-error' })
    const { drawers, onError } = createNotifications([failed])
    expect(onError).not.toHaveBeenCalled()
    drawers.value = [{ ...failed, status: 'restoring', isLoading: true }]
    await nextTick()
    drawers.value = [failed]
    await nextTick()
    expect(onError).toHaveBeenCalledExactlyOnceWith(failed.id)
  })

  it('waits for loading to settle and reports source failures only when they change', async () => {
    const ready = createDrawer()
    const { drawers, onError, scope } = createNotifications([ready])
    drawers.value = [{ ...ready, status: 'error', isLoading: true, errorCode: 'rate-limited' }]
    await nextTick()
    expect(onError).not.toHaveBeenCalled()
    drawers.value = [{ ...drawers.value[0]!, isLoading: false }]
    await nextTick()
    expect(onError).toHaveBeenCalledTimes(1)
    drawers.value = [{ ...ready, status: 'paused', invalidReason: '来源已停用。' }]
    await nextTick()
    expect(onError).toHaveBeenCalledTimes(2)
    scope.stop()
    drawers.value = [{ ...ready, status: 'missing', invalidReason: '来源已卸载。' }]
    await nextTick()
    expect(onError).toHaveBeenCalledTimes(2)
  })
})
