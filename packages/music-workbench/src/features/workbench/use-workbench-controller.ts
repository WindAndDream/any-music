import type { Track } from '@any-music/core'
import {
  ALREADY_PLAYING_MESSAGE,
  createEditingSession,
  provideEditingSession,
  getPlaybackHistoryStartedAfterMs,
  getProductDestination,
  PRODUCT_DESTINATIONS,
  provideConfirmationDialog,
  provideCatalogFilterHistory,
  provideTrackNames,
  provideActionFeedback,
  useAppShell,
  useBackHandler,
  useToastNotice,
} from '@any-music/ui'
import type {
  AppShellPreferenceKind,
  CatalogDrawerListSummary,
  CatalogTrackDisplayMode,
  CatalogTrackListSummary,
  MobileTrackColumns,
  TrackPlaybackState,
  NavigationItem,
  PlaybackHistoryTimeRange,
  ProductViewId,
  SettingsSectionId,
} from '@any-music/ui'
import {
  catalogRootEditingKey,
  createCatalogRootEditing,
  hasCatalogDrawerError,
  useCatalogSelectionOperator,
} from '@any-music/ui/catalog'
import { computed, onScopeDispose, shallowRef, watch } from 'vue'
import type { ShallowRef } from 'vue'

import {
  getAllocatedNavigation,
  getWorkbenchViewKey,
  resolveWorkbenchViews,
} from '../../plugin-adapters/workbench-ui'
import { getWorkbenchRuntime } from '../../runtime/workbench-runtime'
import { appShellPreferencesRepository } from '../../storage/app-shell-preferences-repository'
import { catalogFilterHistoryRepository } from '../../storage/catalog-filter-history-repository'
import { getPlayerDownloadFeedback } from '../downloads/player-download-feedback'
import { useFavoriteCollection } from '../library/use-favorite-collection'
import { useTrackCollectionView } from '../library/use-track-collection-view'
import { useCatalogReload } from '../music-sources/use-catalog-reload'
import { useMusicSourceWorkbench } from '../music-sources/use-music-source-workbench'
import { useWorkbenchBackNavigation } from '../music-sources/use-workbench-back-navigation'
import {
  useAudioPlayer,
  type AudioPlayerEmit,
  type AudioPlayerEmits,
} from '../player/use-audio-player'
import { usePluginCenterAuthority } from '../plugins/use-plugin-center-authority'
import { useWorkbenchRootTheme } from '../plugins/use-workbench-root-theme'
import { useNetworkProxySettingsForm } from '../settings/use-network-proxy-settings-form'

export interface WorkbenchProps {
  presentation?: 'overlay' | 'embedded'
  accountSwitching?: readonly string[]
  accountSelectionLabels?: Readonly<Record<string, string>>
  accountMissing?: readonly string[]
  accountStatuses?: Readonly<Record<string, string>>
  accountDialogOpen?: boolean
  accountSummary?: string
  networkSummary?: string
  networkTitle?: string
  networkDescription?: string
}
/** One scope per workbench. Presentation replacement never re-runs its factories or cleanup. */
export function useWorkbenchController(
  props: Readonly<WorkbenchProps>,
  emit: (event: 'settingsClosed') => void,
  audio: Readonly<ShallowRef<HTMLAudioElement | null>>,
) {
  const editing = createEditingSession()
  provideEditingSession(editing)
  onScopeDispose(() => editing.dispose())
  const canHideProduct = getWorkbenchRuntime().canHide ?? false
  const isGlobalSettingsOpen = shallowRef(false)
  const settingsSessionId = shallowRef(0)
  const initialSettingsSection = shallowRef<SettingsSectionId | null>(null)
  const preferenceSetting = shallowRef<AppShellPreferenceKind | null>(null)
  const isSettingsDetailOpen = shallowRef(false)
  // 外观选择与设置面板并列；关闭设置必须同时释放子弹窗的焦点圈。
  watch(
    isGlobalSettingsOpen,
    (isOpen) => {
      if (!isOpen) {
        settingsSessionId.value++
        editing.clearScope('settings')
        networkProxyForm.resetDraft()
        preferenceSetting.value = null
        isSettingsDetailOpen.value = false
        emit('settingsClosed')
      }
    },
    { flush: 'sync' },
  )
  const isDiscoveryOpen = shallowRef(false)
  const isMusicSourcePickerOpen = shallowRef(false)
  const isCatalogContextOpen = shallowRef(false)
  const activeCatalogDrawerId = shallowRef<string>()
  const lastViewedCatalogDrawerId = shallowRef<string>()
  const isCatalogFilterOpen = shallowRef(false)
  const isCatalogOperatorOpen = shallowRef(false)
  const queueView = useTrackCollectionView('queue')
  const favoriteView = useTrackCollectionView('favorites')
  const downloadView = useTrackCollectionView('downloads')
  downloadView.isOperatorAvailable.value = true
  const isCatalogChildModalOpen = shallowRef(false)
  const catalogFilterCount = shallowRef(0)
  const catalogTrackListSummary = shallowRef<CatalogTrackListSummary>({
    selectedCount: 0,
    visibleCount: 0,
    totalCount: 0,
  })
  const catalogDrawerListSummary = shallowRef<CatalogDrawerListSummary>({
    selectedCount: 0,
    visibleCount: 0,
    totalCount: 0,
    filterCount: 0,
  })
  const isCatalogDisplayDialogOpen = shallowRef(false)
  const trackDisplayMode = shallowRef<CatalogTrackDisplayMode>('standard')
  const mobileTrackColumns = shallowRef<MobileTrackColumns>(1)
  const activeActionTrackId = shallowRef<string>()
  const activeActionDrawerId = shallowRef<string>()
  // Complete themes and host recovery actions share the same editing cell.
  const { errorDrawerId: catalogErrorDrawerId } = editing
    .scope('catalog-root')
    .state(catalogRootEditingKey, createCatalogRootEditing)
  const isHistoryOperatorOpen = shallowRef(false)
  const isMobilePlayerExpanded = shallowRef(false)
  const isPlayerSettingsOpen = shallowRef(false)
  const playbackState = shallowRef<TrackPlaybackState>()
  const historyQuery = shallowRef('')
  const historyPlatformId = shallowRef('all')
  const historyTimeRange = shallowRef<PlaybackHistoryTimeRange>('all')
  const themeSurface = shallowRef<ShadowRoot>()
  const actionFeedback = provideActionFeedback()
  const uiTheme = useWorkbenchRootTheme(
    getWorkbenchRuntime(),
    () => themeSurface.value,
    getWorkbenchRuntime().themes!,
    {
      prepareAllocation: (id) => modules.prepareTheme(id),
      onUnavailable: actionFeedback.showUnavailable,
      requiredOptionalViews: () => [
        ...(tagManagement.available.value ? ['tags' as const] : []),
        ...(musicCreation.available.value ? ['composer' as const] : []),
      ],
    },
  )
  const confirmationDialog = provideConfirmationDialog()
  const playbackNotice = useToastNotice()
  const catalogFilterHistory = provideCatalogFilterHistory(catalogFilterHistoryRepository)

  const {
    closeMobileDrawer,
    closePreferences,
    destinationOrder,
    effectiveSidebarCollapsed,
    isSidebarCollapsed,
    hiddenDestinationIds,
    hideProduct,
    isMobileDrawerOpen,
    isMobileNavigationEnabled,
    isMobileViewport,
    isPreferencesOpen,
    isProductHidden,
    moveDestination,
    resolvedTheme,
    setDestinationVisible,
    setMobileNavigationEnabled,
    setSidebarSide,
    setTheme,
    setPreferences,
    showProduct,
    sidebarSide,
    theme,
    toggleMobileDrawer,
    toggleSidebarCollapsed,
  } = useAppShell({ preferencesRepository: appShellPreferencesRepository })

  const {
    activeTab,
    modules,
    tagManagement,
    musicCreation,
    creationPendingRecords,
    publishedTrackViews,
    creationPageActions,
    tagPageActions,
    activatePlugin,
    addTag,
    addTracksToPlaylist,
    checkPlugin,
    clearHistory,
    composerGeneration,
    createPlaylist,
    deletePlaylist,
    renamePlaylist,
    reorderPlaylistTracks,
    downloadBusy,
    downloadedTrackIds,
    downloadCatalogTracks,
    downloadCustomTrack,
    downloadFavoriteTracks,
    downloadPlayerTrack,
    downloadPlaylistTracks,
    downloadQueueTracks,
    downloads,
    enabledBuiltInPlugins,
    enabledExternalPlugins,
    externalSourcesEnabled,
    exportMessage,
    favoriteDrawer,
    favoritePlatforms,
    favoriteTrack,
    favoriteTracks,
    featureError,
    handlePlayerEnded,
    handlePlayerNext,
    handlePlayerPrevious,
    library,
    renameTrack,
    loadPlayerMediaFile,
    localError,
    openCatalogComposer,
    openLibraryComposer,
    platformNameById,
    playerSegments,
    playerTrack,
    playFavoriteTrack,
    playTrack,
    pluginError,
    previewTrack,
    queue,
    queueTrack,
    queueTracks,
    toggleTrackFavorite,
    toggleTrackQueue,
    recordProgress,
    registry,
    removeDrawers,
    removeQueueTracks,
    removeLibraryTrack,
    removeTag,
    removeTrackFromPlaylist,
    renameDrawer,
    restoreTrackNames,
    restoreDrawerNames,
    toggleDrawerPinned,
    moveDrawer,
    renderPlayerCustomMedia,
    selectTab,
    stopPlayback,
    session,
    setDownloadConcurrency,
    setHistoryLimit,
    setPluginEnabled,
    setProxySettings,
    taggedRecordCount,
    unfavoriteTrack,
    unfavoriteTracks,
    updateLocalUserDisplayName,
    updateMode,
    workspace,
  } = useMusicSourceWorkbench({
    onRestoreDefaultTheme: () => {
      setTheme('system')
      void uiTheme.restoreDefault()
    },
    confirm: confirmationDialog.confirm,
    onAlreadyPlaying: () => playbackNotice.show(ALREADY_PLAYING_MESSAGE),
    onSettingsResult: actionFeedback.show,
    onActionResult: actionFeedback.show,
    onPlayerDownloadNotice: (notice) => actionFeedback.show(getPlayerDownloadFeedback(notice)),
  })
  provideTrackNames(library.customNamesByTrackId)
  const networkProxyForm = useNetworkProxySettingsForm({
    props: {
      get settings() {
        return workspace.proxySettings.value
      },
    },
    emit: (_event, settings) => setProxySettings(settings),
  })

  // 共享选择弹窗只消费展示模型，插件实例与可用性检测保留在应用。
  const builtInSourceOptions = computed(() =>
    enabledBuiltInPlugins.value.map(({ descriptor }) => ({
      id: descriptor.id,
      name: descriptor.name,
    })),
  )
  const externalSourceOptions = computed(() =>
    enabledExternalPlugins.value.map(({ descriptor }) => ({
      id: descriptor.id,
      name: descriptor.name,
    })),
  )
  const favoriteCollection = useFavoriteCollection(library.records)
  const activeCollectionView = computed(() =>
    activeTab.value === 'downloads'
      ? downloadView
      : activeTab.value === 'favorites'
        ? favoriteView
        : queueView,
  )
  const activeCollectionSummary = computed(() => activeCollectionView.value.summary.value)
  const isQueueFilterOpen = computed(
    () =>
      (activeTab.value === 'queue' ||
        activeTab.value === 'favorites' ||
        activeTab.value === 'downloads') &&
      activeCollectionView.value.isFilterOpen.value,
  )
  const isQueueOperatorOpen = computed(() => activeCollectionView.value.isOperatorOpen.value)
  const isQueueOperatorAvailable = computed(
    () => activeCollectionView.value.isOperatorAvailable.value,
  )

  watch(activeTab, () => {
    isMusicSourcePickerOpen.value = false
    isCatalogContextOpen.value = false
    // 导航不修改筛选器/操作器的逻辑开关，隐藏页面负责暂停自己的浮层。
    isCatalogChildModalOpen.value = false
    isCatalogDisplayDialogOpen.value = false
    activeActionTrackId.value = undefined
    closeCatalogError()
  })
  watch(activeCatalogDrawerId, () => {
    isCatalogContextOpen.value = false
  })

  const viewDescriptions: Record<ProductViewId, string> = {
    catalog: '在当前音乐源中发现内容，搜索和导入结果会保留为独立列表。',
    queue: '整理接下来要听的音乐与播放顺序。',
    favorites: '跨来源收藏，随时继续播放。',
    tags: '用轻量标签整理收藏与素材。',
    playlists: '管理本地歌单和其中的音乐。',
    'custom-tracks': '查看由多个音乐片段组合的作品。',
    composer: '从收藏和列表中剪取片段，编排为新的作品。',
    downloads: '管理下载、暂停与失败重试。',
    history: '回到最近听过的音乐。',
    plugins: '安装、检查并管理自定义音乐源。',
  }

  const allocatedViews = computed(() => resolveWorkbenchViews(modules.resolveViews()))
  const activeAllocatedViewId = computed(() => getWorkbenchViewKey(activeTab.value))
  watch(allocatedViews, (views) => {
    if (views.length && !views.some((view) => view.id === activeAllocatedViewId.value))
      selectTab('catalog')
  })
  const activeDestination = computed(() => getProductDestination(activeTab.value))
  const nativePluginPort = getWorkbenchRuntime().nativePluginAuthority
  const pluginCenter = usePluginCenterAuthority(nativePluginPort, externalSourcesEnabled)
  const activeDescription = computed(() => viewDescriptions[activeTab.value])
  const discoveryActionLabel = computed(() => {
    const { search, importUrl } = registry.activePlugin.value.descriptor.capabilities
    if (search && importUrl) return '搜索与导入'
    return search ? '搜索音乐' : '导入音乐'
  })
  const destinationCounts = computed<Record<ProductViewId, number>>(() => ({
    catalog: workspace.drawers.value.length,
    queue: queue.items.value.length,
    favorites: library.favoriteRecords.value.length,
    tags: taggedRecordCount.value,
    playlists: library.playlists.value.length,
    'custom-tracks': library.customTracks.value.length,
    composer: musicCreation.state.value.pendingMaterialTrackIds.length,
    downloads: downloads.activeItemCount.value,
    history: library.history.value.length,
    plugins: enabledExternalPlugins.value.length,
  }))
  const navigationItems = computed<readonly NavigationItem[]>(() =>
    getAllocatedNavigation(
      destinationOrder.value,
      hiddenDestinationIds.value,
      allocatedViews.value,
    ).map((destination) => ({
      id: destination.id,
      label: destination.label,
      icon: destination.icon,
      count: destinationCounts.value[destination.id],
    })),
  )
  const preferenceDestinations = computed(() => destinationOrder.value.map(getProductDestination))
  useWorkbenchBackNavigation({
    current: activeTab,
    select: selectTab,
    available: () => navigationItems.value.map(({ id }) => id as ProductViewId),
  })
  const mobileNavigationItems = computed<readonly NavigationItem[]>(() => [
    ...PRODUCT_DESTINATIONS.filter((destination) => destination.mobileSlot).map((destination) => ({
      id: destination.id,
      label: destination.shortLabel,
      icon: destination.icon,
      count: destinationCounts.value[destination.id],
    })),
    { id: 'profile', label: '我的', icon: 'user' as const },
  ])
  const activeMobileNavigationId = computed(() =>
    isGlobalSettingsOpen.value ? 'profile' : activeTab.value,
  )
  const historyTrackById = computed(
    () => new Map(library.records.value.map((record) => [record.track.id, record.track])),
  )
  const historyPlatformOptions = computed(() => {
    const platforms = new Map<string, string>()
    for (const entry of library.history.value) {
      const track = historyTrackById.value.get(entry.trackId)
      if (!track) continue
      if (track.source.mediaKind === 'custom') platforms.set('custom', '本地拼接')
      else {
        platforms.set(
          track.source.pluginId,
          platformNameById.value.get(track.source.pluginId) ?? track.source.pluginId,
        )
      }
    }
    return [...platforms].map(([id, label]) => ({ id, label }))
  })
  const filteredHistoryCount = computed(() => {
    const query = historyQuery.value.trim().toLocaleLowerCase()
    const startedAfterMs = getPlaybackHistoryStartedAfterMs(historyTimeRange.value)
    return library.history.value.filter((entry) => {
      const track = historyTrackById.value.get(entry.trackId)
      if (!track) return false
      const platformId = track.source.mediaKind === 'custom' ? 'custom' : track.source.pluginId
      if (historyPlatformId.value !== 'all' && platformId !== historyPlatformId.value) return false
      if (startedAfterMs !== undefined && entry.startedAtMs < startedAfterMs) return false
      if (!query) return true
      return [
        track.title,
        library.customNamesByTrackId.value.get(track.id) ?? '',
        ...track.artists.map((artist) => artist.name),
      ]
        .join(' ')
        .toLocaleLowerCase()
        .includes(query)
    }).length
  })
  const activeCatalogDrawer = computed(() =>
    workspace.drawers.value.find((drawer) => drawer.id === activeCatalogDrawerId.value),
  )
  const displayedCatalogDrawer = computed(() =>
    activeTab.value === 'catalog' ? activeCatalogDrawer.value : undefined,
  )
  useCatalogSelectionOperator({
    context: () => activeCatalogDrawerId.value ?? 'drawers',
    open: isCatalogOperatorOpen,
  })
  const activeCatalogContextTitle = computed(() => {
    const drawer = activeCatalogDrawer.value
    if (!drawer) return ''
    // 默认配方名称只保存前 80 字符；展示时补全请求文案，用户重命名仍保留原样。
    const requestTitle = `${drawer.pluginName} · 搜索：${drawer.input}`
    return drawer.kind === 'search' && drawer.title === requestTitle.slice(0, 80)
      ? requestTitle
      : drawer.title
  })
  const activeActionTrack = computed(() =>
    activeCatalogDrawer.value?.tracks.find((track) => track.id === activeActionTrackId.value),
  )
  const activeActionDrawer = computed(() =>
    workspace.drawers.value.find((drawer) => drawer.id === activeActionDrawerId.value),
  )
  // 名称与置顶变化即时反映到弹窗；列表被删除时不保留失效的操作目标。
  watch(activeActionDrawer, (drawer) => {
    if (!drawer && activeActionDrawerId.value) activeActionDrawerId.value = undefined
  })
  watch(activeTab, () => {
    activeActionDrawerId.value = undefined
  })
  const areAllActiveCatalogTracksFavorited = computed(() => {
    const tracks = activeCatalogDrawer.value?.tracks ?? []
    return (
      tracks.length > 0 && tracks.every((track) => library.favoriteTrackIds.value.has(track.id))
    )
  })
  watch(activeCatalogDrawer, (drawer) => {
    // 配方可能被外部同步移除；清理筛选器和操作器，避免壳层残留浮层状态。
    if (drawer || !activeCatalogDrawerId.value) return
    activeCatalogDrawerId.value = undefined
    isCatalogFilterOpen.value = false
    isCatalogOperatorOpen.value = false
    isCatalogChildModalOpen.value = false
    catalogFilterCount.value = 0
    isCatalogDisplayDialogOpen.value = false
    activeActionTrackId.value = undefined
  })
  watch(activeActionTrack, (track) => {
    if (!track && activeActionTrackId.value) activeActionTrackId.value = undefined
  })
  const catalogErrorDrawer = computed(() =>
    workspace.drawers.value.find(
      (drawer) =>
        drawer.id === catalogErrorDrawerId.value &&
        (drawer.isSourceEnabled || drawer.errorCode === 'operation-cancelled'),
    ),
  )
  watch(
    catalogErrorDrawerId,
    (id) => {
      if (id) workspace.prepareVerification(id)
    },
    { flush: 'sync' },
  )
  // Recovery progress retains its dialog; a resolved or withdrawn failure releases it.
  watch(catalogErrorDrawer, (drawer) => {
    if (
      !drawer ||
      (!drawer.isLoading &&
        !drawer.isVerifying &&
        drawer.status !== 'restoring' &&
        !hasCatalogDrawerError(drawer))
    ) {
      catalogErrorDrawerId.value = undefined
      if (drawer?.status === 'ready' && activeTab.value === 'catalog') openCatalogDrawer(drawer.id)
    }
  })
  const isConfirmationDialogOpen = computed(() => Boolean(confirmationDialog.activeRequest.value))
  const isExternalOverlayOpen = computed(
    () =>
      props.accountDialogOpen ||
      isGlobalSettingsOpen.value ||
      isDiscoveryOpen.value ||
      isMusicSourcePickerOpen.value ||
      isCatalogContextOpen.value ||
      (activeTab.value === 'catalog' && isCatalogFilterOpen.value) ||
      isQueueFilterOpen.value ||
      ((activeTab.value === 'queue' ||
        activeTab.value === 'favorites' ||
        activeTab.value === 'downloads') &&
        activeCollectionView.value.isChildModalOpen.value) ||
      isCatalogChildModalOpen.value ||
      isCatalogDisplayDialogOpen.value ||
      Boolean(activeActionTrack.value) ||
      Boolean(activeActionDrawer.value) ||
      Boolean(catalogErrorDrawer.value) ||
      (activeTab.value === 'history' && isHistoryOperatorOpen.value) ||
      isPlayerSettingsOpen.value ||
      isConfirmationDialogOpen.value,
  )

  function handleSelectNavigation(id: string): void {
    const destination = PRODUCT_DESTINATIONS.find((item) => item.id === id)
    if (!destination) return
    selectTab(destination.id)
    isDiscoveryOpen.value = false
    closeMobileDrawer()
  }

  function handleSelectMobileNavigation(id: string): void {
    if (id === 'profile') {
      openGlobalSettings()
      return
    }
    handleSelectNavigation(id)
  }

  function openGlobalSettings(initialSection: SettingsSectionId | null = null): void {
    activeActionDrawerId.value = undefined
    closeMobileDrawer()
    closePreferences()
    isDiscoveryOpen.value = false
    // 设置叠在当前歌曲页上方，主题或布局变化不能把用户送回列表首页。
    if (activeTab.value === 'catalog') {
      isCatalogFilterOpen.value = false
      isCatalogOperatorOpen.value = false
    }
    isCatalogChildModalOpen.value = false
    isCatalogDisplayDialogOpen.value = false
    activeActionTrackId.value = undefined
    catalogErrorDrawerId.value = undefined
    initialSettingsSection.value = initialSection
    isGlobalSettingsOpen.value = true
  }

  function openInterfacePreferences(): void {
    // 保留原快捷入口，但它与全局设置共用分类、草稿和关闭生命周期。
    openGlobalSettings('appearance')
  }

  // Native consumers may route their login entry into the same settings lifecycle.

  function openDiscovery(): void {
    activeActionDrawerId.value = undefined
    isCatalogOperatorOpen.value = false
    isCatalogFilterOpen.value = false
    isGlobalSettingsOpen.value = false
    closePreferences()
    isDiscoveryOpen.value = true
  }

  function handleSearch(query: string): void {
    // 列表配方会先创建，再异步加载；提交后立即回到列表查看请求状态。
    isDiscoveryOpen.value = false
    void workspace.search(query)
  }

  function handleImportUrl(url: string): void {
    isDiscoveryOpen.value = false
    void workspace.importFromUrl(url)
  }

  function openCatalogDrawer(drawerId: string): void {
    const drawer = workspace.drawers.value.find((item) => item.id === drawerId)
    if (!drawer) return
    isCatalogOperatorOpen.value = false
    isCatalogFilterOpen.value = false
    lastViewedCatalogDrawerId.value = drawerId
    catalogErrorDrawerId.value = undefined
    activeCatalogDrawerId.value = drawerId
    workspace.openDrawer(drawerId)
  }

  function closeCatalogDrawer(): void {
    isCatalogFilterOpen.value = false
    isCatalogOperatorOpen.value = false
    isCatalogChildModalOpen.value = false
    catalogFilterCount.value = 0
    isCatalogDisplayDialogOpen.value = false
    activeActionTrackId.value = undefined
    activeCatalogDrawerId.value = undefined
  }
  useBackHandler({
    active: () => activeTab.value === 'catalog' && Boolean(activeCatalogDrawer.value),
    handle: closeCatalogDrawer,
  })

  function openTrackActions(track: Track): void {
    activeActionTrackId.value = track.id
  }

  function openCatalogFilter(): void {
    isCatalogOperatorOpen.value = false
    isCatalogFilterOpen.value = true
  }

  function toggleCatalogOperator(): void {
    const shouldOpen = !isCatalogOperatorOpen.value
    isCatalogFilterOpen.value = false
    isCatalogOperatorOpen.value = shouldOpen
  }

  function openQueueFilter(): void {
    activeCollectionView.value.openFilter()
  }
  function toggleQueueOperator(): void {
    activeCollectionView.value.toggleOperator()
  }

  function openCatalogDisplayDialog(): void {
    isCatalogFilterOpen.value = false
    isCatalogOperatorOpen.value = false
    isCatalogDisplayDialogOpen.value = true
  }

  /** 空歌单引导沿用正式“我的歌单”创建入口，不在只读搜索结果中复制写入表单。 */
  function openPlaylistCreation(): void {
    handleSelectNavigation('playlists')
  }

  // 列表故障保留在卡片与歌曲页；只有用户主动查看时才打开错误详情。
  function openCatalogError(drawerId: string): void {
    if (!workspace.drawers.value.some((drawer) => drawer.id === drawerId)) return
    if (catalogErrorDrawerId.value !== drawerId)
      workspace.cancelVerification(catalogErrorDrawerId.value)
    catalogErrorDrawerId.value = drawerId
  }

  function closeCatalogError(): void {
    workspace.cancelVerification(catalogErrorDrawerId.value)
    catalogErrorDrawerId.value = undefined
  }

  async function verifyCatalogDrawer(drawerId: string): Promise<void> {
    await workspace.verify(drawerId)
  }

  const { reloadDrawer: retryCatalogDrawer } = useCatalogReload({
    getDrawer: (drawerId) => workspace.drawers.value.find((item) => item.id === drawerId),
    confirm: confirmationDialog.confirm,
    reload: workspace.retry,
    onReloadStart: () => {
      activeActionDrawerId.value = undefined
    },
  })

  function refreshCatalogDrawer(drawerId: string): Promise<void> {
    return retryCatalogDrawer(drawerId, 'refresh')
  }

  function openCatalogPlugins(): void {
    catalogErrorDrawerId.value = undefined
    // 来源停用或卸载时，导航到可执行恢复动作的页面并清理歌曲页浮层。
    handleSelectNavigation('plugins')
  }

  function openHistoryOperator(): void {
    isGlobalSettingsOpen.value = false
    isDiscoveryOpen.value = false
    closePreferences()
    isHistoryOperatorOpen.value = true
  }

  function clearPlaybackHistory(): void {
    clearHistory()
    isHistoryOperatorOpen.value = false
  }

  function handleSetDestinationVisible(id: ProductViewId, isVisible: boolean): void {
    setDestinationVisible(id, isVisible)
    if (!isVisible && activeTab.value === id) selectTab('catalog')
  }

  function openMusicSourcePicker(): void {
    if (displayedCatalogDrawer.value) return
    isCatalogOperatorOpen.value = false
    isMusicSourcePickerOpen.value = true
  }

  function handleActivatePlugin(pluginId: string): void {
    // 关闭选择器后沿用正式激活流程，包括外部源探测失败时前往插件中心。
    isMusicSourcePickerOpen.value = false
    void activatePlugin(pluginId)
  }

  function openCatalogContext(): void {
    isCatalogOperatorOpen.value = false
    isCatalogContextOpen.value = true
  }

  const player = useAudioPlayer({
    audio,
    props: {
      get track() {
        return playerTrack.value
      },
      get virtualSegments() {
        return playerSegments.value
      },
      get repeatOne() {
        return !previewTrack.value && queue.mode.value === 'repeat-one'
      },
      get downloadBusy() {
        return downloadBusy.value
      },
      resolveTrack: library.getTrack,
      resolveMedia: registry.resolveMedia,
      subscribeSourceInvalidation: getWorkbenchRuntime().subscribeSourceInvalidation,
      playbackEnvironment: getWorkbenchRuntime().playbackEnvironment,
      canPrefetchMedia: registry.canPrefetchMedia,
      renderCustomMedia: renderPlayerCustomMedia,
      loadMediaFile: loadPlayerMediaFile,
    },
    emit: ((event, ...args) => {
      const handlers: { [K in keyof AudioPlayerEmits]: (...args: AudioPlayerEmits[K]) => void } = {
        playbackStateChange: (state) => {
          playbackState.value = state
        },
        sourceInvalidated: stopPlayback,
        ended: handlePlayerEnded,
        previous: handlePlayerPrevious,
        next: handlePlayerNext,
        download: downloadPlayerTrack,
        progress: recordProgress,
        sessionExpired: session.markExpired,
        trackUnavailable: workspace.markTrackUnavailable,
        trackAvailable: workspace.markTrackAvailable,
      }
      // The event tuple is checked at the AudioPlayerEmit boundary.
      ;(handlers[event] as (...values: typeof args) => void)(...args)
    }) as AudioPlayerEmit,
  })

  return {
    catalogFilterHistory,
    setPreferences,
    themeSurface,
    networkProxyForm,
    editing,
    canHideProduct,
    player,
    isGlobalSettingsOpen,
    settingsSessionId,
    initialSettingsSection,
    preferenceSetting,
    isSettingsDetailOpen,
    isDiscoveryOpen,
    isMusicSourcePickerOpen,
    isCatalogContextOpen,
    activeCatalogDrawerId,
    lastViewedCatalogDrawerId,
    isCatalogFilterOpen,
    isCatalogOperatorOpen,
    queueView,
    favoriteView,
    downloadView,
    isCatalogChildModalOpen,
    catalogFilterCount,
    catalogTrackListSummary,
    catalogDrawerListSummary,
    isCatalogDisplayDialogOpen,
    trackDisplayMode,
    mobileTrackColumns,
    activeActionTrackId,
    activeActionDrawerId,
    catalogErrorDrawerId,
    isHistoryOperatorOpen,
    isMobilePlayerExpanded,
    isPlayerSettingsOpen,
    playbackState,
    historyQuery,
    historyPlatformId,
    historyTimeRange,
    uiTheme,
    confirmationDialog,
    playbackNotice,
    actionFeedback,
    closeMobileDrawer,
    closePreferences,
    destinationOrder,
    effectiveSidebarCollapsed,
    isSidebarCollapsed,
    hiddenDestinationIds,
    hideProduct,
    isMobileDrawerOpen,
    isMobileNavigationEnabled,
    isMobileViewport,
    isPreferencesOpen,
    isProductHidden,
    moveDestination,
    resolvedTheme,
    setDestinationVisible,
    setMobileNavigationEnabled,
    setSidebarSide,
    setTheme,
    showProduct,
    sidebarSide,
    theme,
    toggleMobileDrawer,
    toggleSidebarCollapsed,
    activeTab,
    modules,
    tagManagement,
    musicCreation,
    creationPendingRecords,
    publishedTrackViews,
    creationPageActions,
    tagPageActions,
    activatePlugin,
    addTag,
    addTracksToPlaylist,
    checkPlugin,
    clearHistory,
    composerGeneration,
    createPlaylist,
    deletePlaylist,
    renamePlaylist,
    reorderPlaylistTracks,
    downloadBusy,
    downloadedTrackIds,
    downloadCatalogTracks,
    downloadCustomTrack,
    downloadFavoriteTracks,
    downloadPlayerTrack,
    downloadPlaylistTracks,
    downloadQueueTracks,
    downloads,
    enabledBuiltInPlugins,
    enabledExternalPlugins,
    externalSourcesEnabled,
    exportMessage,
    favoriteDrawer,
    favoritePlatforms,
    favoriteTrack,
    favoriteTracks,
    featureError,
    handlePlayerEnded,
    handlePlayerNext,
    handlePlayerPrevious,
    library,
    renameTrack,
    loadPlayerMediaFile,
    localError,
    openCatalogComposer,
    openLibraryComposer,
    platformNameById,
    playerSegments,
    playerTrack,
    playFavoriteTrack,
    playTrack,
    pluginError,
    previewTrack,
    queue,
    queueTrack,
    queueTracks,
    toggleTrackFavorite,
    toggleTrackQueue,
    recordProgress,
    registry,
    removeDrawers,
    removeQueueTracks,
    removeLibraryTrack,
    removeTag,
    removeTrackFromPlaylist,
    renameDrawer,
    restoreTrackNames,
    restoreDrawerNames,
    toggleDrawerPinned,
    moveDrawer,
    renderPlayerCustomMedia,
    selectTab,
    stopPlayback,
    session,
    setDownloadConcurrency,
    setHistoryLimit,
    setPluginEnabled,
    setProxySettings,
    taggedRecordCount,
    unfavoriteTrack,
    unfavoriteTracks,
    updateLocalUserDisplayName,
    updateMode,
    workspace,
    builtInSourceOptions,
    externalSourceOptions,
    favoriteCollection,
    activeCollectionView,
    activeCollectionSummary,
    isQueueFilterOpen,
    isQueueOperatorOpen,
    isQueueOperatorAvailable,
    viewDescriptions,
    allocatedViews,
    activeAllocatedViewId,
    activeDestination,
    nativePluginPort,
    pluginCenter,
    activeDescription,
    discoveryActionLabel,
    destinationCounts,
    navigationItems,
    preferenceDestinations,
    mobileNavigationItems,
    activeMobileNavigationId,
    historyTrackById,
    historyPlatformOptions,
    filteredHistoryCount,
    activeCatalogDrawer,
    displayedCatalogDrawer,

    activeCatalogContextTitle,
    activeActionTrack,
    activeActionDrawer,
    areAllActiveCatalogTracksFavorited,
    catalogErrorDrawer,
    isConfirmationDialogOpen,
    isExternalOverlayOpen,
    handleSelectNavigation,
    handleSelectMobileNavigation,
    openGlobalSettings,
    openInterfacePreferences,
    openDiscovery,
    handleSearch,
    handleImportUrl,
    openCatalogDrawer,
    closeCatalogDrawer,
    openTrackActions,
    openCatalogFilter,
    toggleCatalogOperator,
    openQueueFilter,
    toggleQueueOperator,
    openCatalogDisplayDialog,
    openPlaylistCreation,
    openCatalogError,
    closeCatalogError,
    verifyCatalogDrawer,
    retryCatalogDrawer,
    refreshCatalogDrawer,
    openCatalogPlugins,
    openHistoryOperator,
    clearPlaybackHistory,
    handleSetDestinationVisible,
    openMusicSourcePicker,
    handleActivatePlugin,
    openCatalogContext,
  }
}
export type WorkbenchController = ReturnType<typeof useWorkbenchController>
