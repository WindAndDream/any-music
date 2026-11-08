import type { CatalogDrawerView } from '@any-music/ui'
import { describe, expect, it, vi } from 'vitest'
import { effectScope } from 'vue'

import { useCatalogReload } from '#workbench/features/music-sources/use-catalog-reload'

function createDrawer(): CatalogDrawerView {
  return {
    id: 'drawer:1',
    pluginId: 'douyin',
    pluginName: '抖音',
    kind: 'search',
    input: '周杰伦',
    title: '自定义名称',
    isExpanded: true,
    isSourceEnabled: true,
    tracks: [
      {
        id: 'track:1',
        title: '歌曲',
        artists: [],
        source: { pluginId: 'douyin', resourceId: '1', mediaKind: 'video' },
      },
    ],
    loadedPageCount: 1,
    hasMore: true,
    isLoading: false,
    status: 'ready',
    errorMessage: '',
    invalidReason: '',
  }
}

describe('useCatalogReload', () => {
  it('keeps current results and overlays on cancellation and permits another refresh', async () => {
    const drawer = createDrawer()
    const confirm = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true)
    const onReloadStart = vi.fn()
    const reload = vi.fn().mockResolvedValue(undefined)
    const scope = effectScope()
    const controller = scope.run(() =>
      useCatalogReload({ getDrawer: () => drawer, confirm, reload, onReloadStart }),
    )!
    await controller.reloadDrawer(drawer.id, 'refresh')
    expect(confirm).toHaveBeenLastCalledWith(expect.objectContaining({ confirmLabel: '刷新列表' }))
    expect(drawer.tracks).toHaveLength(1)
    expect(onReloadStart).not.toHaveBeenCalled()
    expect(reload).not.toHaveBeenCalled()
    await controller.reloadDrawer(drawer.id, 'refresh')
    expect(onReloadStart).toHaveBeenCalledExactlyOnceWith(drawer.id)
    expect(reload).toHaveBeenCalledExactlyOnceWith(drawer.id)
    scope.stop()
  })

  it.each(['disabled', 'removed', 'loading', 'verifying', 'disposed'])(
    'ignores duplicate confirmation and rechecks %s before clearing results',
    async (change) => {
      let drawer: CatalogDrawerView | undefined = createDrawer()
      let finish!: (confirmed: boolean) => void
      const confirm = vi.fn(() => new Promise<boolean>((resolve) => (finish = resolve)))
      const reload = vi.fn().mockResolvedValue(undefined)
      const onReloadStart = vi.fn()
      const scope = effectScope()
      const controller = scope.run(() =>
        useCatalogReload({ getDrawer: () => drawer, confirm, reload, onReloadStart }),
      )!
      const pending = controller.reloadDrawer(drawer.id)
      await controller.reloadDrawer(drawer.id)
      expect(confirm).toHaveBeenCalledOnce()
      if (change === 'disabled') drawer.isSourceEnabled = false
      if (change === 'removed') drawer = undefined
      if (change === 'loading') drawer!.isLoading = true
      if (change === 'verifying') drawer!.isVerifying = true
      if (change === 'disposed') scope.stop()
      finish(true)
      await pending
      expect(onReloadStart).not.toHaveBeenCalled()
      expect(reload).not.toHaveBeenCalled()
      scope.stop()
    },
  )

  it('refreshes an empty successful list without confirmation and closes overlays before requesting', async () => {
    const drawer = { ...createDrawer(), tracks: [] }
    const confirm = vi.fn()
    const order: string[] = []
    const reload = vi.fn(async () => {
      order.push('request')
    })
    const onReloadStart = vi.fn(() => {
      order.push('close')
    })
    const scope = effectScope()
    const controller = scope.run(() =>
      useCatalogReload({ getDrawer: () => drawer, confirm, reload, onReloadStart }),
    )!
    await controller.reloadDrawer(drawer.id, 'refresh')
    expect(confirm).not.toHaveBeenCalled()
    expect(order).toEqual(['close', 'request'])
    scope.stop()
  })
})
