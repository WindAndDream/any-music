import { createAppErrorState } from '@any-music/core'
import type {
  CancellationSignal,
  HttpClient,
  MusicSourcePlugin,
  ResolvedMediaSource,
  Track,
} from '@any-music/core'
import { definition as classic } from '@any-music/theme-default/vue'
import { definition as studio } from '@any-music/theme-studio/vue'
import { createCatalogTrackFilterState } from '@any-music/ui/catalog'
import type { UiThemeViews } from '@any-music/ui/theme'
import { createPinia, disposePinia } from 'pinia'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick, shallowRef } from 'vue'

import * as downloadFactory from '../../../src/features/downloads/use-download-manager'
import * as libraryFactory from '../../../src/features/library/use-local-music-library'
import * as registryFactory from '../../../src/features/music-sources/use-music-source-registry'
import * as playerFactory from '../../../src/features/player/use-audio-player'
import { useWorkbenchController } from '../../../src/features/workbench/use-workbench-controller'
import type { WorkbenchController } from '../../../src/features/workbench/use-workbench-controller'
import { configureWorkbenchRuntime } from '../../../src/runtime/workbench-runtime'
import type { SourceInvalidation } from '../../../src/runtime/workbench-runtime'
import { localMusicLibraryRepository } from '../../../src/storage/local-music-library-repository'
import { createProductGenerationStorage } from '../../../src/storage/product-generation-store'
import {
  CatalogTestElement,
  dispatchCatalogEvent,
  findCatalogElement,
  renderer,
} from '../../helpers/test-renderer'
import { memory, options } from '../../storage/product-storage-fixtures'
import { createControllerThemeFixture } from './controller-theme-fixture'

vi.mock('../../../src/features/plugins/use-workbench-root-theme', () => ({
  useWorkbenchRootTheme: () => ({
    restoreDefault: vi.fn(),
    select: vi.fn(),
    current: shallowRef({ theme: { definition: { id: 'default' } } }),
    error: shallowRef(''),
    needsRecovery: shallowRef(false),
  }),
}))
vi.mock('vue', async (load) => {
  const vue = await load<typeof import('vue')>()
  const passthrough = vue.defineComponent({
    inheritAttrs: false,
    setup:
      (_, { slots }) =>
      () =>
        slots.default?.(),
  })
  return { ...vue, Transition: passthrough, TransitionGroup: passthrough }
})
const cleanup: (() => void)[] = []
afterEach(() => {
  cleanup.splice(0).forEach((dispose) => dispose())
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})
function deferred<Value>() {
  let resolve!: (value: Value) => void
  const promise = new Promise<Value>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
const track = (id: string): Track => ({
  id,
  title: id,
  artists: [],
  durationMs: 10000,
  source: { pluginId: 'test', resourceId: id, mediaKind: 'audio' },
})
const quality = { id: 'standard', label: '标准', rank: 1 }

function mount(loadedTracks: readonly Track[] = [track('one')]) {
  vi.stubGlobal('document', {
    activeElement: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })
  vi.stubGlobal('window', {
    setTimeout,
    clearTimeout,
    location: { origin: 'https://example.com' },
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    matchMedia: () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }),
  })
  for (const name of ['Document', 'Element', 'HTMLElement', 'HTMLInputElement', 'ShadowRoot'])
    vi.stubGlobal(name, CatalogTestElement)
  const data = memory()
  const page = deferred<void>()
  const resolving = deferred<ResolvedMediaSource>()
  const requested: number[] = []
  let cancellation: CancellationSignal | undefined
  let activeReads = 0,
    maximumReads = 0
  const search = vi.fn<MusicSourcePlugin['search']>(() => ({
    id: 'listing',
    title: '结果',
    async *pages(pageOptions) {
      cancellation = pageOptions?.cancellation
      requested.push(1)
      yield { items: loadedTracks, pageNumber: 1, pageSize: loadedTracks.length, hasMore: true }
      requested.push(2)
      activeReads++
      maximumReads = Math.max(maximumReads, activeReads)
      try {
        await page.promise
      } finally {
        activeReads--
      }
      yield { items: [track('two')], pageNumber: 2, pageSize: 1, hasMore: false }
    },
  }))
  const resolveMedia = vi.fn<MusicSourcePlugin['resolveMedia']>(() => resolving.promise)
  const plugin: MusicSourcePlugin = {
    descriptor: {
      id: 'test',
      name: '测试源',
      provenance: 'built-in',
      capabilities: { search: true, importUrl: true, session: false },
      importUrlScopes: [],
    },
    checkAvailability: async () => ({ status: 'available', checkedAtMs: 1 }),
    getSession: async () => ({ status: 'not-required' }),
    getLoginUrl: () => undefined,
    validateImportUrl: () => undefined,
    search,
    importFromUrl: () => search({ query: 'import' }),
    resolveMedia,
  }
  const subscriptions: {
    listener: (event: SourceInvalidation) => void
    unsubscribe: ReturnType<typeof vi.fn>
  }[] = []
  configureWorkbenchRuntime({
    externalPlugins: 'none',
    storage: createProductGenerationStorage(data.raw, options),
    http: {} as HttpClient,
    builtInMusicSources: [plugin],
    configureProxy() {},
    openLogin() {},
    subscribeSourceInvalidation(listener) {
      const unsubscribe = vi.fn()
      subscriptions.push({ listener, unsubscribe })
      return unsubscribe
    },
  })
  const factories = [
    vi.spyOn(libraryFactory, 'useLocalMusicLibrary'),
    vi.spyOn(registryFactory, 'useMusicSourceRegistry'),
    vi.spyOn(downloadFactory, 'useDownloadManager'),
    vi.spyOn(playerFactory, 'useAudioPlayer'),
  ]
  let controller!: WorkbenchController
  let fixture!: ReturnType<typeof createControllerThemeFixture>
  const audio = {
    src: '',
    currentSrc: '',
    duration: 10,
    currentTime: 0,
    readyState: 1,
    paused: true,
    buffered: { length: 0, start: () => 0, end: () => 0 },
    load: vi.fn(),
    removeAttribute: vi.fn(),
    setAttribute: vi.fn(),
    play: vi.fn(async () => {
      audio.paused = false
      controller.player.handleNativePlay()
    }),
    pause: vi.fn(() => {
      audio.paused = true
      controller?.player.handleNativePause()
    }),
  }
  const selection = shallowRef<typeof classic | typeof studio>(classic)
  const app = renderer.createApp(
    defineComponent({
      setup() {
        controller = useWorkbenchController(
          {},
          vi.fn(),
          shallowRef(audio as unknown as HTMLAudioElement),
        )
        fixture = createControllerThemeFixture(controller)
        return () =>
          h(
            selection.value.Root,
            {
              features: fixture.features.value,
              views: selection.value.views as UiThemeViews,
              form: 'desktop',
            },
            { 'request-account': () => h('span', '稳定宿主账号') },
          )
      },
    }),
  )
  const pinia = createPinia()
  app.use(pinia)
  const root = new CatalogTestElement('root')
  app.mount(root)
  let disposed = false
  const unmount = () => {
    if (!disposed) {
      disposed = true
      app.unmount()
    }
  }
  cleanup.push(() => {
    unmount()
    disposePinia(pinia)
    page.resolve()
  })
  return {
    root,
    controller,
    fixture,
    selection,
    page,
    resolving,
    requested,
    maximumReads: () => maximumReads,
    cancellation: () => cancellation,
    search,
    resolveMedia,
    audio,
    factories,
    subscriptions,
    data,
    unmount,
  }
}
function click(root: CatalogTestElement, text: string) {
  dispatchCatalogEvent(
    findCatalogElement(root, (node) => node.tag === 'button' && node.textContent.includes(text)),
    'onClick',
  )
}
function input(root: CatalogTestElement, key: string) {
  return findCatalogElement(
    root,
    (node) => node.tag === 'input' && node.props['data-am-focus-key'] === key,
  )
}
function button(root: CatalogTestElement, label: string) {
  return findCatalogElement(
    root,
    (node) => node.tag === 'button' && node.props['aria-label'] === label,
  )
}

describe('T09 actual classic/Studio roots with one real business controller', () => {
  it('imports offline, checks only on playlist entry and releases descriptors without starting playback', async () => {
    const f = mount()
    await f.controller.modules.ready
    await f.controller.registry.checkAvailability('test')
    const release = vi.fn()
    const resolve = vi.spyOn(f.controller.registry, 'resolveMedia').mockResolvedValue({
      type: 'remote-url',
      url: 'https://example.com/temporary',
      backupUrls: [],
      quality,
      availableQualities: [quality],
      loadingStrategy: 'range',
      release,
    })
    const actions = () => f.fixture.features.value.playlists.actions
    await actions().importFile(
      new Blob([
        JSON.stringify({
          format: 'any-music-playlist',
          schemaVersion: 1,
          exportedAtMs: 1,
          exportedBy: { id: 'other-user', displayName: '作者' },
          playlist: {
            id: 'import',
            name: '导入歌单',
            trackIds: ['offline'],
            createdAtMs: 1,
            updatedAtMs: 1,
          },
          tracks: [{ track: { ...track('offline'), artists: [{ name: '歌手' }] } }],
          customTracks: [],
        }),
      ]),
    )
    const id = f.controller.library.playlists.value[0]!.id
    expect(resolve).not.toHaveBeenCalled()
    actions().open(id)
    expect(resolve).not.toHaveBeenCalled()
    f.controller.selectTab('playlists')
    await vi.waitFor(() =>
      expect(f.fixture.features.value.playlists.state.validation?.status).toBe('complete'),
    )
    expect(resolve).toHaveBeenCalledOnce()
    expect(release).toHaveBeenCalledOnce()
    expect(f.fixture.features.value.playlists.state.validation).toMatchObject({
      status: 'complete',
      issues: [],
    })
    expect(f.audio.play).not.toHaveBeenCalled()
    expect(f.audio.src).toBe('')
    f.selection.value = studio
    await nextTick()
    expect(resolve).toHaveBeenCalledOnce()
    expect(JSON.stringify(f.controller.library.records.value)).not.toContain('temporary')
  })

  it('projects playlist listening counts from retained history and current membership', async () => {
    const f = mount()
    await f.controller.modules.ready
    const library = f.controller.library
    const playlist = library.createPlaylist('统计歌单')
    const other = library.createPlaylist('其他歌单')
    library.addTracksToPlaylist(playlist.id, [track('one'), track('two')])
    library.addTracksToPlaylist(other.id, [track('two')])
    const counts = () => f.fixture.features.value.playlists.state.playCountByPlaylistId!
    expect(counts().get(playlist.id)).toBe(0)
    const entry = library.beginHistory(track('one'))
    library.beginHistory(track('one'))
    library.beginHistory(track('two'))
    library.beginHistory(track('outside'))
    library.updateHistory(entry, 3000, 10000)
    expect(counts().get(playlist.id)).toBe(3)
    expect(counts().get(other.id)).toBe(1)
    library.removeFromPlaylist(playlist.id, 'two')
    expect(counts().get(playlist.id)).toBe(2)
    library.setHistoryLimit(2)
    expect(counts().get(playlist.id)).toBe(0)
    expect(counts().get(other.id)).toBe(1)
    library.clearHistory()
    expect(counts().get(other.id)).toBe(0)
  })

  it.each([classic, studio])(
    'pauses $id notices and releases the pause on theme replacement',
    async (theme) => {
      vi.useFakeTimers()
      const f = mount()
      await f.controller.modules.ready
      f.selection.value = theme
      f.controller.actionFeedback.show({ status: 'error', message: '错误详情可复制' })
      await nextTick()
      const toast = findCatalogElement(f.root, (node) => node.props.role === 'alert')
      vi.advanceTimersByTime(4000)
      dispatchCatalogEvent(toast, 'onMouseenter', false)
      vi.advanceTimersByTime(10000)
      expect(f.fixture.features.value.overlays.state.notice?.message).toBe('错误详情可复制')
      dispatchCatalogEvent(toast, 'onMouseleave', false)
      vi.advanceTimersByTime(999)
      expect(f.fixture.features.value.overlays.state.notice?.message).toBe('错误详情可复制')
      vi.advanceTimersByTime(1)
      await nextTick()
      expect(f.fixture.features.value.overlays.state.notice).toBeNull()
      f.controller.playbackNotice.show('播放提示')
      await nextTick()
      const playbackToast = findCatalogElement(f.root, (node) => node.props.class === 'app-toast')
      dispatchCatalogEvent(playbackToast, 'onMouseenter', false)
      vi.advanceTimersByTime(10000)
      expect(f.controller.playbackNotice.message.value).toBe('播放提示')
      f.selection.value = theme === classic ? studio : classic
      await nextTick()
      vi.advanceTimersByTime(2200)
      expect(f.controller.playbackNotice.message.value).toBeUndefined()
    },
  )

  it('applies settings defaults through the production projection and retains local overrides across themes', async () => {
    const f = mount()
    await f.controller.modules.ready
    const features = () => f.fixture.features.value
    const setDefault = features().settings.actions.setDisplayDefault!
    setDefault('queue', 'tracks', {
      displayMode: 'compact',
      mobileColumns: 2,
      itemStyle: 'minimal',
    })
    expect(features().queue.state).toMatchObject({
      displayMode: 'compact',
      mobileColumns: 2,
      itemStyle: 'minimal',
    })
    expect(features().favorites.state.displayMode).toBe('standard')
    features().queue.actions.setDisplayMode('comfortable')
    setDefault('queue', 'tracks', { displayMode: 'standard' })
    expect(features().queue.state.displayMode).toBe('comfortable')
    setDefault('history', 'tracks', { itemStyle: 'minimal' })
    setDefault('plugins', 'tracks', { layout: 'list' })
    setDefault('tags', 'tracks', { layout: 'rows' })
    f.selection.value = studio
    await nextTick()
    expect(features().history.state.itemStyle).toBe('minimal')
    expect(features().plugins.state.defaultDisplay).toBe('list')
    expect(features().settings.state.displayDefaults?.tags?.tracks?.layout).toBe('rows')
    expect(features().queue.state.displayMode).toBe('comfortable')
    expect(f.search).not.toHaveBeenCalled()
    expect(f.resolveMedia).not.toHaveBeenCalled()
  })
  it('pauses and resumes minimal artwork without resolving again, while operator clicks only select', async () => {
    const f = mount(),
      c = f.controller
    await c.modules.ready
    await c.workspace.search('minimal playback')
    c.openCatalogDrawer(c.workspace.drawers.value[0]!.id)
    f.fixture.features.value.catalog.actions.setItemStyle?.('minimal')
    await nextTick()
    const cover = () =>
      findCatalogElement(
        f.root,
        (node) => node.tag === 'button' && node.props['data-am-focus-key'] === 'track:one:play',
      )
    dispatchCatalogEvent(cover(), 'onClick')
    await vi.waitFor(() => expect(f.resolveMedia).toHaveBeenCalledOnce())
    f.resolving.resolve({
      type: 'remote-url',
      url: 'https://example.com/audio',
      backupUrls: [],
      quality,
      availableQualities: [quality],
      loadingStrategy: 'range',
    })
    await vi.waitFor(() => expect(c.player.status.value).toBe('ready'))
    c.player.handleLoadedMetadata()
    await vi.waitFor(() => expect(cover().props.title).toBe('正在播放，点击暂停'))
    f.audio.currentTime = 4
    c.player.handleTimeUpdate()
    const loads = f.audio.load.mock.calls.length
    dispatchCatalogEvent(cover(), 'onClick')
    await vi.waitFor(() => expect(f.audio.paused).toBe(true))
    expect(cover().props['aria-label']).toBe('播放《one》')
    dispatchCatalogEvent(cover(), 'onClick')
    await vi.waitFor(() => expect(f.audio.paused).toBe(false))
    expect(f.audio.currentTime).toBe(4)
    expect(c.player.displayedPositionMs.value).toBe(4000)

    click(f.root, '操作器')
    await nextTick()
    expect(cover().props['aria-label']).toBe('选择歌曲 one')
    dispatchCatalogEvent(cover(), 'onClick')
    await nextTick()
    expect(f.fixture.selected.value).toEqual(['one'])
    expect(f.audio.paused).toBe(false)
    f.selection.value = studio
    await nextTick()
    expect(cover().props['aria-pressed']).toBe(true)
    dispatchCatalogEvent(cover(), 'onClick')
    await nextTick()
    expect(f.fixture.selected.value).toEqual([])
    expect(f.audio.paused).toBe(false)
    expect(f.resolveMedia).toHaveBeenCalledOnce()
    expect(f.audio.load).toHaveBeenCalledTimes(loads)
  })

  it('reuses collection projections and filtered songs when only display preferences change', async () => {
    const f = mount(Array.from({ length: 30 }, (_, index) => track(`song-${index}`)))
    const c = f.controller
    await c.modules.ready
    await c.workspace.search('display performance')
    c.openCatalogDrawer(c.workspace.drawers.value[0]!.id)
    const catalog = f.fixture.features.value.catalog
    const ids = catalog.state.tracks.map(({ id }) => id)
    expect(ids).toHaveLength(30)
    catalog.actions.enqueue(ids)
    for (const id of ids) catalog.actions.toggleFavorite(id)
    f.fixture.features.value.favorites.actions.select([ids[0]!])
    const before = f.fixture.features.value
    for (const mode of ['compact', 'comfortable', 'standard'] as const) {
      f.fixture.features.value.favorites.actions.setDisplayMode(mode)
      const after = f.fixture.features.value
      expect(after.favorites.state.displayMode).toBe(mode)
      expect(after.favorites.state.tracks).toBe(before.favorites.state.tracks)
      expect(after.favorites.state.addedAtMsByTrackId).toBe(
        before.favorites.state.addedAtMsByTrackId,
      )
      expect(after.favorites.state.selectedTrackIds).toEqual([ids[0]])
      for (const id of ['queue', 'playlists', 'custom-tracks', 'downloads', 'history'] as const)
        expect(after[id]).toBe(before[id])
      expect(after.catalog.state.tracks).toBe(before.catalog.state.tracks)
    }
    const downloads = f.fixture.features.value.downloads
    f.fixture.features.value.queue.actions.setMobileColumns(2)
    expect(f.fixture.features.value.queue.state.tracks).toBe(before.queue.state.tracks)
    expect(f.fixture.features.value.downloads).toBe(downloads)
    // Real mutations must still invalidate the corresponding projections.
    f.fixture.features.value.favorites.actions.toggleFavorite(ids[0]!)
    expect(f.fixture.features.value.favorites.state.tracks).toHaveLength(29)
    const filters = createCatalogTrackFilterState()
    filters.searchFilters = [{ query: 'missing' }]
    f.fixture.features.value.favorites.actions.setFilterDraft(filters)
    f.fixture.features.value.favorites.actions.applyFilters()
    expect(f.fixture.features.value.favorites.state.tracks).toHaveLength(0)
  })

  it('confirms loaded favorites and persists a large batch once without source or media requests', async () => {
    const songs = Array.from({ length: 1000 }, (_, index) => track(`song:${index}`))
    const f = mount(songs)
    const c = f.controller
    await c.modules.ready
    await c.workspace.search('batch favorites')
    const id = c.workspace.drawers.value[0]!.id
    c.library.favoriteTrack(songs[0]!)
    c.workspace.markTrackUnavailable(songs[1]!.id)
    const save = vi.spyOn(localMusicLibraryRepository, 'save')
    const singleFavorite = vi.spyOn(c.library, 'favoriteTrack')
    const favorite = () => f.fixture.features.value.catalog.actions.favoriteDrawer(id)
    const cancelled = favorite()
    expect(c.confirmationDialog.activeRequest.value?.message).toContain('1000 首歌曲')
    expect(save).not.toHaveBeenCalled()
    c.confirmationDialog.cancel()
    await cancelled
    expect(c.library.favoriteTrackIds.value.size).toBe(1)
    expect(save).not.toHaveBeenCalled()

    const pending = favorite()
    const requestId = c.confirmationDialog.activeRequest.value?.id
    await favorite()
    expect(c.confirmationDialog.activeRequest.value?.id).toBe(requestId)
    c.confirmationDialog.accept()
    await pending
    expect(save).toHaveBeenCalledOnce()
    expect(save.mock.calls[0]?.[0].tracks).toHaveLength(999)
    expect(c.library.favoriteTrackIds.value.size).toBe(999)
    expect(c.library.favoriteTrackIds.value.has(songs[1]!.id)).toBe(false)
    expect(singleFavorite).not.toHaveBeenCalled()
    expect(f.search).toHaveBeenCalledOnce()
    expect(f.requested).toEqual([1])
    expect(f.resolveMedia).not.toHaveBeenCalled()
    expect(f.fixture.features.value.overlays.state.notice?.message).toBe('已添加到我的喜欢。')
  })

  it('reports a failed favorite batch save and allows one explicit save retry', async () => {
    const f = mount()
    const c = f.controller
    await c.modules.ready
    await c.workspace.search('favorite retry')
    const id = c.workspace.drawers.value[0]!.id
    const save = vi.spyOn(localMusicLibraryRepository, 'save').mockImplementationOnce(() => {
      throw new Error('Disk full')
    })
    const first = f.fixture.features.value.catalog.actions.favoriteDrawer(id)
    c.confirmationDialog.accept()
    await first
    expect(save).toHaveBeenCalledOnce()
    expect(f.fixture.features.value.overlays.state.notice?.tone).toBe('error')

    const retry = f.fixture.features.value.catalog.actions.favoriteDrawer(id)
    c.confirmationDialog.accept()
    await retry
    expect(save).toHaveBeenCalledTimes(2)
    expect(c.library.persistenceErrorState.value).toBeUndefined()
    expect(f.fixture.features.value.overlays.state.notice?.tone).toBe('success')
  })

  it('ignores a loaded-favorites confirmation after its drawer is removed', async () => {
    const f = mount()
    const c = f.controller
    await c.modules.ready
    await c.workspace.search('removed batch')
    const id = c.workspace.drawers.value[0]!.id
    const save = vi.spyOn(localMusicLibraryRepository, 'save')
    const pending = f.fixture.features.value.catalog.actions.favoriteDrawer(id)
    c.workspace.removeDrawers([id])
    c.confirmationDialog.accept()
    await pending
    expect(save).not.toHaveBeenCalled()
    expect(c.library.favoriteTrackIds.value.size).toBe(0)
  })

  it('projects existing collection ordering and keeps it across theme replacement without replaying writes', async () => {
    const f = mount(),
      c = f.controller
    await c.modules.ready
    const one = track('one'),
      two = { ...track('two'), source: { ...track('two').source, pluginId: 'other' } },
      three = track('three')
    c.queue.addMany([one, two, three])
    const features = () => f.fixture.features.value
    features().queue.actions.setItemStyle?.('default')
    expect(features().queue.state.itemStyle).toBe('default')
    expect(features().favorites.state.itemStyle).toBe('minimal')
    expect(features().history.state.itemStyle).toBe('minimal')
    expect(features().catalog.state.itemStyle).toBe('minimal')
    expect(features().playlists.state.itemStyle).toBe('minimal')
    features().queue.actions.setArrangementMode('platform')
    expect(features().queue.state.itemStyle).toBe('default')
    expect(c.queue.items.value.map(({ id }) => id)).toEqual(['one', 'three', 'two'])
    features().queue.actions.moveTrack('three', 'one', ['one', 'three'])
    expect(c.queue.items.value.map(({ id }) => id)).toEqual(['three', 'one', 'two'])
    features().queue.actions.movePlatform('other', one.source.pluginId, [
      one.source.pluginId,
      'other',
    ])
    expect(c.queue.items.value.map(({ id }) => id)).toEqual(['two', 'three', 'one'])
    for (const id of ['one', 'two', 'three']) features().queue.actions.toggleFavorite(id)
    features().favorites.actions.setArrangementMode('platform')
    expect(c.favoriteCollection.arrangementMode.value).toBe('platform')
    const draft = createCatalogTrackFilterState()
    draft.platformIds = [one.source.pluginId]
    features().queue.actions.setFilterDraft(draft)
    features().queue.actions.applyFilters()
    expect(features().queue.state.tracks.map(({ id }) => id)).toEqual(['three', 'one'])
    expect(features().queue.state.totalCount).toBe(3)
    expect(features().queue.state.platformTrackCounts.get(one.source.pluginId)).toBe(2)
    await new Promise<void>((done) => setImmediate(done))
    const writes = f.data.writes.length
    f.selection.value = studio
    await nextTick()
    f.selection.value = classic
    await nextTick()
    expect(features().queue.state.arrangementMode).toBe('platform')
    expect(features().favorites.state.arrangementMode).toBe('platform')
    expect(c.queue.items.value.map(({ id }) => id)).toEqual(['two', 'three', 'one'])
    expect(f.data.writes).toHaveLength(writes)
  })

  it('cancels an explicit catalog read, rejects its late page and retries only on request', async () => {
    const f = mount(),
      c = f.controller
    await c.modules.ready
    await c.workspace.search('cancelled')
    const id = c.workspace.drawers.value[0]!.id
    c.openCatalogDrawer(id)
    const pending = f.fixture.features.value.catalog.actions.loadMore(id)
    await vi.waitFor(() => expect(f.requested).toEqual([1, 2]))
    f.fixture.features.value.catalog.actions.cancel(id)
    expect(f.cancellation()?.isCancelled()).toBe(true)
    f.page.resolve()
    await pending
    expect(c.activeCatalogDrawer.value?.tracks.map(({ id: trackId }) => trackId)).toEqual(['one'])
    expect(f.search).toHaveBeenCalledOnce()
    await c.workspace.retry(id)
    expect(f.requested).toEqual([1, 2, 1])
    expect(f.maximumReads()).toBe(1)
    expect(f.search).toHaveBeenCalledTimes(2)
  })
  it('uses production collection scopes and preserves named library/settings operations', async () => {
    const f = mount(),
      c = f.controller
    await c.modules.ready
    await c.workspace.search('first')
    const first = c.workspace.drawers.value[0]!.id
    c.openCatalogDrawer(first)
    const original = f.fixture.features.value.catalog.actions
    original.select(['one'])
    original.setFilterDraft({
      searchFilters: [{ query: 'unfinished' }],
      tags: [],
      publishedRanges: [],
      durationRanges: [],
    })
    await c.workspace.search('second')
    const second = c.workspace.drawers.value.find(({ id }) => id !== first)!.id
    c.openCatalogDrawer(second)
    original.select(['stale'])
    expect(f.fixture.features.value.catalog.state.selectedTrackIds).toEqual([])
    c.openCatalogDrawer(first)
    expect(f.fixture.features.value.catalog.state.selectedTrackIds).toEqual(['one'])
    expect(f.fixture.features.value.catalog.state.filterDraft?.searchFilters[0]?.query).toBe(
      'unfinished',
    )
    f.fixture.features.value.catalog.actions.enqueue(['one'])
    f.fixture.features.value.catalog.actions.toggleFavorite('one')
    expect(f.fixture.features.value.queue.state.tracks.map(({ id }) => id)).toEqual(['one'])
    const features = () => f.fixture.features.value
    features().queue.actions.setDisplayMode('comfortable')
    features().queue.actions.setMobileColumns(1)
    features().queue.actions.setArrangementMode('platform')
    expect(features().queue.state.displayMode).toBe('standard')
    expect(features().queue.state.mobileColumns).toBe(1)
    features().queue.actions.setDisplayMode('compact')
    features().queue.actions.setDisplayMode('comfortable', 'platform:test')
    features().queue.actions.setArrangementMode('flat')
    expect(features().queue.state.displayMode).toBe('comfortable')
    expect(features().queue.state.mobileColumns).toBe(1)
    expect(features().favorites.state.displayMode).toBe('standard')
    features().downloads.actions.setDisplayMode('compact')
    features().catalog.actions.setDisplayMode('comfortable')
    features().downloads.actions.setStatusFilter('failed')
    expect(features().catalog.state.displayMode).toBe('comfortable')
    expect(features().downloads.state.displayMode).toBe('standard')
    features().downloads.actions.setDisplayMode('comfortable')
    features().downloads.actions.setStatusFilter('all')
    expect(features().downloads.state.displayMode).toBe('compact')
    expect(f.fixture.features.value.favorites.state.tracks.map(({ id }) => id)).toEqual(['one'])
    f.fixture.features.value.playlists.actions.create('draft list')
    const playlist = c.library.playlists.value[0]!.id
    f.fixture.features.value.catalog.actions.addToPlaylist(playlist, ['one'])
    f.fixture.features.value.playlists.actions.renamePlaylist(playlist, 'renamed')
    f.fixture.features.value.playlists.actions.open(playlist)
    expect(f.fixture.features.value.playlists.state.tracks.map(({ id }) => id)).toEqual(['one'])
    expect(c.library.playlists.value[0]!.name).toBe('renamed')
    f.fixture.features.value.shell.actions.openSettings('appearance')
    const settings = f.fixture.features.value.settings
    settings.actions.setPreferences({ ...settings.state.preferences, sidebarSide: 'right' })
    settings.actions.setAppearance('dark')
    expect(f.fixture.features.value.navigation.state.preferences.sidebarSide).toBe('right')
    expect(f.fixture.features.value.shell.state.resolvedTheme).toBe('dark')
    expect(c.isGlobalSettingsOpen.value).toBe(true)
    settings.actions.close()
    expect(c.isGlobalSettingsOpen.value).toBe(false)
    f.factories.forEach((factory) => expect(factory).toHaveBeenCalledOnce())
  })

  it('binds confirmation acceptance and cancellation to the active host request ID', async () => {
    const f = mount(),
      c = f.controller
    await c.modules.ready
    const first = c.confirmationDialog.confirm({ title: 'one', message: 'one' })
    const original = f.fixture.features.value.overlays
    const id = c.confirmationDialog.activeRequest.value!.id
    original.actions.confirm(id + 1)
    expect(c.confirmationDialog.activeRequest.value?.id).toBe(id)
    original.actions.confirm(id)
    expect(await first).toBe(true)
    const next = c.confirmationDialog.confirm({ title: 'two', message: 'two' })
    original.actions.close(id)
    expect(c.confirmationDialog.activeRequest.value?.title).toBe('two')
    f.fixture.features.value.overlays.actions.close(c.confirmationDialog.activeRequest.value!.id)
    expect(await next).toBe(false)
  })
  it('preserves requests, selection, native playback and navigation across classic → Studio → classic', async () => {
    const f = mount(),
      c = f.controller
    await c.modules.ready
    f.fixture.features.value.catalog.actions.setItemStyle?.('default')
    // Submit from the real Studio form to the real source workspace.
    f.selection.value = studio
    await vi.waitFor(() => expect(f.root.textContent).toContain('开始搜索'))
    const query = findCatalogElement(f.root, (node) => node.props['aria-label'] === '搜索关键词')
    query.value = 'submitted'
    dispatchCatalogEvent(query, 'onInput')
    await nextTick()
    dispatchCatalogEvent(
      findCatalogElement(f.root, (node) => node.tag === 'form'),
      'onSubmit',
    )
    await vi.waitFor(() => expect(f.requested).toEqual([1]))
    const id = c.workspace.drawers.value[0]!.id
    c.openCatalogDrawer(id)
    await vi.waitFor(() => expect(input(f.root, 'track:one:select')).toBeDefined())
    dispatchCatalogEvent(input(f.root, 'track:one:select'), 'onChange')
    dispatchCatalogEvent(button(f.root, '播放 one'), 'onClick')
    await vi.waitFor(() => expect(f.resolveMedia).toHaveBeenCalledOnce())
    void c.workspace.loadNext(id)
    await vi.waitFor(() => expect(f.requested).toEqual([1, 2]))
    const subscriptions = f.subscriptions.length
    c.workspace.searchQuery.value = 'unfinished'
    c.workspace.importUrl.value = 'https://example.com/draft'
    c.workspace.persistNow()
    c.library.persistNow()
    await new Promise<void>((done) => setImmediate(done))
    const writes = f.data.writes.length
    for (const definition of [classic, studio, classic]) {
      f.selection.value = definition
      // eslint-disable-next-line no-await-in-loop
      await vi.waitFor(() => expect(input(f.root, 'track:one:select').props.checked).toBe(true))
      expect(c.player.status.value).toBe('resolving')
      expect(f.cancellation()?.isCancelled()).toBe(false)
      expect(c.activeCatalogDrawerId.value).toBe(id)
      expect(c.workspace.searchQuery.value).toBe('unfinished')
      expect(c.workspace.importUrl.value).toBe('https://example.com/draft')
      expect(f.requested).toEqual([1, 2])
      expect(f.subscriptions).toHaveLength(subscriptions)
      expect(f.data.writes).toHaveLength(writes)
    }
    const release = vi.fn()
    f.resolving.resolve({
      type: 'remote-url',
      url: 'https://example.com/audio',
      backupUrls: [],
      quality,
      availableQualities: [quality],
      loadingStrategy: 'range',
      release,
    })
    await vi.waitFor(() => expect(c.player.status.value).toBe('ready'))
    c.player.handleLoadedMetadata()
    await vi.waitFor(() => expect(c.player.displayedIsPlaying.value).toBe(true))
    const loads = f.audio.load.mock.calls.length
    f.selection.value = studio
    await vi.waitFor(() => expect(button(f.root, '暂停')).toBeDefined())
    dispatchCatalogEvent(button(f.root, '暂停'), 'onClick')
    await vi.waitFor(() => expect(f.audio.paused).toBe(true))
    dispatchCatalogEvent(button(f.root, '播放'), 'onClick')
    await vi.waitFor(() => expect(f.audio.paused).toBe(false))
    const seek = findCatalogElement(f.root, (node) => node.props['aria-label'] === '精确播放进度')
    seek.value = '4000'
    dispatchCatalogEvent(seek, 'onChange')
    expect(f.audio.currentTime).toBe(4)
    click(f.root, '我的喜欢')
    await vi.waitFor(() => expect(c.activeTab.value).toBe('favorites'))
    click(f.root, '发现')
    f.selection.value = classic
    f.page.resolve()
    await vi.waitFor(() => expect(c.activeCatalogDrawer.value?.tracks).toHaveLength(2))
    expect(f.fixture.selected.value).toEqual(['one'])
    expect(f.requested).toEqual([1, 2])
    expect(f.maximumReads()).toBe(1)
    expect(f.search).toHaveBeenCalledOnce()
    expect(f.resolveMedia).toHaveBeenCalledOnce()
    expect(f.audio.load).toHaveBeenCalledTimes(loads)
    expect(f.audio.currentTime).toBe(4)
    expect(c.player.displayedIsPlaying.value).toBe(true)
    f.factories.forEach((factory) => expect(factory).toHaveBeenCalledOnce())
    expect(release).not.toHaveBeenCalled()
    f.unmount()
    f.unmount()
    expect(release).toHaveBeenCalledOnce()
    f.subscriptions.forEach(({ unsubscribe }) => expect(unsubscribe).toHaveBeenCalledOnce())
  })

  it('preserves source cancellation and rejects a pending old page after switching roots', async () => {
    const f = mount(),
      c = f.controller
    await c.modules.ready
    await c.workspace.search('submitted')
    const id = c.workspace.drawers.value[0]!.id
    c.openCatalogDrawer(id)
    const pending = c.workspace.loadNext(id)
    await vi.waitFor(() => expect(f.requested).toEqual([1, 2]))
    f.selection.value = studio
    await vi.waitFor(() => expect(f.root.textContent).toContain('寻找下一首音乐'))
    const cancellation = f.cancellation()!
    f.subscriptions.forEach(({ listener }) =>
      listener({
        pluginId: 'test',
        error: createAppErrorState('operation-cancelled', 'account revoked'),
      }),
    )
    expect(cancellation.isCancelled()).toBe(true)
    f.page.resolve()
    await pending
    expect(c.workspace.drawers.value[0]!.tracks.map((entry) => entry.id)).toEqual(['one'])
    expect(f.search).toHaveBeenCalledOnce()
    expect(f.resolveMedia).not.toHaveBeenCalled()
  })
})
