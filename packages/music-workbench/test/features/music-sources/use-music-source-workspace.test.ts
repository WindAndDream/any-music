import type {
  MusicSourceAvailability,
  MusicSourcePlugin,
  Track,
  TrackListing,
  TrackListingContinuation,
  TrackPage,
} from '@any-music/core'
import { AppError, createAppErrorState, DEFAULT_DOWNLOAD_CONCURRENCY } from '@any-music/core'
import { createMusicSourceRegistry } from '@any-music/plugin-center/music-sources'
import { useCatalogErrorNotifications } from '@any-music/ui'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick, shallowRef, watch } from 'vue'

import type {
  CatalogRequestKind,
  MusicSourceWorkspaceSnapshot,
} from '#workbench/features/music-sources/music-source-workspace-state'
import { sanitizeMusicSourceWorkspaceSnapshot } from '#workbench/features/music-sources/music-source-workspace-state'
import { useMusicSourceWorkspace } from '#workbench/features/music-sources/use-music-source-workspace'
import { DEFAULT_NETWORK_PROXY_SETTINGS } from '#workbench/features/settings/network-proxy-settings'

const repositoryMock = vi.hoisted(() => ({
  load: vi.fn<() => MusicSourceWorkspaceSnapshot>(),
  save: vi.fn(),
}))

vi.mock('#workbench/storage/music-source-workspace-repository', () => ({
  musicSourceWorkspaceRepository: repositoryMock,
}))

describe('useMusicSourceWorkspace', () => {
  beforeEach(() => {
    vi.stubGlobal('window', {
      clearTimeout: globalThis.clearTimeout.bind(globalThis),
      setTimeout: globalThis.setTimeout.bind(globalThis),
    })
    repositoryMock.load.mockReset()
    repositoryMock.save.mockReset()
    repositoryMock.load.mockReturnValue(createSnapshot())
    setActivePinia(createPinia())
  })

  it.each(['search', 'import-url'] as const)(
    'retains %s results across duplicate submissions and restart, requesting only the next page',
    async (kind) => {
      repositoryMock.load.mockReturnValue({ ...createSnapshot(), drawers: [] })
      const requested: number[] = []
      const request = vi.fn(() => ({
        id: 'retained',
        title: '结果',
        async *pages({
          continuation,
        }: Parameters<import('@any-music/core').TrackListing['pages']>[0] = {}) {
          for (let page = continuation?.nextPage ?? 1; page <= 3; page += 1) {
            requested.push(page)
            yield {
              items: [createTrack(page)],
              pageNumber: page,
              pageSize: 1,
              hasMore: page < 3,
              continuation: page < 3 ? { kind: 'page' as const, nextPage: page + 1 } : undefined,
            }
          }
        },
      }))
      const plugin = createPlugin(request, request)
      const first = createWorkspaceWithFallback(plugin)
      const input = kind === 'search' ? '保留搜索' : 'https://example.com/collection'
      const submit = () =>
        kind === 'search' ? first.workspace.search(input) : first.workspace.importFromUrl(input)
      await submit()
      const drawerId = first.workspace.drawers.value[0]!.id
      await first.workspace.loadNext(drawerId)
      await submit()
      first.workspace.openDrawer(drawerId)
      expect(requested).toEqual([1, 2])
      expect(request).toHaveBeenCalledOnce()
      first.workspace.persistNow()
      const snapshot = sanitizeMusicSourceWorkspaceSnapshot(repositoryMock.save.mock.lastCall![0])
      first.scope.stop()
      repositoryMock.load.mockReturnValue(snapshot)
      setActivePinia(createPinia())
      const second = createWorkspaceWithFallback(plugin)
      second.workspace.openDrawer(drawerId)
      expect(second.workspace.drawers.value[0]?.tracks.map(({ id }) => id)).toEqual([
        'test:1',
        'test:2',
      ])
      expect(requested).toEqual([1, 2])
      expect(request).toHaveBeenCalledOnce()
      await Promise.all([second.workspace.loadNext(drawerId), second.workspace.loadNext(drawerId)])
      expect(requested).toEqual([1, 2, 3])
      expect(second.workspace.drawers.value[0]?.tracks).toMatchObject([
        createTrack(1),
        createTrack(2),
        createTrack(3),
      ])
      await second.workspace.retry(drawerId)
      expect(requested).toEqual([1, 2, 3, 1])
      expect(second.workspace.drawers.value[0]?.tracks).toEqual([createTrack(1)])
      second.scope.stop()
    },
  )

  it.each([
    ['search', 'page'],
    ['search', 'cursor'],
    ['import-url', 'page'],
    ['import-url', 'cursor'],
  ] as const)(
    'keeps sixty cached %s tracks and resumes the %s checkpoint after source startup and invalidation',
    async (kind, positionKind) => {
      const position = (nextPage: number): TrackListingContinuation =>
        positionKind === 'page'
          ? { kind: 'page', nextPage }
          : { kind: 'cursor', nextPage, cursor: nextPage === 4 ? 731 : 950 }
      const cachedTracks = Array.from({ length: 60 }, (_, index) => createTrack(index + 1))
      const snapshot = createSnapshot(kind)
      snapshot.drawers[0]!.result = {
        tracks: cachedTracks,
        loadedPageCount: 3,
        total: 100,
        hasMore: true,
        continuation: position(4),
      }
      repositoryMock.load.mockReturnValue(snapshot)
      const requested: number[] = []
      const positions: (TrackListingContinuation | undefined)[] = []
      const request = vi.fn(() => ({
        id: 'retained',
        title: '结果',
        async *pages({ continuation, startPage = 1 }: Parameters<TrackListing['pages']>[0] = {}) {
          positions.push(continuation)
          for (let page = continuation?.nextPage ?? startPage; page <= 5; page += 1) {
            requested.push(page)
            yield {
              items: Array.from({ length: 20 }, (_, index) =>
                createTrack((page - 1) * 20 + index + 1),
              ),
              pageNumber: page,
              pageSize: 20,
              total: 100,
              hasMore: page < 5,
              continuation: page < 5 ? position(page + 1) : undefined,
            }
          }
        },
      }))
      const registry = createMusicSourceRegistry({
        externalPlugins: 'none',
        builtInPlugins: [createPlugin(request, request)],
      })
      const plugin = registry.getPlugin('test')!
      const sourceAllowed = shallowRef(true)
      const scope = effectScope()
      const workspace = scope.run(() =>
        useMusicSourceWorkspace({
          plugins: [plugin],
          availabilityByPluginId: { test: { status: 'available', checkedAtMs: 1 } },
          activePlugin: plugin,
          activatePlugin: vi.fn(),
          getPlugin: () => plugin,
          isPluginAllowed: () => sourceAllowed.value,
        }),
      )!
      try {
        // Module startup temporarily withdraws the source and revokes its old generation.
        sourceAllowed.value = false
        registry.setEnabled('test', false)
        workspace.invalidateSource({
          pluginId: 'test',
          error: createAppErrorState('operation-cancelled'),
        })
        registry.setEnabled('test', true)
        sourceAllowed.value = true
        await nextTick()
        workspace.openDrawer('drawer:saved')
        expect(workspace.drawers.value[0]?.tracks).toEqual(cachedTracks)
        expect(request).not.toHaveBeenCalled()

        const pending = workspace.loadNext('drawer:saved')
        expect(workspace.drawers.value[0]?.tracks).toMatchObject(cachedTracks)
        await Promise.all([pending, workspace.loadNext('drawer:saved')])
        expect(requested).toEqual([4])
        expect(positions).toEqual([position(4)])
        expect(workspace.drawers.value[0]?.tracks).toHaveLength(80)

        registry.invalidateSource('test')
        workspace.invalidateSource({
          pluginId: 'test',
          error: createAppErrorState('operation-cancelled'),
        })
        await workspace.loadNext('drawer:saved')
        expect(requested).toEqual([4, 5])
        expect(positions).toEqual([position(4), position(5)])
        expect(workspace.drawers.value[0]?.tracks).toMatchObject(
          Array.from({ length: 100 }, (_, index) => createTrack(index + 1)),
        )

        registry.invalidateSource('test')
        workspace.invalidateSource({
          pluginId: 'test',
          error: createAppErrorState('operation-cancelled'),
        })
        await workspace.loadNext('drawer:saved')
        expect(requested).toEqual([4, 5])
        expect(workspace.drawers.value[0]?.tracks).toHaveLength(100)
        await workspace.retry('drawer:saved')
        expect(requested).toEqual([4, 5, 1])
        expect(workspace.drawers.value[0]?.tracks).toHaveLength(20)
        expect(request).toHaveBeenCalledTimes(3)
      } finally {
        scope.stop()
        registry.dispose()
      }
    },
  )

  it.each(['network-error', 'pagination-unavailable'] as const)(
    'keeps cached tracks when a rebound continuation fails with %s without replaying earlier pages',
    async (code) => {
      const snapshot = createSnapshot()
      snapshot.drawers[0]!.result = {
        tracks: [createTrack(1), createTrack(2)],
        loadedPageCount: 2,
        hasMore: true,
        continuation: { kind: 'cursor', nextPage: 3, cursor: 731 },
      }
      repositoryMock.load.mockReturnValue(snapshot)
      const requested: number[] = []
      const request = vi.fn(() => ({
        id: 'failed-continuation',
        title: '结果',
        async *pages({ startPage = 1 }: Parameters<TrackListing['pages']>[0] = {}) {
          requested.push(startPage)
          if (startPage > 1) throw new AppError(code)
          yield { items: [createTrack(1)], pageNumber: 1, pageSize: 1, hasMore: false }
        },
      }))
      const { workspace, scope } = createWorkspaceWithFallback(createPlugin(request, request))
      try {
        workspace.invalidateSource({
          pluginId: 'test',
          error: createAppErrorState('operation-cancelled'),
        })
        await workspace.loadNext('drawer:saved')
        expect(workspace.drawers.value[0]).toMatchObject({
          tracks: [createTrack(1), createTrack(2)],
          loadedPageCount: 2,
          errorCode: code,
          hasMore: false,
        })
        await workspace.loadNext('drawer:saved')
        expect(requested).toEqual([3])
        expect(request).toHaveBeenCalledOnce()
        await workspace.retry('drawer:saved')
        expect(requested).toEqual([3, 1])
        expect(workspace.drawers.value[0]?.tracks).toMatchObject([createTrack(1)])
      } finally {
        scope.stop()
      }
    },
  )

  it('retains unsupported continuation results and permanent resource failures without replaying or misclassifying transient errors', async () => {
    const snapshot = createSnapshot()
    snapshot.drawers = snapshot.drawers.map((recipe) => ({
      ...recipe,
      result: {
        tracks: [createTrack(1)],
        loadedPageCount: 1,
        hasMore: true,
      },
    }))
    repositoryMock.load.mockReturnValue(snapshot)
    const request = vi.fn()
    const first = createWorkspaceWithFallback(createPlugin(request, request))
    first.workspace.openDrawer('drawer:saved')
    await first.workspace.loadNext('drawer:saved')
    expect(request).not.toHaveBeenCalled()
    expect(first.workspace.drawers.value[0]).toMatchObject({
      tracks: [createTrack(1)],
      errorCode: 'pagination-unavailable',
      hasMore: false,
    })
    for (const code of [
      'network-error',
      'request-timeout',
      'rate-limited',
      'verification-required',
      'media-unavailable',
      'invalid-response',
    ] as const)
      first.workspace.markTrackUnavailable('test:1', createAppErrorState(code))
    expect(first.workspace.invalidTrackIds.value.size).toBe(0)
    first.workspace.markTrackUnavailable('test:1', createAppErrorState('not-found'))
    expect(first.workspace.invalidTrackIds.value.has('test:1')).toBe(true)
    first.workspace.persistNow()
    const saved = sanitizeMusicSourceWorkspaceSnapshot(repositoryMock.save.mock.lastCall![0])
    first.scope.stop()
    repositoryMock.load.mockReturnValue(saved)
    setActivePinia(createPinia())
    const second = createWorkspaceWithFallback(createPlugin(request, request))
    expect(second.workspace.invalidTrackIds.value.has('test:1')).toBe(true)
    expect(request).not.toHaveBeenCalled()
    second.workspace.markTrackAvailable('test:1')
    expect(second.workspace.invalidTrackIds.value.has('test:1')).toBe(false)
    second.scope.stop()
  })

  it.each(['search', 'import-url'] as const)(
    'updates a new %s drawer even when a synchronous view reads it before its runtime exists',
    async (kind) => {
      repositoryMock.load.mockReturnValue({ ...createSnapshot(), drawers: [] })
      let release!: () => void
      const waiting = new Promise<void>((resolve) => {
        release = resolve
      })
      const requestedPages: number[] = []
      const request = vi.fn(() => ({
        id: 'listing',
        title: '列表',
        async *pages() {
          await waiting
          yield* createPages(requestedPages)
        },
      }))
      const { scope, workspace } = createWorkspaceWithFallback(createPlugin(request, request))
      const observedStatuses: string[] = []
      scope.run(() =>
        watch(
          workspace.drawers,
          (drawers) => {
            if (drawers[0]) observedStatuses.push(drawers[0].status)
          },
          { flush: 'sync', immediate: true },
        ),
      )
      try {
        const pending =
          kind === 'search'
            ? workspace.search('古风')
            : workspace.importFromUrl('https://example.com/collection')
        expect(workspace.drawers.value[0]).toMatchObject({
          status: 'restoring',
          isLoading: true,
          isSourceEnabled: true,
        })
        release()
        await pending
        expect(workspace.drawers.value[0]).toMatchObject({
          status: 'ready',
          loadedPageCount: 1,
          tracks: [createTrack(1)],
          hasMore: true,
        })
        await workspace.loadNext(workspace.drawers.value[0]!.id)
        expect(workspace.drawers.value[0]?.tracks).toEqual([createTrack(1), createTrack(2)])
        expect(request).toHaveBeenCalledTimes(1)
        expect(requestedPages).toEqual([1, 2])
        expect(observedStatuses).not.toContain('missing')
      } finally {
        release()
        scope.stop()
      }
    },
  )

  it('keeps zero usable sources without rewriting switches or replaying recipes after recovery', async () => {
    repositoryMock.load.mockReturnValue({ ...createSnapshot(), disabledPluginIds: ['fallback'] })
    const request = vi.fn(() => ({ id: 'list', title: '列表', pages: () => createPages([]) }))
    const plugin = createPlugin(request, request)
    const fallback = { ...plugin, descriptor: { ...plugin.descriptor, id: 'fallback' } }
    const availability = shallowRef<Readonly<Record<string, MusicSourceAvailability>>>({
      test: { status: 'unavailable', checkedAtMs: 1, error: createAppErrorState('network-error') },
      fallback: { status: 'available', checkedAtMs: 1 },
    })
    const allowed = shallowRef(true)
    const scope = effectScope()
    const workspace = scope.run(() =>
      useMusicSourceWorkspace({
        plugins: [plugin, fallback],
        availabilityByPluginId: availability,
        activePlugin: plugin,
        activatePlugin: vi.fn(),
        getPlugin: (id) => [plugin, fallback].find((value) => value.descriptor.id === id),
        isPluginAllowed: () => allowed.value,
      }),
    )!
    expect(workspace.enabledPlugins.value).toHaveLength(0)
    workspace.persistNow()
    expect(repositoryMock.save.mock.lastCall?.[0].disabledPluginIds).toEqual(['fallback'])
    workspace.setPluginEnabled('test', false)
    expect(workspace.actionErrorState.value?.code).toBe('conflict')
    await workspace.search('音乐')
    expect(request).not.toHaveBeenCalled()
    allowed.value = false
    expect(workspace.enabledPlugins.value).toHaveLength(0)
    allowed.value = true
    availability.value = { ...availability.value, test: { status: 'available', checkedAtMs: 2 } }
    expect(workspace.enabledPlugins.value.map((value) => value.descriptor.id)).toEqual(['test'])
    expect(request).not.toHaveBeenCalled()
    scope.stop()
  })

  it('persists only reordered recipe slots, retains hidden entries and prevents crossing pinned groups', () => {
    const snapshot = createSnapshot()
    snapshot.drawers = ['p1', 'a', 'hidden', 'b', 'p2', 'c'].map((id) =>
      Object.assign({}, snapshot.drawers[0], { id, title: id, isPinned: id.startsWith('p') }),
    )
    repositoryMock.load.mockReturnValue(snapshot)
    const request = vi.fn()
    const { scope, workspace } = createWorkspaceWithFallback(createPlugin(request, request))
    expect(workspace.moveDrawer('a', 'c', ['c', 'a', 'b'])).toBe(1)
    expect(workspace.drawers.value.map((drawer) => drawer.id)).toEqual([
      'p1',
      'p2',
      'b',
      'hidden',
      'c',
      'a',
    ])
    expect(workspace.moveDrawer('p1', 'a', ['p1', 'p2', 'a'])).toBe(0)
    expect(workspace.moveDrawer('missing', 'b', ['missing', 'b'])).toBe(0)
    expect(workspace.moveDrawer('p2', 'p1', ['p1', 'p2'])).toBe(1)
    workspace.persistNow()
    const saved = repositoryMock.save.mock.lastCall![0] as MusicSourceWorkspaceSnapshot
    expect(saved.drawers.map((drawer) => drawer.id)).toEqual(['p2', 'b', 'hidden', 'c', 'p1', 'a'])
    expect(saved.drawers.every((drawer) => !('tracks' in drawer))).toBe(true)
    expect(request).not.toHaveBeenCalled()
    scope.stop()
    repositoryMock.load.mockReturnValue(saved)
    setActivePinia(createPinia())
    const restored = createWorkspaceWithFallback(createPlugin(request, request))
    expect(restored.workspace.drawers.value.map((drawer) => drawer.id)).toEqual([
      'p2',
      'p1',
      'b',
      'hidden',
      'c',
      'a',
    ])
    expect(request).not.toHaveBeenCalled()
    restored.scope.stop()
  })

  it('restores the selected platform after recreating the workbench without fetching pages', () => {
    const request = vi.fn(() => ({ id: 'listing', title: '列表', pages: () => createPages([]) }))
    const plugin = createPlugin(request, request)
    const fallback = { ...plugin, descriptor: { ...plugin.descriptor, id: 'fallback' } }
    const activePlugin = shallowRef(plugin)
    const activatePlugin = vi.fn((id: string) => {
      activePlugin.value = id === 'fallback' ? fallback : plugin
    })
    const options = {
      plugins: [plugin, fallback],
      availabilityByPluginId: {
        test: { status: 'available' as const, checkedAtMs: 1 },
        fallback: { status: 'available' as const, checkedAtMs: 1 },
      },
      activePlugin,
      activatePlugin,
      getPlugin: (id: string) => [plugin, fallback].find((item) => item.descriptor.id === id),
    }
    const scope = effectScope()
    const workspace = scope.run(() => useMusicSourceWorkspace(options))!
    workspace.selectPlugin('fallback')
    expect(repositoryMock.save.mock.lastCall?.[0].activePluginId).toBe('fallback')
    scope.stop()
    repositoryMock.load.mockReturnValue(repositoryMock.save.mock.lastCall?.[0])
    setActivePinia(createPinia())
    activePlugin.value = plugin
    const restored = effectScope()
    restored.run(() => useMusicSourceWorkspace(options))
    expect(activePlugin.value.descriptor.id).toBe('fallback')
    expect(request).not.toHaveBeenCalled()
    restored.stop()
  })

  it.each(['missing', 'fallback'])(
    'falls back from an unavailable saved platform %s without rewriting the preference',
    (savedId) => {
      repositoryMock.load.mockReturnValue({
        ...createSnapshot(),
        activePluginId: savedId,
        disabledPluginIds: ['fallback'],
      })
      const request = vi.fn()
      const { scope, workspace } = createWorkspaceWithFallback(createPlugin(request, request))
      workspace.persistNow()
      expect(repositoryMock.save.mock.lastCall?.[0].activePluginId).toBe(savedId)
      expect(request).not.toHaveBeenCalled()
      scope.stop()
    },
  )

  it('restores the last request identity without presenting a stale account status', () => {
    const snapshot = createSnapshot()
    snapshot.drawers = snapshot.drawers.map((recipe) => ({
      ...recipe,
      result: {
        tracks: [createTrack(1)],
        loadedPageCount: 1,
        hasMore: false,
        account: { id: 'previous', name: '上次账号' },
      },
    }))
    repositoryMock.load.mockReturnValue(snapshot)
    const request = vi.fn()
    const { workspace, scope } = createWorkspaceWithFallback(createPlugin(request, request))
    expect(workspace.drawers.value[0]).toMatchObject({
      account: { id: 'previous', name: '上次账号' },
      accountStatusVisible: false,
    })
    workspace.openDrawer('drawer:saved')
    expect(workspace.drawers.value[0]?.accountStatusVisible).toBe(true)
    expect(request).not.toHaveBeenCalled()
    scope.stop()
  })

  it('retains the actual first-page account identity without persisting runtime state', async () => {
    const listing: ReturnType<MusicSourcePlugin['search']> = {
      id: 'listing',
      title: '结果',
      async *pages() {
        listing.account = { id: 'winner', name: '实际用户', customName: '备用身份' }
        yield* createPages([])
      },
    }
    const plugin = createPlugin(() => listing, vi.fn())
    const scope = effectScope()
    const workspace = scope.run(() =>
      useMusicSourceWorkspace({
        plugins: [plugin],
        availabilityByPluginId: { test: { status: 'available', checkedAtMs: 1 } },
        activePlugin: plugin,
        activatePlugin: vi.fn(),
        getPlugin: () => plugin,
        getSourceAccount: () => ({ name: '当前选中用户' }),
      }),
    )!
    await workspace.retry('drawer:saved')
    expect(workspace.drawers.value[0]?.account).toEqual(listing.account)
    workspace.persistNow()
    expect(JSON.stringify(repositoryMock.save.mock.lastCall?.[0])).toContain('实际用户')
    scope.stop()
  })

  it('retains the selected request identity when the first page fails', async () => {
    const request = () => ({
      id: 'listing',
      title: '结果',
      account: {
        id: 'selected',
        name: '请求账号',
        state: {
          login: 'signed-in' as const,
          verification: 'unknown' as const,
          connection: 'unknown' as const,
        },
      },
      async *pages(): AsyncIterable<TrackPage> {
        await Promise.reject(new AppError('network-error'))
        yield { items: [], pageNumber: 1, pageSize: 1, hasMore: false }
      },
    })
    const { workspace, scope } = createWorkspaceWithFallback(createPlugin(request, request))
    await workspace.retry('drawer:saved')
    expect(workspace.drawers.value[0]?.account?.name).toBe('请求账号')
    const saved = repositoryMock.save.mock.lastCall?.[0].drawers[0].result.account
    expect(saved).toMatchObject({ id: 'selected', name: '请求账号' })
    expect(saved.state).toBeUndefined()
    scope.stop()
  })

  it('retains the userscript single account identity when the active platform later changes', async () => {
    let knownName = '宿主用户名'
    const plugin = createPlugin(
      () => ({ id: 'listing', title: '结果', pages: () => createPages([]) }),
      vi.fn(),
    )
    const scope = effectScope()
    const workspace = scope.run(() =>
      useMusicSourceWorkspace({
        plugins: [plugin],
        availabilityByPluginId: { test: { status: 'available', checkedAtMs: 1 } },
        activePlugin: plugin,
        activatePlugin: vi.fn(),
        getPlugin: () => plugin,
        getSourceAccount: () => ({ name: knownName }),
      }),
    )!
    await workspace.retry('drawer:saved')
    knownName = '另一平台用户名'
    expect(workspace.drawers.value[0]?.account?.name).toBe('宿主用户名')
    expect(repositoryMock.save.mock.lastCall?.[0].drawers[0].result.account.name).toBe('宿主用户名')
    scope.stop()
  })

  it('restores legacy and new names without fetching pages and preserves original titles after reload', async () => {
    const request = vi.fn(() => ({ id: 'listing', title: '列表', pages: () => createPages([]) }))
    const { workspace, scope, plugins } = createWorkspaceWithFallback(
      createPlugin(request, request),
    )
    expect(workspace.drawers.value[0]?.isCustomNamed).toBe(true)
    expect(workspace.restoreDrawerNames(['drawer:saved', 'drawer:saved', 'missing'])).toBe(1)
    expect(workspace.drawers.value[0]).toMatchObject({
      title: '测试源 · 搜索：历史搜索',
      isCustomNamed: false,
    })
    workspace.renameDrawer('drawer:saved', '通勤')
    expect(workspace.drawers.value[0]?.isCustomNamed).toBe(true)
    plugins.value = plugins.value.map((plugin) =>
      Object.assign({}, plugin, {
        descriptor: Object.assign({}, plugin.descriptor, { name: '新平台名称' }),
      }),
    )
    expect(workspace.restoreDrawerNames(['drawer:saved'])).toBe(1)
    expect(workspace.drawers.value[0]?.title).toBe('测试源 · 搜索：历史搜索')
    expect(workspace.restoreDrawerNames(['drawer:saved'])).toBe(0)
    workspace.persistNow()
    const saved = repositoryMock.save.mock.lastCall?.[0]
    expect(sanitizeMusicSourceWorkspaceSnapshot(saved).drawers[0]?.originalTitle).toBe(
      '测试源 · 搜索：历史搜索',
    )
    expect(request).not.toHaveBeenCalled()
    await nextTick()
    scope.stop()
  })

  it.each(['search', 'import-url'] as const)(
    'refreshes the saved %s input from page one, clearing results and keeping recipe metadata',
    async (kind) => {
      repositoryMock.load.mockReturnValue(createSnapshot(kind, '原始请求'))
      const requestedPages: number[] = []
      let finish!: () => void
      let requestCount = 0
      const request = vi.fn(() => {
        const current = ++requestCount
        return {
          id: `listing:${current}`,
          title: '来源列表',
          async *pages() {
            if (current === 2) await new Promise<void>((resolve) => (finish = resolve))
            yield* createPages(requestedPages)
          },
        }
      })
      const unused = vi.fn()
      const plugin = createPlugin(
        kind === 'search' ? request : unused,
        kind === 'import-url' ? request : unused,
      )
      const { workspace, scope } = createWorkspaceWithFallback(plugin)
      await workspace.retry('drawer:saved')
      await workspace.loadNext('drawer:saved')
      workspace.removeTracks('drawer:saved', ['test:1'])
      workspace.renameDrawer('drawer:saved', '自定义名称')
      workspace.toggleDrawerPinned('drawer:saved')
      expect(workspace.drawers.value[0]?.tracks).toEqual([createTrack(2)])

      const refresh = workspace.retry('drawer:saved')
      const duplicateRefresh = workspace.retry('drawer:saved')
      expect(workspace.drawers.value[0]).toMatchObject({
        tracks: [],
        loadedPageCount: 0,
        status: 'restoring',
        isLoading: true,
        input: '原始请求',
        title: '自定义名称',
        isPinned: true,
        createdAtMs: 1,
      })
      finish()
      await Promise.all([refresh, duplicateRefresh])
      expect(request.mock.calls).toEqual([
        [kind === 'search' ? { query: '原始请求' } : { url: '原始请求' }],
        [kind === 'search' ? { query: '原始请求' } : { url: '原始请求' }],
      ])
      expect(unused).not.toHaveBeenCalled()
      expect(requestedPages).toEqual([1, 2, 1])
      expect(workspace.drawers.value[0]).toMatchObject({
        tracks: [createTrack(1)],
        loadedPageCount: 1,
        status: 'ready',
        isLoading: false,
      })
      scope.stop()
    },
  )

  it.each(['search', 'import-url'] as const)(
    'keeps loaded %s results without a checkpoint after disablement and restarts only on explicit refresh',
    async (kind) => {
      repositoryMock.load.mockReturnValue(createSnapshot(kind))
      const requestedPages: number[] = []
      const request = vi.fn(() => ({
        id: 'listing:disabled',
        title: '音乐',
        pages: () => createPages(requestedPages),
      }))
      const { workspace, scope, onError } = createWorkspaceWithFallback(
        createPlugin(request, request),
      )
      await workspace.retry('drawer:saved')
      workspace.setPluginEnabled('test', false)
      expect(workspace.drawers.value[0]).toMatchObject({
        status: 'disconnected',
        isSourceEnabled: false,
        hasMore: false,
        isLoading: false,
        loadedPageCount: 1,
        tracks: [createTrack(1)],
        errorCode: undefined,
        errorMessage: '',
      })
      workspace.openDrawer('drawer:saved')
      await workspace.loadNext('drawer:saved')
      await workspace.retry('drawer:saved')
      await nextTick()
      expect(request).toHaveBeenCalledTimes(1)
      expect(requestedPages).toEqual([1])
      expect(onError).not.toHaveBeenCalled()

      workspace.setPluginEnabled('test', true)
      await nextTick()
      expect(workspace.drawers.value[0]).toMatchObject({ status: 'ready', hasMore: true })
      expect(requestedPages).toEqual([1])
      await workspace.loadNext('drawer:saved')
      expect(workspace.drawers.value[0]).toMatchObject({
        tracks: [createTrack(1)],
        errorCode: 'pagination-unavailable',
        hasMore: false,
      })
      await workspace.loadNext('drawer:saved')
      expect(requestedPages).toEqual([1])
      expect(request).toHaveBeenCalledTimes(1)
      await workspace.retry('drawer:saved')
      expect(requestedPages).toEqual([1, 1])
      expect(request).toHaveBeenCalledTimes(2)
      await workspace.loadNext('drawer:saved')
      expect(workspace.drawers.value[0]?.tracks).toEqual([createTrack(1), createTrack(2)])
      expect(requestedPages).toEqual([1, 1, 2])
      expect(request).toHaveBeenCalledTimes(2)
      scope.stop()
    },
  )

  it.each([
    ['network-error', false],
    ['invalid-response', false],
    ['not-found', false],
    ['pagination-unavailable', true],
  ] as const)(
    'replaces %s with disconnection without reporting another error',
    async (code, hasTracks) => {
      const requestedPages: number[] = []
      const request = vi.fn(() => ({
        id: 'listing:failed',
        title: '音乐',
        async *pages() {
          requestedPages.push(1)
          if (hasTracks) {
            yield { items: [createTrack(1)], pageNumber: 1, pageSize: 1, hasMore: true }
            requestedPages.push(2)
          }
          throw new AppError(code, '停用前的错误')
        },
      }))
      const { workspace, scope, onError } = createWorkspaceWithFallback(
        createPlugin(request, request),
      )
      await workspace.retry('drawer:saved')
      if (hasTracks) await workspace.loadNext('drawer:saved')
      await nextTick()
      expect(onError).toHaveBeenCalledTimes(1)
      onError.mockClear()
      workspace.setPluginEnabled('test', false)
      await workspace.loadNext('drawer:saved')
      await workspace.retry('drawer:saved')
      await nextTick()
      expect(workspace.drawers.value[0]).toMatchObject({
        status: 'disconnected',
        errorCode: undefined,
        errorMessage: '',
        tracks: hasTracks ? [createTrack(1)] : [],
        hasMore: false,
      })
      expect(onError).not.toHaveBeenCalled()
      expect(request).toHaveBeenCalledTimes(1)
      expect(requestedPages).toEqual(hasTracks ? [1, 2] : [1])
      scope.stop()
    },
  )

  it.each([
    [false, false],
    [false, true],
    [true, false],
    [true, true],
  ])('ignores late pages while disabled (partial: %s, failure: %s)', async (hasTracks, fails) => {
    let finish!: () => void
    const response = new Promise<void>((resolve) => {
      finish = resolve
    })
    const requestedPages: number[] = []
    const request = vi.fn(() => ({
      id: 'listing:pending',
      title: '音乐',
      async *pages() {
        requestedPages.push(1)
        if (hasTracks) {
          yield { items: [createTrack(1)], pageNumber: 1, pageSize: 1, hasMore: true }
          requestedPages.push(2)
        }
        await response
        if (fails) throw new AppError('network-error', '晚到的错误')
        yield {
          items: [createTrack(2)],
          pageNumber: hasTracks ? 2 : 1,
          pageSize: 1,
          hasMore: false,
        }
      },
    }))
    const { workspace, scope, onError } = createWorkspaceWithFallback(
      createPlugin(request, request),
    )
    let pending = workspace.retry('drawer:saved')
    if (hasTracks) {
      await pending
      pending = workspace.loadNext('drawer:saved')
    }
    expect(workspace.drawers.value[0]?.isLoading).toBe(true)
    workspace.setPluginEnabled('test', false)
    expect(workspace.isBusy.value).toBe(false)
    finish()
    await pending
    await nextTick()
    expect(workspace.drawers.value[0]).toMatchObject({
      status: 'disconnected',
      isLoading: false,
      tracks: hasTracks ? [createTrack(1)] : [],
      errorCode: 'operation-cancelled',
      errorMessage: expect.stringContaining('加载已中止'),
    })
    await workspace.loadNext('drawer:saved')
    expect(onError).toHaveBeenCalledExactlyOnceWith('drawer:saved')

    workspace.setPluginEnabled('test', true)
    await vi.waitFor(() => expect(workspace.drawers.value[0]?.status).toBe('error'))
    expect(requestedPages).toEqual(hasTracks ? [1, 2] : [1])
    expect(request).toHaveBeenCalledTimes(1)
    expect(workspace.drawers.value[0]?.tracks).toEqual(hasTracks ? [createTrack(1)] : [])
    expect(onError).toHaveBeenCalledTimes(1)
    scope.stop()
  })

  it('does not restore saved recipes whose source is already disabled', async () => {
    repositoryMock.load.mockReturnValue({ ...createSnapshot(), disabledPluginIds: ['test'] })
    const request = vi.fn(() => ({ id: 'saved', title: '音乐', pages: () => createPages([]) }))
    const { workspace, scope, onError } = createWorkspaceWithFallback(
      createPlugin(request, request),
    )
    workspace.openDrawer('drawer:saved')
    await workspace.retry('drawer:saved')
    await nextTick()
    expect(workspace.drawers.value[0]?.status).toBe('disconnected')
    expect(request).not.toHaveBeenCalled()
    expect(onError).not.toHaveBeenCalled()
    workspace.setPluginEnabled('test', true)
    workspace.openDrawer('drawer:saved')
    await vi.waitFor(() => expect(workspace.drawers.value[0]?.loadedPageCount).toBe(1))
    expect(request).toHaveBeenCalledTimes(1)
    scope.stop()
  })

  it('keeps loaded tracks and replaces failures with a neutral state when the source is removed', async () => {
    const request = vi.fn(() => ({ id: 'saved', title: '音乐', pages: () => createPages([]) }))
    const { workspace, scope, onError, plugins } = createWorkspaceWithFallback(
      createPlugin(request, request),
    )
    await workspace.retry('drawer:saved')
    plugins.value = plugins.value.filter((plugin) => plugin.descriptor.id !== 'test')
    await nextTick()
    await workspace.loadNext('drawer:saved')
    await workspace.retry('drawer:saved')
    expect(workspace.drawers.value[0]).toMatchObject({
      status: 'missing',
      isSourceEnabled: false,
      tracks: [createTrack(1)],
      hasMore: false,
      errorMessage: '',
    })
    expect(request).toHaveBeenCalledTimes(1)
    expect(onError).not.toHaveBeenCalled()
    scope.stop()
  })

  it('persists pins ahead of new and repeated searches without loading dormant lists', async () => {
    const snapshot = createSnapshot()
    const saved = snapshot.drawers[0]!
    repositoryMock.load.mockReturnValue({
      ...snapshot,
      drawers: [
        { ...saved, id: 'drawer:newer', input: '较新搜索' },
        saved,
        { ...saved, id: 'drawer:older', input: '较早搜索' },
      ],
    })
    const search = vi.fn(() => ({
      id: 'search:new',
      title: '新搜索',
      pages: () => createPages([]),
    }))
    const plugin = createPlugin(search, vi.fn())
    const options = {
      plugins: [plugin],
      availabilityByPluginId: { test: { status: 'available' as const, checkedAtMs: 1 } },
      activePlugin: plugin,
      activatePlugin: vi.fn(),
      getPlugin: () => plugin,
    }
    const scope = effectScope()
    const workspace = scope.run(() => useMusicSourceWorkspace(options))!
    workspace.toggleDrawerPinned('drawer:older')
    workspace.toggleDrawerPinned('drawer:saved')
    expect(workspace.drawers.value.map((drawer) => drawer.id)).toEqual([
      'drawer:saved',
      'drawer:older',
      'drawer:newer',
    ])
    expect(search).not.toHaveBeenCalled()

    await workspace.search('新搜索')
    await workspace.search('较新搜索')
    expect(workspace.drawers.value.slice(0, 2).map((drawer) => drawer.id)).toEqual([
      'drawer:saved',
      'drawer:older',
    ])
    workspace.toggleDrawerPinned('drawer:saved')
    expect(workspace.drawers.value.map((drawer) => drawer.id)).toEqual([
      'drawer:older',
      'drawer:newer',
      expect.any(String),
      'drawer:saved',
    ])
    workspace.persistNow()
    const persisted = repositoryMock.save.mock.lastCall![0] as MusicSourceWorkspaceSnapshot
    expect(persisted.drawers.find((drawer) => drawer.id === 'drawer:older')?.isPinned).toBe(true)
    expect(persisted.drawers.find((drawer) => drawer.id === 'drawer:saved')?.isPinned).toBe(false)
    scope.stop()

    repositoryMock.load.mockReturnValue(sanitizeMusicSourceWorkspaceSnapshot(persisted))
    setActivePinia(createPinia())
    const restoredScope = effectScope()
    const restored = restoredScope.run(() => useMusicSourceWorkspace(options))!
    expect(restored.drawers.value[0]).toMatchObject({
      id: 'drawer:older',
      isPinned: true,
      status: 'idle',
    })
    expect(restored.drawers.value.every((drawer) => !drawer.isExpanded)).toBe(true)
    expect(restored.drawers.value.filter((drawer) => drawer.tracks.length > 0)).toHaveLength(2)
    expect(search).toHaveBeenCalledTimes(2)
    restoredScope.stop()
  })

  it.each([
    ['search', '历史搜索'],
    ['import-url', 'https://example.com/list'],
  ] as const)('restores a saved %s drawer when its song page first opens', async (kind, input) => {
    const requestedPages: number[] = []
    let finishFirstPage!: () => void
    const firstPageReady = new Promise<void>((resolve) => {
      finishFirstPage = resolve
    })
    async function* pages(): AsyncIterable<TrackPage> {
      for await (const page of createPages(requestedPages)) {
        if (page.pageNumber === 1) await firstPageReady
        yield page
      }
    }
    const search = vi.fn(() => ({
      id: 'search:saved',
      title: '历史搜索',
      pages,
    }))
    const importFromUrl = vi.fn(() => ({
      id: 'import:saved',
      title: '历史导入',
      pages,
    }))
    const request = kind === 'search' ? search : importFromUrl
    const otherRequest = kind === 'search' ? importFromUrl : search
    repositoryMock.load.mockReturnValue(createSnapshot(kind, input))
    const plugin = createPlugin(search, importFromUrl)
    const scope = effectScope()
    const workspace = scope.run(() =>
      useMusicSourceWorkspace({
        plugins: [plugin],
        availabilityByPluginId: {
          test: { status: 'available', checkedAtMs: 1 },
        },
        activePlugin: plugin,
        activatePlugin: vi.fn(),
        getPlugin: (pluginId) => (pluginId === plugin.descriptor.id ? plugin : undefined),
      }),
    )!

    expect(request).not.toHaveBeenCalled()
    expect(otherRequest).not.toHaveBeenCalled()
    expect(requestedPages).toEqual([])
    expect(workspace.drawers.value[0]).toMatchObject({
      id: 'drawer:saved',
      isExpanded: false,
      status: 'idle',
      loadedPageCount: 0,
      createdAtMs: 1,
    })

    workspace.openDrawer('drawer:saved')
    workspace.openDrawer('drawer:saved')

    await vi.waitFor(() => expect(requestedPages).toEqual([1]))
    expect(workspace.drawers.value[0]).toMatchObject({ status: 'restoring', isLoading: true })
    workspace.toggleDrawer('drawer:saved')
    workspace.openDrawer('drawer:saved')
    await workspace.loadNext('drawer:saved')
    expect(request).toHaveBeenCalledOnce()
    expect(requestedPages).toEqual([1])
    finishFirstPage()

    await vi.waitFor(() => {
      expect(workspace.drawers.value[0]).toMatchObject({
        isExpanded: true,
        status: 'ready',
        loadedPageCount: 1,
        hasMore: true,
      })
    })
    expect(request).toHaveBeenCalledTimes(1)
    expect(otherRequest).not.toHaveBeenCalled()
    expect(requestedPages).toEqual([1])

    workspace.openDrawer('drawer:saved')
    expect(request).toHaveBeenCalledTimes(1)
    expect(workspace.drawers.value[0]?.createdAtMs).toBe(1)

    await workspace.loadNext('drawer:saved')
    expect(workspace.drawers.value[0]).toMatchObject({
      loadedPageCount: 2,
      hasMore: false,
    })
    expect(requestedPages).toEqual([1, 2])

    workspace.toggleDrawer('drawer:saved')
    workspace.toggleDrawer('drawer:saved')
    expect(request).toHaveBeenCalledTimes(1)
    expect(requestedPages).toEqual([1, 2])

    scope.stop()
  })

  it('removes selected tracks without consuming the remaining lazy pages', async () => {
    const requestedPages: number[] = []
    const search = vi.fn(() => ({
      id: 'search:saved',
      title: '历史搜索',
      pages: () => createPages(requestedPages, 2),
    }))
    const plugin = createPlugin(search, vi.fn())
    const scope = effectScope()
    const workspace = scope.run(() =>
      useMusicSourceWorkspace({
        plugins: [plugin],
        availabilityByPluginId: {
          test: { status: 'available', checkedAtMs: 1 },
        },
        activePlugin: plugin,
        activatePlugin: vi.fn(),
        getPlugin: () => plugin,
      }),
    )!

    workspace.toggleDrawer('drawer:saved')
    await vi.waitFor(() => expect(workspace.drawers.value[0]?.loadedPageCount).toBe(1))
    expect(requestedPages).toEqual([1])

    workspace.removeTracks('drawer:saved', ['test:1'])

    expect(workspace.drawers.value[0]?.tracks).toEqual([])
    expect(workspace.drawers.value[0]?.hasMore).toBe(true)
    expect(requestedPages).toEqual([1])
    scope.stop()
  })

  it('recovers an offline search without requiring the user to submit the query again', async () => {
    repositoryMock.load.mockReturnValue({ ...createSnapshot(), drawers: [] })
    let isOnline = false
    const requestedPages: number[] = []
    const plugin = createPlugin(
      () => ({
        id: 'search:offline',
        title: '离线搜索',
        pages: async function* () {
          requestedPages.push(1)
          if (!isOnline) throw new AppError('network-error', '当前设备处于离线状态。')
          yield { items: [createTrack(1)], pageNumber: 1, pageSize: 1, hasMore: false }
        },
      }),
      vi.fn(),
    )
    const scope = effectScope()
    const workspace = scope.run(() =>
      useMusicSourceWorkspace({
        plugins: [plugin],
        availabilityByPluginId: { test: { status: 'available', checkedAtMs: 1 } },
        activePlugin: plugin,
        activatePlugin: vi.fn(),
        getPlugin: () => plugin,
      }),
    )!

    const onError = vi.fn()
    scope.run(() => useCatalogErrorNotifications({ drawers: workspace.drawers, onError }))
    await workspace.search('离线搜索')
    await nextTick()
    const drawerId = workspace.drawers.value[0]!.id
    expect(workspace.drawers.value[0]).toMatchObject({
      status: 'error',
      errorCode: 'network-error',
      tracks: [],
      hasMore: false,
    })
    expect(onError).toHaveBeenCalledExactlyOnceWith(drawerId)

    // 明确恢复后若仍然断网，即使错误内容相同也应重新弹出指引。
    await workspace.retry(drawerId)
    await nextTick()
    expect(onError).toHaveBeenCalledTimes(2)

    isOnline = true
    await workspace.retry(drawerId)
    expect(workspace.drawers.value[0]).toMatchObject({
      status: 'ready',
      errorCode: undefined,
      loadedPageCount: 1,
    })
    expect(workspace.drawers.value[0]?.tracks.map((track) => track.id)).toEqual(['test:1'])
    expect(requestedPages).toEqual([1, 1, 1])
    expect(onError).toHaveBeenCalledTimes(2)
    scope.stop()
  })

  it.each(['network-error', 'pagination-unavailable', 'verification-required'] as const)(
    'notifies %s once while keeping partial results and stopping repeated paging',
    async (errorCode) => {
      let isOnline = true
      const requestedPages: number[] = []
      const plugin = createPlugin(
        () => ({
          id: 'search:partial-offline',
          title: '部分搜索结果',
          pages: async function* () {
            requestedPages.push(1)
            yield { items: [createTrack(1)], pageNumber: 1, pageSize: 1, hasMore: true }
            requestedPages.push(2)
            if (!isOnline) throw new AppError(errorCode, '后续页面无法加载。')
            yield { items: [createTrack(2)], pageNumber: 2, pageSize: 1, hasMore: false }
          },
        }),
        vi.fn(),
      )
      const scope = effectScope()
      const workspace = scope.run(() =>
        useMusicSourceWorkspace({
          plugins: [plugin],
          availabilityByPluginId: { test: { status: 'available', checkedAtMs: 1 } },
          activePlugin: plugin,
          activatePlugin: vi.fn(),
          getPlugin: () => plugin,
        }),
      )!
      const onError = vi.fn()
      scope.run(() => useCatalogErrorNotifications({ drawers: workspace.drawers, onError }))

      workspace.openDrawer('drawer:saved')
      await vi.waitFor(() => expect(workspace.drawers.value[0]?.loadedPageCount).toBe(1))
      isOnline = false
      await workspace.loadNext('drawer:saved')
      await workspace.loadNext('drawer:saved')
      await nextTick()

      expect(workspace.drawers.value[0]).toMatchObject({
        status: 'error',
        errorCode,
        loadedPageCount: 1,
        hasMore: false,
      })
      expect(workspace.drawers.value[0]?.tracks.map((track) => track.id)).toEqual(['test:1'])
      expect(requestedPages).toEqual([1, 2])
      expect(onError).toHaveBeenCalledExactlyOnceWith('drawer:saved')

      isOnline = true
      await workspace.retry('drawer:saved')
      expect(workspace.drawers.value[0]).toMatchObject({ status: 'ready', loadedPageCount: 1 })
      expect(requestedPages).toEqual([1, 2, 1])
      expect(onError).toHaveBeenCalledTimes(1)
      scope.stop()
    },
  )
})

function createWorkspaceWithFallback(plugin: MusicSourcePlugin) {
  const fallback = { ...plugin, descriptor: { ...plugin.descriptor, id: 'fallback' } }
  const plugins = shallowRef([plugin, fallback])
  const scope = effectScope()
  const workspace = scope.run(() =>
    useMusicSourceWorkspace({
      plugins,
      availabilityByPluginId: {
        test: { status: 'available', checkedAtMs: 1 },
        fallback: { status: 'available', checkedAtMs: 1 },
      },
      activePlugin: plugin,
      activatePlugin: vi.fn(),
      getPlugin: (id) => plugins.value.find((item) => item.descriptor.id === id),
    }),
  )!
  const onError = vi.fn()
  scope.run(() => useCatalogErrorNotifications({ drawers: workspace.drawers, onError }))
  return { scope, workspace, onError, plugins }
}

function createSnapshot(
  kind: CatalogRequestKind = 'search',
  input = '历史搜索',
): MusicSourceWorkspaceSnapshot {
  return {
    schemaVersion: 1,
    disabledPluginIds: [],
    proxySettings: { ...DEFAULT_NETWORK_PROXY_SETTINGS },
    downloadConcurrency: DEFAULT_DOWNLOAD_CONCURRENCY,
    searchQuery: '历史搜索',
    importUrl: '',
    drawers: [
      {
        id: 'drawer:saved',
        pluginId: 'test',
        kind,
        input,
        title: kind === 'search' ? '历史搜索' : '历史导入',
        isExpanded: false,
        createdAtMs: 1,
      },
    ],
  }
}

function createPlugin(
  search: MusicSourcePlugin['search'],
  importFromUrl: MusicSourcePlugin['importFromUrl'],
): MusicSourcePlugin {
  return {
    descriptor: {
      id: 'test',
      name: '测试源',
      provenance: 'built-in',
      capabilities: { search: true, importUrl: true, session: false },
      importUrlScopes: [{ origin: 'https://example.com', pathnamePrefix: '/' }],
    },
    checkAvailability: () => Promise.resolve({ status: 'available', checkedAtMs: 1 }),
    validateImportUrl: () => undefined,
    getSession: () => Promise.resolve({ status: 'not-required' }),
    getLoginUrl: () => undefined,
    search,
    importFromUrl,
    resolveMedia: () => Promise.reject(new Error('not used')),
  }
}

async function* createPages(requestedPages: number[], pageCount = 2): AsyncIterable<TrackPage> {
  for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
    requestedPages.push(pageNumber)
    yield {
      items: [createTrack(pageNumber)],
      pageNumber,
      pageSize: 1,
      total: pageCount,
      hasMore: pageNumber < pageCount,
    }
  }
}

function createTrack(index: number): Track {
  return {
    id: `test:${index}`,
    title: `Track ${index}`,
    artists: [{ name: 'Tester' }],
    source: { pluginId: 'test', mediaKind: 'audio', resourceId: String(index) },
  }
}
