import { AppError, createAppErrorState } from '@any-music/core'
import type {
  CancellationSignal,
  HttpClient,
  MusicSourcePlugin,
  ResolvedMediaSource,
  Track,
} from '@any-music/core'
import { createMusicCreationModule } from '@any-music/plugin-music-creation'
import { createSession as createCreation, Composer } from '@any-music/plugin-music-creation/vue'
import { createTagManagementModule } from '@any-music/plugin-tag-management'
import { createSession as createTags, Panel } from '@any-music/plugin-tag-management/vue'
import {
  definition as classicDefinition,
  CatalogDrawer,
  QueuePanel,
  ActiveDownloadPanel,
} from '@any-music/theme-default/vue'
import { definition as studioDefinition } from '@any-music/theme-studio/vue'
import { createCatalogTrackFilterState } from '@any-music/ui'
import { catalogRootEditingKey, createCatalogRootEditing } from '@any-music/ui/catalog'
import type { TagManagementPresentation, MusicCreationPresentation } from '@any-music/ui/theme'
import { createPinia, disposePinia } from 'pinia'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick, shallowRef } from 'vue'

import { browserDownloadScheduler } from '../../../src/features/downloads/download-scheduler'
import * as downloadFactory from '../../../src/features/downloads/use-download-manager'
import * as libraryFactory from '../../../src/features/library/use-local-music-library'
import {
  createEmptyMusicSourceWorkspace,
  type MusicSourceWorkspaceSnapshot,
} from '../../../src/features/music-sources/music-source-workspace-state'
import * as registryFactory from '../../../src/features/music-sources/use-music-source-registry'
import * as playerFactory from '../../../src/features/player/use-audio-player'
import { createWorkbenchSpecialistFeatures } from '../../../src/features/workbench/create-workbench-specialist-features'
import { useWorkbenchController } from '../../../src/features/workbench/use-workbench-controller'
import type { WorkbenchController } from '../../../src/features/workbench/use-workbench-controller'
import { createWorkbenchModuleDirectory } from '../../../src/plugin-adapters/workbench-module-directory'
import { configureWorkbenchRuntime } from '../../../src/runtime/workbench-runtime'
import type { SourceInvalidation } from '../../../src/runtime/workbench-runtime'
import { musicSourceWorkspaceRepository } from '../../../src/storage/music-source-workspace-repository'
import { createProductGenerationStorage } from '../../../src/storage/product-generation-store'
import { dispatchCatalogEvent, findCatalogElement } from '../../helpers/test-renderer'
import { renderer, CatalogTestElement } from '../../helpers/test-renderer'
import { memory, options } from '../../storage/product-storage-fixtures'
import { createControllerThemeFixture } from './controller-theme-fixture'

// T02 exercises real business/media lifetimes; complete-theme transactions have their own suite.
vi.mock('../../../src/features/plugins/use-workbench-root-theme', () => ({
  useWorkbenchRootTheme: () => ({
    restoreDefault: vi.fn(),
    select: vi.fn(),
    current: shallowRef({ theme: { definition: { id: 'default' } } }),
    error: shallowRef(''),
    needsRecovery: shallowRef(false),
  }),
}))
const encoder = vi.hoisted(() => ({
  run: vi.fn<
    (options: {
      signal?: AbortSignal
      onProgress?: (progress: { message: string }) => void
    }) => Promise<{ blob: Blob; extension: string }>
  >(),
}))
vi.mock('../../../src/features/audio-export/audio-exporter', () => ({
  exportAudioSegments: encoder.run,
}))

vi.mock('vue', async (load) => {
  const vue = await load<typeof import('vue')>()
  const transition = vue.defineComponent({
    inheritAttrs: false,
    setup:
      (_, { slots }) =>
      () =>
        slots.default?.(),
  })
  return { ...vue, Transition: transition, TransitionGroup: transition }
})
vi.mock('@any-music/ui/components/BottomSheet.vue', async () => {
  const { defineComponent: defineOverlay, h: renderOverlay } = await import('vue')
  return {
    default: defineOverlay({
      props: ['open'],
      setup:
        (props, { slots }) =>
        () =>
          props.open ? renderOverlay('section', [slots.default?.(), slots.footer?.()]) : null,
    }),
  }
})
vi.mock('@any-music/ui/components/SidePanel.vue', async () => {
  const { defineComponent: defineOverlay, h: renderOverlay } = await import('vue')
  return {
    default: defineOverlay({
      props: ['open'],
      setup:
        (props, { slots }) =>
        () =>
          props.open ? renderOverlay('aside', slots.default?.()) : null,
    }),
  }
})

const cleanup: (() => void)[] = []
afterEach(() => {
  cleanup.splice(0).forEach((dispose) => dispose())
  encoder.run.mockReset()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
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
  durationMs: 10_000,
  source: { pluginId: 'test', resourceId: id, mediaKind: 'audio' },
})
const quality = { id: 'default', label: '默认', rank: 1 }
const media = (release = vi.fn()): ResolvedMediaSource => ({
  type: 'remote-url',
  url: 'https://example.com/audio',
  backupUrls: [],
  loadingStrategy: 'range',
  quality,
  availableQualities: [quality],
  release,
})

function mountWorkbench(
  withLibrary: boolean | 'catalog' | 'root' | 'specialists' = false,
  initialWorkspace?: MusicSourceWorkspaceSnapshot,
  creationAvailable = true,
) {
  const removeMediaListener = vi.fn()
  const addMediaListener = vi.fn()
  vi.stubGlobal('window', {
    setTimeout,
    clearTimeout,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    location: { origin: 'https://example.com' },
    matchMedia: () => ({
      matches: false,
      addEventListener: addMediaListener,
      removeEventListener: removeMediaListener,
    }),
  })
  vi.stubGlobal('Document', CatalogTestElement)
  vi.stubGlobal('Element', CatalogTestElement)
  vi.stubGlobal('ShadowRoot', CatalogTestElement)
  const catalogOverlay = new CatalogTestElement('catalog-overlay')
  const catalogOperator = new CatalogTestElement('catalog-operator')
  const data = memory()
  const storage = createProductGenerationStorage(data.raw, options)
  const secondPage = deferred<void>()
  const resolving = deferred<ResolvedMediaSource>()
  let listingCancellation: CancellationSignal | undefined
  let mediaCancellation: CancellationSignal | undefined
  const requestedPages: number[] = []
  let activePageReads = 0
  let maximumPageReads = 0
  const search = vi.fn<MusicSourcePlugin['search']>(() => ({
    id: 'listing',
    title: '测试列表',
    async *pages(pageOptions) {
      listingCancellation = pageOptions?.cancellation
      requestedPages.push(1)
      yield { items: [track('one')], pageNumber: 1, pageSize: 1, hasMore: true }
      requestedPages.push(2)
      activePageReads += 1
      maximumPageReads = Math.max(maximumPageReads, activePageReads)
      try {
        await secondPage.promise
      } finally {
        activePageReads -= 1
      }
      yield { items: [track('two')], pageNumber: 2, pageSize: 1, hasMore: false }
    },
  }))
  const resolveMedia = vi.fn<MusicSourcePlugin['resolveMedia']>(async (_track, resolveOptions) => {
    mediaCancellation = resolveOptions?.cancellation
    return resolving.promise
  })
  const plugin: MusicSourcePlugin = {
    descriptor: {
      id: 'test',
      name: '测试源',
      provenance: 'built-in',
      capabilities: { search: true, importUrl: true, session: false },
      importUrlScopes: [{ origin: 'https://example.com', pathnamePrefix: '/' }],
    },
    checkAvailability: vi.fn(async () => ({ status: 'available' as const, checkedAtMs: 1 })),
    getSession: vi.fn(async () => ({ status: 'not-required' as const })),
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
  const loadTags = vi.fn(async () => ({ Panel, createSession: createTags }))
  const loadCreation = vi.fn(async () => ({ Composer, createSession: createCreation }))
  const features = [
    createTagManagementModule('userscript'),
    // Most tests exercise the admitted implementation's lifecycle; the startup gate has its own regression.
    {
      ...createMusicCreationModule('userscript'),
      ...(creationAvailable ? { unavailableReason: undefined } : {}),
    },
  ]
  configureWorkbenchRuntime({
    externalPlugins: 'none',
    storage,
    http: {} as HttpClient,
    builtInMusicSources: [plugin],
    configureProxy() {},
    openLogin() {},
    loadTagManagement: loadTags,
    loadMusicCreation: loadCreation,
    modules: {
      runtime: 'userscript',
      form: 'desktop',
      features,
      directory: createWorkbenchModuleDirectory('userscript', features),
    },
    subscribeSourceInvalidation(listener) {
      const unsubscribe = vi.fn()
      subscriptions.push({ listener, unsubscribe })
      return unsubscribe
    },
  })
  if (initialWorkspace) musicSourceWorkspaceRepository.save(initialWorkspace)
  const factories = [
    vi.spyOn(libraryFactory, 'useLocalMusicLibrary'),
    vi.spyOn(registryFactory, 'useMusicSourceRegistry'),
    vi.spyOn(downloadFactory, 'useDownloadManager'),
    vi.spyOn(playerFactory, 'useAudioPlayer'),
  ]
  let specialists!: ReturnType<typeof createWorkbenchSpecialistFeatures>
  let themeFixture!: ReturnType<typeof createControllerThemeFixture>
  const TagEditor = defineComponent({
    setup:
      (_, { slots }) =>
      () => {
        const Editor = specialists.tags.state.Editor
        return Editor
          ? h(
              Editor,
              {},
              {
                default: ({ editor }: { editor: TagManagementPresentation }) => {
                  tagEditor = editor
                  return slots.default?.({ editor })
                },
              },
            )
          : null
      },
  })
  const CreationEditor = defineComponent({
    setup:
      (_, { slots }) =>
      () => {
        const Editor = specialists.composer.state.Editor
        return Editor
          ? h(
              Editor,
              {},
              {
                default: ({ editor }: { editor: MusicCreationPresentation }) => {
                  creationEditor = editor
                  return slots.default?.({ editor })
                },
              },
            )
          : null
      },
  })
  let tagEditor: TagManagementPresentation | undefined
  let creationEditor: MusicCreationPresentation | undefined
  const presentation = shallowRef<'A' | 'B' | null>('A')
  const mounted = vi.fn()
  const root = (id: string) =>
    defineComponent({
      setup() {
        mounted(id)
        return () => {
          if (withLibrary === 'specialists') {
            const theme = id === 'A' ? classicDefinition : studioDefinition
            return h(theme.Root, {
              features: {
                ...themeFixture.features.value,
                tags: { ...specialists.tags, state: { Editor: TagEditor } },
                composer: { ...specialists.composer, state: { Editor: CreationEditor } },
              },
              views: theme.views,
              form: 'desktop',
            })
          }
          if (withLibrary === 'catalog') {
            const drawer = controller.activeCatalogDrawer.value
            return drawer
              ? h(CatalogDrawer, {
                  key: drawer.id,
                  drawer,
                  active: true,
                  invalidTrackIds: controller.workspace.invalidTrackIds.value,
                  favoriteTrackIds: controller.library.favoriteTrackIds.value,
                  customTagsByTrackId: controller.library.customTagsByTrackId.value,
                  playlists: controller.library.playlists.value,
                  displayMode: 'standard',
                  mobileColumns: 1,
                  filterOpen: controller.isCatalogFilterOpen.value,
                  operatorOpen: true,
                  overlayTarget: catalogOverlay as unknown as HTMLElement,
                  operatorOverlayTarget: catalogOperator as unknown as HTMLElement,
                  onCloseFilter: () => {
                    controller.isCatalogFilterOpen.value = false
                  },
                  onLoadMore: controller.workspace.loadNext,
                  onSummaryChange: (summary) => {
                    controller.catalogTrackListSummary.value = summary
                  },
                })
              : h('div', id)
          }
          if (!withLibrary) return h('div', id)
          if (withLibrary === 'root') {
            const listState = {
              mobileLayout: false,
              arrangementMode: 'flat' as const,
              platformOrder: [],
              platformTrackCounts: new Map<string, number>(),
              totalCount: 0,
              tracks: controller.queue.items.value,
              selectedTrackIds: [],
              invalidTrackIds: [],
              favoriteTrackIds: [],
              queuedTrackIds: [],
              downloadedTrackIds: [],
              platformNames: new Map<string, string>(),
              customNamesByTrackId: new Map<string, string>(),
              customTagsByTrackId: new Map<string, readonly string[]>(),
              addedAtMsByTrackId: new Map<string, number>(),
              displayMode: 'standard' as const,
              mobileColumns: 1 as const,
              filters: createCatalogTrackFilterState(),
              filterDraft: null,
            }
            const listActions = {
              setArrangementMode: vi.fn(),
              moveTrack: vi.fn(),
              movePlatform: vi.fn(),
              play: vi.fn(),
              download: vi.fn(),
              toggleFavorite: vi.fn(),
              select: vi.fn(),
              setFilterDraft: vi.fn(),
              applyFilters: vi.fn(),
              cancelFilters: vi.fn(),
              showTrackActions: vi.fn(),
              enqueue: vi.fn(),
              rename: vi.fn(),
              addToPlaylist: vi.fn(),
              useAsMaterial: vi.fn(),
              addTag: vi.fn(),
              removeTag: vi.fn(),
              setDisplayMode: vi.fn(),
              setMobileColumns: vi.fn(),
            }
            const availability = { status: 'available' as const },
              status = { status: 'ready' as const }
            const theme = id === 'A' ? classicDefinition : studioDefinition
            const queue = {
              state: { ...listState, currentTrackId: null },
              actions: { ...listActions, remove: vi.fn(), reorder: vi.fn(), clear: vi.fn() },
              availability,
              status,
            }
            const downloads = {
              state: {
                ...listState,
                tracks: controller.downloads.batches.value.flatMap((batch) =>
                  batch.items.map((item) => item.track),
                ),
                batches: controller.downloads.batches.value,
                selectedItemIds: [],
                concurrency: 1,
                statusFilter: 'all' as const,
              },
              actions: {
                ...listActions,
                pause: controller.downloads.pauseDownloadItems,
                resume: async (ids: readonly string[]) => {
                  controller.downloads.resumeDownloadItems(ids)
                },
                cancel: controller.downloads.cancelDownloadItems,
                remove: async (ids: readonly string[]) => {
                  controller.downloads.removeDownloadItems(ids)
                },
                retry: async (ids: readonly string[]) => {
                  controller.downloads.resumeDownloadItems(ids)
                },
                setStatusFilter: vi.fn(),
                moveItem: themeFixture.features.value.downloads.actions.moveItem,
              },
              availability,
              status,
            }
            return h(theme.Root, {
              features: {
                ...themeFixture.features.value,
                shell: {
                  ...themeFixture.features.value.shell,
                  state: { ...themeFixture.features.value.shell.state, activeViewId: 'downloads' },
                },
                queue,
                downloads,
              },
              views: theme.views,
              form: 'desktop',
            })
          }
          if (id === 'B')
            return h(QueuePanel, {
              items: controller.queue.items.value,
              arrangementMode: 'flat',
              platformNames: new Map(),
              errorMessage: '',
              downloadBusy: false,
            })
          return h(ActiveDownloadPanel, {
            batches: controller.downloads.batches.value,
            concurrency: 1,
            mobileLayout: false,
            platformNames: new Map(),
            statusMessage: controller.downloads.statusMessage.value,
            errorMessage: controller.downloads.persistenceError.value,
            cancelling: controller.downloads.isCancelling.value,
            filterOpen: false,
            operatorOpen: false,
            panelsSuspended: false,
            overlayTarget: null,
            operatorOverlayTarget: null,
            displayMode: 'standard',
            mobileColumns: 1,
            favoriteTrackIds: new Set<string>(),
            queuedTrackIds: new Set<string>(),
            invalidTrackIds: new Set<string>(),
            customTagsByTrackId: new Map<string, readonly string[]>(),
            onPause: controller.downloads.pauseDownloadItems,
            onResume: controller.downloads.resumeDownloadItems,
            onCancel: controller.downloads.cancelDownloadItems,
            onRemove: controller.downloads.removeDownloadItems,
          })
        }
      },
    })
  const A = root('A'),
    B = root('B')
  let controller!: WorkbenchController
  const app = renderer.createApp(
    defineComponent({
      setup() {
        controller = useWorkbenchController({}, vi.fn(), shallowRef(null))
        specialists = createWorkbenchSpecialistFeatures(controller)
        themeFixture = createControllerThemeFixture(controller)
        return () => (presentation.value ? h(presentation.value === 'A' ? A : B) : null)
      },
    }),
  )
  const pinia = createPinia()
  app.use(pinia)
  const rootElement = new CatalogTestElement('workbench')
  app.mount(rootElement)
  let unmounted = false
  const unmount = () => {
    if (!unmounted) {
      unmounted = true
      app.unmount()
    }
  }
  cleanup.push(() => {
    unmount()
    disposePinia(pinia)
    secondPage.resolve()
    resolving.resolve(media())
  })
  return {
    rootElement,
    get tagEditor() {
      return tagEditor!
    },
    get creationEditor() {
      return creationEditor!
    },
    get specialists() {
      return specialists
    },
    catalogOverlay,
    catalogOperator,
    controller,
    presentation,
    mounted,
    factories,
    subscriptions,
    removeMediaListener,
    addMediaListener,
    data,
    search,
    resolveMedia,
    plugin,
    requestedPages,
    maximumPageReads: () => maximumPageReads,
    secondPage,
    resolving,
    loadTags,
    loadCreation,
    unmount,
    listingCancellation: () => listingCancellation,
    mediaCancellation: () => mediaCancellation,
  }
}

describe('stable workbench lifetime', () => {
  it('never loads blocked creation and reports its configured reason without changing data', async () => {
    const f = mountWorkbench(false, undefined, false)
    await f.controller.modules.ready
    const item = f.specialists.plugins.state.items.find((entry) => entry.id === 'feature.composer')!
    expect(item).toMatchObject({ enabled: false, developmentStatus: 'developing' })
    expect(item.unavailableReason).toContain('开发中')
    const before = structuredClone(f.data.values)
    await f.specialists.plugins.actions.setEnabled(item.id, true)
    await f.controller.musicCreation.retry()
    expect(f.controller.actionFeedback.notice.value).toMatchObject({
      tone: 'info',
      message: item.unavailableReason,
    })
    expect(f.loadCreation).not.toHaveBeenCalled()
    expect(f.controller.modules.isEnabled(item.id)).toBe(false)
    expect(f.controller.modules.canOpenView('composer')).toBe(false)
    expect(f.controller.modules.canOpenView('custom-tracks')).toBe(false)
    expect(f.data.values).toEqual(before)
  })
  it('projects creation development metadata independently of the user switch', async () => {
    const f = mountWorkbench()
    await f.controller.modules.ready
    const creation = () =>
      f.specialists.plugins.state.items.find((item) => item.id === 'feature.composer')
    expect(creation()).toMatchObject({ developmentStatus: 'developing', enabled: true })
    await f.controller.modules.setEnabled('feature.composer', false)
    expect(creation()).toMatchObject({ developmentStatus: 'developing', enabled: false })
    await f.controller.modules.setEnabled('feature.composer', true)
    expect(creation()).toMatchObject({ developmentStatus: 'developing', enabled: true })
  })
  it('prepares a restored Verify action on the first error-dialog opening without requesting a page', async () => {
    const f = mountWorkbench(false, {
      ...createEmptyMusicSourceWorkspace(),
      drawers: [
        {
          id: 'saved',
          pluginId: 'test',
          kind: 'search',
          input: '音乐',
          title: '验证列表',
          isExpanded: true,
          createdAtMs: 1,
          result: {
            tracks: [track('one')],
            loadedPageCount: 7,
            hasMore: false,
            error: createAppErrorState('verification-required'),
          },
        },
      ],
    })
    await f.controller.modules.ready
    await nextTick()
    const verify = vi.fn().mockResolvedValue(undefined)
    const pages = vi.fn()
    f.search.mockReturnValue({ id: 'recovery', title: '验证列表', verify, pages })
    expect(f.search).not.toHaveBeenCalled()
    f.controller.openCatalogError('saved')
    await nextTick()
    expect(f.controller.catalogErrorDrawer.value?.canVerify).toBe(true)
    expect(f.search).toHaveBeenCalledOnce()
    expect(pages).not.toHaveBeenCalled()
    expect(verify).not.toHaveBeenCalled()
    expect(f.requestedPages).toEqual([])
  })
  it.each(['pagination-unavailable', 'network-error', 'verification-required'] as const)(
    'restores a saved %s failure without opening a dialog or requesting its source',
    async (code) => {
      const savedTrack = { ...track('one'), artists: [{ name: '测试作者' }] }
      const f = mountWorkbench(false, {
        ...createEmptyMusicSourceWorkspace(),
        drawers: [
          {
            id: 'saved',
            pluginId: 'test',
            kind: 'search',
            input: '音乐',
            title: '已保存的搜索',
            isExpanded: true,
            createdAtMs: 1,
            result: {
              tracks: [savedTrack],
              loadedPageCount: 1,
              hasMore: false,
              error: createAppErrorState(code, '后续结果暂时无法获取。'),
            },
          },
        ],
      })
      const c = f.controller
      await c.modules.ready
      await nextTick()
      expect(c.workspace.drawers.value[0]).toMatchObject({
        errorCode: code,
        tracks: [savedTrack],
      })
      expect(c.catalogErrorDrawerId.value).toBeUndefined()
      expect(c.isExternalOverlayOpen.value).toBe(false)
      expect(f.search).not.toHaveBeenCalled()
      c.openCatalogError('saved')
      await nextTick()
      expect(c.catalogErrorDrawer.value?.errorCode).toBe(code)
      // Opening a saved challenge may construct its lightweight verification
      // closure; neither restoring nor opening it may consume a source page.
      expect(f.search).toHaveBeenCalledTimes(code === 'verification-required' ? 1 : 0)
      expect(f.requestedPages).toEqual([])
      c.closeCatalogError()
      c.openCatalogDrawer('saved')
      await nextTick()
      expect(c.catalogErrorDrawerId.value).toBeUndefined()
      expect(f.search).toHaveBeenCalledTimes(code === 'verification-required' ? 1 : 0)
      expect(f.requestedPages).toEqual([])
    },
  )

  it.each(['search', 'import-url'] as const)(
    'keeps new %s failures available for manual inspection after repeated retries',
    async (kind) => {
      const f = mountWorkbench()
      const c = f.controller
      await c.modules.ready
      const requests = vi.fn(() => {
        throw new AppError('network-error', '连接失败')
      })
      f.search.mockImplementation(() => ({
        id: 'failed',
        title: '请求失败',
        async *pages() {
          requests()
          yield { items: [], pageNumber: 1, pageSize: 1, hasMore: false }
        },
      }))
      if (kind === 'search') await c.workspace.search('音乐')
      else await c.workspace.importFromUrl('https://example.com/music')
      await nextTick()
      const id = c.workspace.drawers.value[0]!.id
      expect(c.workspace.drawers.value[0]?.errorCode).toBe('network-error')
      expect(c.catalogErrorDrawerId.value).toBeUndefined()
      expect(c.isExternalOverlayOpen.value).toBe(false)
      c.openCatalogError(id)
      await nextTick()
      expect(c.catalogErrorDrawer.value?.id).toBe(id)
      c.closeCatalogError()
      await c.workspace.retry(id)
      await nextTick()
      expect(c.catalogErrorDrawerId.value).toBeUndefined()
      expect(requests).toHaveBeenCalledTimes(2)
      c.openCatalogError(id)
      await nextTick()
      expect(c.catalogErrorDrawer.value?.errorCode).toBe('network-error')
    },
  )

  it.each(['pagination-unavailable', 'network-error', 'verification-required'] as const)(
    'keeps partial results and the current page when later loading fails with %s',
    async (code) => {
      const f = mountWorkbench()
      const c = f.controller
      await c.modules.ready
      const requested: number[] = []
      f.search.mockImplementation(() => ({
        id: 'partial',
        title: '部分结果',
        async *pages() {
          requested.push(1)
          yield { items: [track('one')], pageNumber: 1, pageSize: 1, hasMore: true }
          requested.push(2)
          throw new AppError(code, '后续结果暂时无法获取。')
        },
      }))
      await c.workspace.search('音乐')
      const id = c.workspace.drawers.value[0]!.id
      c.selectTab('favorites')
      await c.workspace.loadNext(id)
      await c.workspace.loadNext(id)
      await nextTick()
      expect(c.workspace.drawers.value[0]).toMatchObject({
        errorCode: code,
        tracks: [track('one')],
        hasMore: false,
      })
      expect(c.activeTab.value).toBe('favorites')
      expect(c.catalogErrorDrawerId.value).toBeUndefined()
      expect(c.isExternalOverlayOpen.value).toBe(false)
      expect(requested).toEqual([1, 2])
      c.openCatalogError(id)
      await nextTick()
      expect(c.catalogErrorDrawer.value?.errorCode).toBe(code)
      c.closeCatalogError()
      c.openCatalogDrawer(id)
      await nextTick()
      expect(c.catalogErrorDrawerId.value).toBeUndefined()
      expect(requested).toEqual([1, 2])
    },
  )

  it('keeps retry progress in the shared error dialog and closes it before opening recovered tracks', async () => {
    const f = mountWorkbench()
    const c = f.controller
    await c.modules.ready
    const recovered = deferred<void>()
    let attempts = 0
    f.search.mockImplementation(() => ({
      id: 'retry',
      title: '重试列表',
      async *pages() {
        attempts++
        if (attempts === 1) throw new AppError('network-error', '连接失败')
        await recovered.promise
        yield { items: [track('one')], pageNumber: 1, pageSize: 1, hasMore: false }
      },
    }))
    await c.workspace.search('音乐')
    await nextTick()
    const id = c.workspace.drawers.value[0]!.id
    c.openCatalogError(id)
    expect(c.catalogErrorDrawerId.value).toBe(id)
    const pending = c.retryCatalogDrawer(id)
    await nextTick()
    expect(c.catalogErrorDrawerId.value).toBe(id)
    expect(c.workspace.drawers.value[0]).toMatchObject({ status: 'restoring', isLoading: true })
    recovered.resolve()
    await pending
    await nextTick()
    expect(c.catalogErrorDrawerId.value).toBeUndefined()
    expect(c.activeCatalogDrawerId.value).toBe(id)
    expect(attempts).toBe(2)
  })

  it('shares error handling with the complete theme and opens recovered tracks after one verification', async () => {
    const f = mountWorkbench()
    const c = f.controller
    await c.modules.ready
    let verified = false
    const verification = deferred<void>()
    const requested: number[] = []
    const verify = vi.fn(async () => {
      await verification.promise
      verified = true
    })
    f.search.mockImplementation(() => ({
      id: 'verified',
      title: '验证列表',
      verify,
      async *pages() {
        requested.push(1)
        if (!verified) throw new AppError('verification-required', '请完成验证')
        yield { items: [track('one')], pageNumber: 1, pageSize: 1, hasMore: true }
        requested.push(2)
        yield { items: [track('two')], pageNumber: 2, pageSize: 1, hasMore: false }
      },
    }))
    const themeError = c.editing
      .scope('catalog-root')
      .state(catalogRootEditingKey, createCatalogRootEditing).errorDrawerId
    await c.workspace.search('音乐')
    await nextTick()
    const id = c.workspace.drawers.value[0]!.id
    c.openCatalogError(id)
    expect(themeError.value).toBe(id)
    expect(c.catalogErrorDrawerId).toBe(themeError)
    const pending = c.verifyCatalogDrawer(id)
    await c.verifyCatalogDrawer(id)
    await nextTick()
    expect(verify).toHaveBeenCalledTimes(1)
    expect(themeError.value).toBe(id)
    expect(requested).toEqual([1])
    verification.resolve()
    await pending
    await nextTick()
    expect(themeError.value).toBeUndefined()
    expect(c.activeCatalogDrawerId.value).toBe(id)
    expect(c.workspace.drawers.value[0]).toMatchObject({ status: 'ready', hasMore: true })
    expect(f.search).toHaveBeenCalledTimes(1)
    expect(requested).toEqual([1, 1])
    await c.workspace.loadNext(id)
    expect(requested).toEqual([1, 1, 2])
    c.closeCatalogDrawer()
    c.openCatalogDrawer(id)
    await nextTick()
    expect(themeError.value).toBeUndefined()
    expect(requested).toEqual([1, 1, 2])
  })

  it('keeps a failed verification actionable and never reopens a dismissed error on later success', async () => {
    const f = mountWorkbench()
    const c = f.controller
    await c.modules.ready
    let verified = false
    const verification = deferred<void>()
    const verify = vi
      .fn()
      .mockRejectedValueOnce(new AppError('network-error', '验证连接失败'))
      .mockImplementationOnce(async () => {
        await verification.promise
        verified = true
      })
    f.search.mockImplementation(() => ({
      id: 'verified',
      title: '验证列表',
      verify,
      async *pages() {
        if (!verified) throw new AppError('verification-required', '请完成验证')
        yield { items: [track('one')], pageNumber: 1, pageSize: 1, hasMore: false }
      },
    }))
    await c.workspace.search('音乐')
    const id = c.workspace.drawers.value[0]!.id
    c.openCatalogError(id)
    await c.verifyCatalogDrawer(id)
    await nextTick()
    expect(c.catalogErrorDrawerId.value).toBe(id)
    expect(c.workspace.drawers.value[0]).toMatchObject({
      canVerify: true,
      verificationPhase: 'failed',
    })
    const pending = c.verifyCatalogDrawer(id)
    c.closeCatalogError()
    verification.resolve()
    await pending
    await nextTick()
    expect(c.catalogErrorDrawerId.value).toBeUndefined()
    expect(c.activeCatalogDrawerId.value).toBeUndefined()
  })

  it('retains real classic tag name/session/namespace across remounts and rejects an old confirmed edit after disable', async () => {
    const f = mountWorkbench('specialists')
    const c = f.controller
    await c.modules.ready
    await vi.waitFor(() => expect(c.tagManagement.available.value).toBe(true))
    c.tagManagement.addTag(track('one'), '现场')
    c.selectTab('tags')
    await vi.waitFor(() => expect(f.rootElement.textContent).toContain('标签管理'))
    const session = c.tagManagement.actions.value
    const editing = c.tagManagement.editing.value
    f.tagEditor.actions.setFilters({
      ...f.tagEditor.state.filters,
      searchQuery: '现',
    })
    f.tagEditor.actions.activateTag('现场')
    f.tagEditor.actions.setDetailView('edit')
    const input = await vi.waitFor(() =>
      findCatalogElement(f.rootElement, (node) => node.props['aria-label'] === '标签的新名称'),
    )
    input.value = '未提交名称'
    dispatchCatalogEvent(input, 'onInput', false)
    const namespace = c.tagManagement.tagsByTrackId.value
    const writes = f.data.writes.length
    const oldEditor = f.tagEditor
    f.presentation.value = 'B'
    await vi.waitFor(() => expect(f.tagEditor).not.toBe(oldEditor))
    expect(c.tagManagement.actions.value).toBe(session)
    expect(c.tagManagement.editing.value).toBe(editing)
    expect(f.tagEditor.state.filters.searchQuery).toBe('现')
    expect(
      findCatalogElement(f.rootElement, (node) => node.props['aria-label'] === '标签的新名称')
        .value,
    ).toBe('未提交名称')
    expect(c.tagManagement.tagsByTrackId.value).toBe(namespace)
    expect(f.data.writes).toHaveLength(writes)
    const studioEditor = f.tagEditor
    f.presentation.value = 'A'
    await vi.waitFor(() => expect(f.tagEditor).not.toBe(studioEditor))
    expect(f.tagEditor.state.filters.searchQuery).toBe('现')
    expect(c.tagManagement.editing.value).toBe(editing)
    expect(f.data.writes).toHaveLength(writes)
    expect(() => oldEditor.actions.addTag(track('one'), '旧页面')).toThrow('会话已失效')
    const pending = f.tagEditor.actions.deleteTag('现场')
    const rejected = expect(pending).rejects.toThrow('会话已失效')
    expect(c.confirmationDialog.activeRequest.value?.title).toBe('删除标签')
    await c.modules.setEnabled('feature.tags', false)
    await c.modules.setEnabled('feature.tags', true)
    await vi.waitFor(() => expect(c.tagManagement.available.value).toBe(true))
    c.confirmationDialog.accept()
    await rejected
    expect(c.tagManagement.tagsByTrackId.value.get('one')).toEqual(['现场'])
    expect(c.tagManagement.actions.value).not.toBe(session)
    expect(f.loadTags).toHaveBeenCalledTimes(2)
    f.unmount()
  })

  it('retains classic materials and unsaved recipe through remounts, rejects stale editing and keeps published playback/download independent', async () => {
    const f = mountWorkbench('specialists')
    const c = f.controller
    await c.modules.ready
    await vi.waitFor(() => expect(c.musicCreation.available.value).toBe(true))
    const session = c.musicCreation.current()
    const collection = session.createMaterialCollection('素材合集')
    session.addTracksToMaterialCollection(collection.id, [track('one')])
    c.selectTab('composer')
    await vi.waitFor(() => expect(f.rootElement.textContent).toContain('保存为自定义歌曲'))
    const editor = f.creationEditor
    editor.actions.setTitle('未保存作品')
    editor.actions.addSegment({ sourceTrackId: 'one', startMs: 0, endMs: 1000 })
    editor.actions.setFilters({ ...editor.state.filters, query: 'one' })
    const recipe = editor.state.recipe
    const draft = c.musicCreation.state.value.draft
    c.library.persistNow()
    const writes = f.data.writes.length
    f.presentation.value = 'B'
    await vi.waitFor(() => expect(f.creationEditor).not.toBe(editor))
    expect(c.musicCreation.current()).toBe(session)
    expect(f.creationEditor.state.recipe).toBe(recipe)
    expect(f.creationEditor.state.title).toBe('未保存作品')
    expect(f.creationEditor.state.filters.query).toBe('one')
    expect(c.musicCreation.state.value.draft).toBe(draft)
    expect(f.data.writes).toHaveLength(writes)
    const studioEditor = f.creationEditor
    f.presentation.value = 'A'
    await vi.waitFor(() => expect(f.creationEditor).not.toBe(studioEditor))
    expect(f.creationEditor.state.recipe).toBe(recipe)
    expect(c.musicCreation.current()).toBe(session)
    expect(f.data.writes).toHaveLength(writes)
    expect(() => editor.actions.setTitle('旧编辑')).toThrow('会话已失效')
    const pending = f.creationEditor.actions.clearData()
    const rejected = expect(pending).rejects.toThrow('会话已失效')
    await c.modules.setEnabled('feature.composer', false)
    expect(c.modules.canOpenView('custom-tracks')).toBe(false)
    await c.modules.setEnabled('feature.composer', true)
    await vi.waitFor(() => expect(c.musicCreation.available.value).toBe(true))
    c.confirmationDialog.accept()
    await rejected
    expect(c.musicCreation.state.value.draft).toEqual(draft)
    c.selectTab('composer')
    await vi.waitFor(() => expect(f.creationEditor.state.title).toBe('未保存作品'))
    f.creationEditor.actions.submit()
    await vi.waitFor(() => expect(c.library.customTracks.value).toHaveLength(1))
    const published = c.library.customTracks.value[0]!
    const publishedTrack = c.library.records.value.find(
      (record) => record.track.id === published.trackId,
    )!.track
    await vi.waitFor(() => expect(f.resolveMedia).toHaveBeenCalledTimes(1))
    await c.modules.setEnabled('feature.composer', false)
    expect(c.library.getCustomTrack(published.trackId)).toEqual(published)
    expect(c.queue.currentTrackId.value).toBe(published.trackId)
    expect(f.mediaCancellation()?.isCancelled()).toBe(false)
    c.downloads.startDownloadBatch({
      tracks: [publishedTrack],
      origin: { kind: 'music-list', label: '作品' },
      createRecipe: () => published.recipe,
    })
    await vi.waitFor(() => expect(encoder.run).toHaveBeenCalledTimes(1))
    expect(f.loadCreation).toHaveBeenCalledTimes(2)
    f.unmount()
  })
  it('keeps real classic catalog pagination, selection and unfinished filter input across root replacement', async () => {
    const f = mountWorkbench('catalog')
    const c = f.controller
    await c.modules.ready
    await c.workspace.search('submitted')
    const drawerId = c.workspace.drawers.value[0]!.id
    c.openCatalogDrawer(drawerId)
    await new Promise<void>((resolve) => setImmediate(resolve))
    dispatchCatalogEvent(
      findCatalogElement(
        f.rootElement,
        (node) => node.tag === 'input' && node.props['aria-label'] === '选择歌曲 one',
      ),
      'onChange',
    )
    await new Promise<void>((resolve) => setImmediate(resolve))
    c.openCatalogFilter()
    await new Promise<void>((resolve) => setImmediate(resolve))
    expect(c.isCatalogFilterOpen.value).toBe(true)
    dispatchCatalogEvent(
      findCatalogElement(
        f.catalogOverlay,
        (node) => node.tag === 'button' && node.textContent.includes('搜索筛选'),
      ),
      'onClick',
    )
    await new Promise<void>((resolve) => setImmediate(resolve))
    const input = findCatalogElement(
      f.catalogOverlay,
      (node) => node.tag === 'input' && node.props.type === 'search',
    )
    input.value = 'unfinished filter'
    input.dispatchListeners('input', { target: input })
    const paging = c.workspace.loadNext(drawerId)
    const repeated = c.workspace.loadNext(drawerId)
    await vi.waitFor(() => expect(f.requestedPages).toEqual([1, 2]))
    for (const root of ['B', 'A'] as const) {
      f.presentation.value = root
      // eslint-disable-next-line no-await-in-loop
      await new Promise<void>((resolve) => setImmediate(resolve))
      expect(f.requestedPages).toEqual([1, 2])
      expect(f.search).toHaveBeenCalledTimes(1)
      expect(f.resolveMedia).not.toHaveBeenCalled()
      expect(c.catalogTrackListSummary.value.selectedCount).toBe(1)
      expect(c.isCatalogFilterOpen.value).toBe(true)
      expect(
        findCatalogElement(
          f.catalogOverlay,
          (node) => node.tag === 'input' && node.props.type === 'search',
        ).value,
      ).toBe('unfinished filter')
      expect(f.listingCancellation()?.isCancelled()).toBe(false)
    }
    f.secondPage.resolve()
    await Promise.all([paging, repeated])
    expect(c.workspace.drawers.value[0]!.tracks.map(({ id }) => id)).toEqual(['one', 'two'])
    expect(c.catalogTrackListSummary.value.selectedCount).toBe(1)
    expect(f.requestedPages).toEqual([1, 2])
    expect(f.maximumPageReads()).toBe(1)
    expect(f.resolveMedia).not.toHaveBeenCalled()
    f.unmount()
  })
  it('rejects an old classic catalog page after explicit retry and keeps the new iterator on the same request identity', async () => {
    const f = mountWorkbench('catalog')
    const c = f.controller
    await c.modules.ready
    await c.workspace.search('submitted')
    const drawerId = c.workspace.drawers.value[0]!.id
    c.openCatalogDrawer(drawerId)
    const previousPage = c.workspace.loadNext(drawerId)
    await vi.waitFor(() => expect(f.requestedPages).toEqual([1, 2]))
    const previousCancellation = f.listingCancellation()!
    f.presentation.value = 'B'
    await new Promise<void>((resolve) => setImmediate(resolve))
    await c.workspace.retry(drawerId)
    expect(previousCancellation.isCancelled()).toBe(true)
    expect(f.requestedPages).toEqual([1, 2, 1])
    f.secondPage.resolve()
    await previousPage
    expect(c.workspace.drawers.value[0]!.id).toBe(drawerId)
    expect(c.workspace.drawers.value[0]!.tracks.map(({ id }) => id)).toEqual(['one'])
    await c.workspace.loadNext(drawerId)
    expect(f.requestedPages).toEqual([1, 2, 1, 2])
    expect(f.maximumPageReads()).toBe(1)
    expect(c.workspace.drawers.value[0]!.tracks.map(({ id }) => id)).toEqual(['one', 'two'])
    expect(f.resolveMedia).not.toHaveBeenCalled()
    f.unmount()
  })
  it('keeps source invalidation authoritative over a pending classic catalog page after root replacement', async () => {
    const f = mountWorkbench('catalog')
    const c = f.controller
    await c.modules.ready
    await c.workspace.search('submitted')
    const drawerId = c.workspace.drawers.value[0]!.id
    c.openCatalogDrawer(drawerId)
    const paging = c.workspace.loadNext(drawerId)
    await vi.waitFor(() => expect(f.requestedPages).toEqual([1, 2]))
    f.presentation.value = 'B'
    await new Promise<void>((resolve) => setImmediate(resolve))
    const cancellation = f.listingCancellation()!
    const error = createAppErrorState('operation-cancelled', 'account revoked')
    f.subscriptions.forEach(({ listener }) => listener({ pluginId: 'test', error }))
    expect(cancellation.isCancelled()).toBe(true)
    f.secondPage.resolve()
    await paging
    expect(c.workspace.drawers.value[0]!.tracks.map(({ id }) => id)).toEqual(['one'])
    expect(f.search).toHaveBeenCalledTimes(1)
    expect(f.resolveMedia).not.toHaveBeenCalled()
    f.unmount()
  })
  it('ends an actual settings session synchronously and gives rapid reopen a fresh presentation', async () => {
    const f = mountWorkbench()
    const c = f.controller
    await c.modules.ready
    c.openGlobalSettings('creator-profile')
    const first = c.editing.scope('settings')
    const version = c.settingsSessionId.value
    f.presentation.value = 'B'
    await new Promise<void>((resolve) => setImmediate(resolve))
    expect(first.active).toBe(true)
    expect(c.settingsSessionId.value).toBe(version)
    c.isGlobalSettingsOpen.value = false
    expect(first.active).toBe(false)
    expect(c.settingsSessionId.value).toBe(version + 1)
    // Reopen before Vue's render queue runs; leaving forms cannot keep the disposed scope.
    c.openGlobalSettings('downloads')
    expect(c.editing.scope('settings')).not.toBe(first)
    expect(c.editing.scope('settings').active).toBe(true)
    expect(c.isGlobalSettingsOpen.value).toBe(true)
  })

  it('keeps factories, plugin sessions, cursor, queue and in-flight reads across A → B → A; disposes once', async () => {
    const f = mountWorkbench()
    const c = f.controller
    await c.modules.ready
    await vi.waitFor(() =>
      expect(c.musicCreation.available.value && c.tagManagement.available.value).toBe(true),
    )
    const tags = c.tagManagement.actions.value
    const creation = c.musicCreation.current()
    const disposeTags = vi.spyOn(tags!, 'dispose')
    const disposeCreation = vi.spyOn(creation, 'dispose')
    await c.workspace.search('submitted')
    const drawerId = c.workspace.drawers.value[0]!.id
    c.openCatalogDrawer(drawerId)
    const paging = c.workspace.loadNext(drawerId)
    c.workspace.searchQuery.value = 'unfinished query'
    c.workspace.importUrl.value = 'https://example.com/unfinished'
    c.openGlobalSettings('proxy')
    c.networkProxyForm.proxyDraft.host = 'unfinished.proxy'
    let confirmationResult: boolean | undefined
    const confirming = c.confirmationDialog
      .confirm({ title: 'Pending action', message: 'Wait for explicit input.' })
      .then((value) => {
        confirmationResult = value
      })
    const confirmationId = c.confirmationDialog.activeRequest.value!.id
    c.queueTrack(track('one'))
    c.playTrack(track('one'))
    await vi.waitFor(() => expect(f.resolveMedia).toHaveBeenCalledTimes(1))
    await vi.waitFor(() => expect(f.requestedPages).toEqual([1, 2]))
    await new Promise<void>((resolve) => setImmediate(resolve))
    // Settle writes scheduled by the explicit setup actions before counting remount effects.
    c.workspace.persistNow()
    c.library.persistNow()
    const writes = f.data.writes.length
    const subscriptions = f.subscriptions.length
    const checks = vi.mocked(f.plugin.checkAvailability).mock.calls.length
    const sessionChecks = vi.mocked(f.plugin.getSession).mock.calls.length
    for (const next of ['B', null, 'A'] as const) {
      f.presentation.value = next
      // Each replacement must finish before inspecting its surviving business state.
      // eslint-disable-next-line no-await-in-loop
      await new Promise<void>((resolve) => setImmediate(resolve))
      expect(f.listingCancellation()?.isCancelled()).toBe(false)
      expect(f.mediaCancellation()?.isCancelled()).toBe(false)
      expect(c.player.status.value).toBe('resolving')
      expect(c.activeCatalogDrawerId.value).toBe(drawerId)
      expect(c.workspace.searchQuery.value).toBe('unfinished query')
      expect(c.workspace.importUrl.value).toBe('https://example.com/unfinished')
      expect(c.networkProxyForm.proxyDraft.host).toBe('unfinished.proxy')
      expect(c.workspace.proxySettings.value.host).not.toBe('unfinished.proxy')
      expect(c.confirmationDialog.activeRequest.value?.id).toBe(confirmationId)
      expect(confirmationResult).toBeUndefined()
      expect(c.queue.items.value.map((item) => item.id)).toEqual(['one'])
      expect(c.tagManagement.actions.value).toBe(tags)
      expect(c.musicCreation.current()).toBe(creation)
    }
    f.factories.forEach((factory) => expect(factory).toHaveBeenCalledTimes(1))
    expect(f.loadTags).toHaveBeenCalledTimes(1)
    expect(f.loadCreation).toHaveBeenCalledTimes(1)
    expect(f.subscriptions).toHaveLength(subscriptions)
    expect(f.plugin.checkAvailability).toHaveBeenCalledTimes(checks)
    expect(f.plugin.getSession).toHaveBeenCalledTimes(sessionChecks)
    expect(f.data.writes).toHaveLength(writes)
    expect(f.search).toHaveBeenCalledTimes(1)
    expect(f.resolveMedia).toHaveBeenCalledTimes(1)
    expect(disposeTags).not.toHaveBeenCalled()
    expect(disposeCreation).not.toHaveBeenCalled()
    const released = vi.fn()
    f.resolving.resolve(media(released))
    await vi.waitFor(() => expect(c.player.status.value).toBe('ready'))
    c.player.handleNativePlay()
    await vi.waitFor(() => expect(c.playbackState.value?.status).toBe('playing'))
    f.presentation.value = 'B'
    await new Promise<void>((resolve) => setImmediate(resolve))
    expect(c.player.displayedIsPlaying.value).toBe(true)
    expect(released).not.toHaveBeenCalled()
    f.secondPage.resolve()
    await paging
    expect(c.workspace.drawers.value[0]?.tracks.map((item) => item.id)).toEqual(['one', 'two'])
    f.unmount()
    f.unmount()
    await confirming
    expect(confirmationResult).toBe(false)
    expect(f.mediaCancellation()?.isCancelled()).toBe(true)
    expect(released).toHaveBeenCalledTimes(1)
    expect(disposeTags).toHaveBeenCalledTimes(1)
    expect(disposeCreation).toHaveBeenCalledTimes(1)
    f.subscriptions.forEach(({ unsubscribe }) => expect(unsubscribe).toHaveBeenCalledTimes(1))
    expect(f.removeMediaListener).toHaveBeenCalledTimes(f.addMediaListener.mock.calls.length)
  })

  it('retains source cancellation and explicit retry after presentation replacement', async () => {
    const f = mountWorkbench()
    const c = f.controller
    await c.modules.ready
    c.playTrack(track('one'))
    await vi.waitFor(() => expect(f.resolveMedia).toHaveBeenCalledTimes(1))
    f.presentation.value = 'B'
    await new Promise<void>((resolve) => setImmediate(resolve))
    expect(f.mediaCancellation()?.isCancelled()).toBe(false)
    const error = createAppErrorState('operation-cancelled', 'account revoked')
    f.subscriptions.forEach(({ listener }) => listener({ pluginId: 'test', error }))
    await new Promise<void>((resolve) => setImmediate(resolve))
    expect(f.mediaCancellation()?.isCancelled()).toBe(true)
    const release = vi.fn()
    f.resolving.resolve(media(release))
    await vi.waitFor(() => expect(release).toHaveBeenCalledTimes(1))
    expect(c.playerTrack.value).toBeUndefined()
    expect(f.resolveMedia).toHaveBeenCalledTimes(1)
    f.resolveMedia.mockRejectedValueOnce(new AppError('network-error'))
    c.playTrack(track('one'))
    await vi.waitFor(() => expect(c.player.status.value).toBe('error'))
    expect(f.resolveMedia).toHaveBeenCalledTimes(2)
  })

  it('keeps an admitted download active through presentation unmount and aborts on actual workbench disposal', async () => {
    const f = mountWorkbench()
    const c = f.controller
    await c.modules.ready
    const finished = deferred<{ blob: Blob; extension: string }>()
    let signal: AbortSignal | undefined
    encoder.run.mockImplementationOnce((exportOptions) => {
      signal = exportOptions.signal
      return finished.promise
    })
    c.library.rememberTracks([track('download')])
    const downloading = c.downloads.startDownloadBatch({
      tracks: [track('download')],
      origin: { kind: 'queue', label: '待听' },
    })
    await vi.waitFor(() => expect(signal).toBeDefined())
    const taskId = c.downloads.batches.value[0]!.items[0]!.id
    const subscriptions = f.subscriptions.length
    for (const next of [null, 'B', 'A'] as const) {
      f.presentation.value = next
      // Exercise ordered unmount/remount, not simultaneous roots.
      // eslint-disable-next-line no-await-in-loop
      await new Promise<void>((resolve) => setImmediate(resolve))
      expect(signal!.aborted).toBe(false)
      expect(c.downloads.batches.value[0]!.items[0]!.id).toBe(taskId)
      expect(c.downloads.batches.value[0]!.items[0]!.status).toBe('downloading')
    }
    expect(encoder.run).toHaveBeenCalledTimes(1)
    expect(f.subscriptions).toHaveLength(subscriptions)
    f.unmount()
    expect(signal!.aborted).toBe(true)
    finished.resolve({ blob: new Blob(['audio']), extension: 'mp3' })
    await downloading
    expect(encoder.run).toHaveBeenCalledTimes(1)
    f.subscriptions.forEach(({ unsubscribe }) => expect(unsubscribe).toHaveBeenCalledTimes(1))
  })
  it.each([true, 'root'] as const)(
    'keeps real classic download and queue views on one scheduler across %s presentation replacement',
    async (mode) => {
      encoder.run.mockReset()
      const openSchedule = vi.spyOn(browserDownloadScheduler, 'open')
      const f = mountWorkbench(mode)
      const c = f.controller
      await c.modules.ready
      c.setDownloadConcurrency(1)
      const first = deferred<{ blob: Blob; extension: string }>()
      let signal: AbortSignal | undefined
      let progress: ((value: { message: string }) => void) | undefined
      encoder.run.mockImplementationOnce((exportOptions) => {
        signal = exportOptions.signal
        progress = exportOptions.onProgress
        return first.promise
      })
      const tracks = [track('active'), track('queued')]
      c.library.rememberTracks(tracks)
      c.queueTrack(tracks[1]!)
      const pending = c.downloads.startDownloadBatch({
        tracks,
        origin: { kind: 'queue', label: '待听' },
      })
      await vi.waitFor(() => expect(signal).toBeDefined())
      progress?.({ message: '测试下载进度 42%' })
      await vi.waitFor(() => expect(f.rootElement.textContent).toContain('测试下载进度 42%'), {
        timeout: 10_000,
      })
      const original = c.downloads.batches.value[0]!
      const ids = original.items.map((item) => item.id)
      expect(original.items.map((item) => item.status)).toEqual(['downloading', 'queued'])
      for (const next of ['B', null, 'A', 'B', 'A'] as const) {
        f.presentation.value = next
        // eslint-disable-next-line no-await-in-loop
        await new Promise<void>((resolve) => setImmediate(resolve))
        if (next === 'A' || (mode === 'root' && next === 'B')) {
          // eslint-disable-next-line no-await-in-loop
          await vi.waitFor(() => expect(f.rootElement.textContent).toContain('测试下载进度 42%'), {
            timeout: 10_000,
          })
        }
        if (next === 'B') {
          // eslint-disable-next-line no-await-in-loop
          await vi.waitFor(() => expect(f.rootElement.textContent).toContain('待听'), {
            timeout: 10_000,
          })
        }
        expect(signal!.aborted).toBe(false)
        expect(c.downloads.batches.value[0]!.id).toBe(original.id)
        expect(c.downloads.batches.value[0]!.items.map((item) => item.id)).toEqual(ids)
        expect(c.downloads.batches.value[0]!.items.map((item) => item.status)).toEqual([
          'downloading',
          'queued',
        ])
        expect(c.queue.items.value.map((item) => item.id)).toEqual(['queued'])
        expect(c.downloads.batches.value[0]!.concurrency).toBe(1)
        expect(encoder.run).toHaveBeenCalledTimes(1)
        expect(openSchedule).toHaveBeenCalledExactlyOnceWith(1)
      }
      f.factories.forEach((factory) => expect(factory).toHaveBeenCalledTimes(1))
      expect(f.resolveMedia).not.toHaveBeenCalled()
      f.unmount()
      expect(signal!.aborted).toBe(true)
      first.resolve({ blob: new Blob(['audio']), extension: 'mp3' })
      await pending
      expect(encoder.run).toHaveBeenCalledTimes(1)
    },
    20_000,
  )
})
