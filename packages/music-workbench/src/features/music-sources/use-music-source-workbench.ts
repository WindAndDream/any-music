import {
  AppError,
  compileSegmentRecipe,
  createAppErrorState,
  formatAppErrorMessage,
  getCompiledDurationMs,
  MAX_DOWNLOAD_CONCURRENCY,
  MIN_DOWNLOAD_CONCURRENCY,
  toAppErrorState,
} from '@any-music/core'
import type {
  AppErrorState,
  CompiledSegmentRecipe,
  MusicPlaylist,
  MusicSourceAvailability,
  PlaybackMode,
  RemoteResolvedMediaSource,
  ResolvedMediaSource,
  SegmentRecipe,
  Track,
} from '@any-music/core'
import {
  CUSTOM_TRACK_PLATFORM_ID,
  EXPORT_PREPARING_MESSAGE,
  getActionSuccessMessage,
  getExportSavedMessage,
} from '@any-music/ui'
import type { ProductViewId } from '@any-music/ui'
import type { SettingsActionResult } from '@any-music/ui'
import type { ActionFeedbackKind, ActionFeedbackResult } from '@any-music/ui'
import type { ConfirmAction } from '@any-music/ui'
import type { MusicCreationDraft } from '@any-music/ui'
import { computed, onScopeDispose, readonly, shallowRef, watch } from 'vue'

import { configureHttpProxy } from '../../runtime/proxy'
import { getWorkbenchRuntime } from '../../runtime/workbench-runtime'
import type { SourceInvalidation } from '../../runtime/workbench-runtime'
import type { AudioExportFormat } from '../audio-export/audio-exporter'
import { downloadAudioBlob } from '../audio-export/download-audio'
import { createPlayerExportRecipe } from '../audio-export/player-export-recipe'
import { useDownloadManager } from '../downloads/use-download-manager'
import {
  getDownloadedTrackIds,
  usePlayerDownload,
  type PlayerDownloadNotice,
} from '../downloads/use-player-download'
import { useLocalMusicLibrary } from '../library/use-local-music-library'
import { usePlaybackQueue } from '../player/use-playback-queue'
import { useMusicCreation } from '../plugins/use-music-creation'
import { useTagManagement } from '../plugins/use-tag-management'
import { useWorkbenchModules } from '../plugins/use-workbench-modules'
import type { NetworkProxySettings } from '../settings/network-proxy-settings'
import { useMusicSourceRegistry } from './use-music-source-registry'
import { useMusicSourceWorkspace } from './use-music-source-workspace'
import { usePluginSession } from './use-plugin-session'

/** 重型字节加载仅由播放器兼容路径按需导入，正常远程 URL 播放不会提前加载模块。 */
async function loadPlayerMediaFile(
  track: Track,
  source: RemoteResolvedMediaSource,
  options: { signal?: AbortSignal } = {},
) {
  const { loadResolvedMediaFile } = await import('../../media/resolved-media-loader')
  return loadResolvedMediaFile(track, source, options)
}

function getPluginAvailabilityError(availability: MusicSourceAvailability): AppErrorState {
  switch (availability.status) {
    case 'invalid':
      return availability.error
    case 'unavailable':
      return availability.error
    case 'checking':
      return createAppErrorState('unsupported-operation', '正在检测插件有效性。')
    case 'unchecked':
      return createAppErrorState('unsupported-operation', '插件尚未检测有效性。')
    case 'available':
      return createAppErrorState('invariant-violation', '可用插件不应进入失败分支。')
  }
}

function isInvalidatedTrack(track: Track | undefined, event: SourceInvalidation): boolean {
  if (!track) return false
  if (event.accountId) return event.trackIds?.includes(track.id) ?? false
  return track.source.pluginId === event.pluginId
}

export interface UseMusicSourceWorkbenchOptions {
  onRestoreDefaultTheme?: () => void
  /** 由表现层注入异步确认动作，业务编排无需感知弹层或 Shadow DOM。 */
  confirm: ConfirmAction
  /** 重选当前歌曲时由表现层提供瞬时反馈，不改变播放上下文或重新解析媒体。 */
  onAlreadyPlaying?: (track: Track) => void
  /** 仅在校验与持久化完成后报告设置结果，表现层负责弹出反馈。 */
  onSettingsResult?: (result: SettingsActionResult) => void
  /** 操作完成/写入失败后的统一反馈；UI 不从事件发出推断成功。 */
  onActionResult?: (result: ActionFeedbackResult) => void
  /** 每次播放器下载点击只展示当时歌曲状态，不打开模态层。 */
  onPlayerDownloadNotice?: (notice: PlayerDownloadNotice) => void
}

/**
 * 组合正式版全部功能状态，并向任意表现层暴露稳定的只读状态与业务动作。
 * 布局组件只消费这里的契约，不复制平台、播放、资料库、下载或插件编排逻辑。
 */
export function useMusicSourceWorkbench(workbenchOptions: UseMusicSourceWorkbenchOptions) {
  // 外部请求只由用户明确提交，避免误发送持久化的过期搜索词或示例 URL。
  const activeTab = shallowRef<ProductViewId>('catalog')
  const composerGeneration = shallowRef(0)
  let creationExportActive = false
  const featureErrorState = shallowRef<AppErrorState>()
  const pluginErrorState = shallowRef<AppErrorState>()
  const exportErrorState = shallowRef<AppErrorState>()
  const featureError = computed(() =>
    featureErrorState.value ? formatAppErrorMessage(featureErrorState.value) : '',
  )
  const pluginError = computed(() =>
    pluginErrorState.value ? formatAppErrorMessage(pluginErrorState.value) : '',
  )
  const exportBusy = shallowRef(false)
  const exportStatusMessage = shallowRef('')
  const exportMessage = computed(() =>
    exportErrorState.value
      ? formatAppErrorMessage(exportErrorState.value)
      : exportStatusMessage.value,
  )
  const previewTrack = shallowRef<Track>()
  const previewSegments = shallowRef<readonly ReturnType<typeof compileSegmentRecipe>[number][]>([])

  const hostLibrary = useLocalMusicLibrary()
  const library = {
    ...hostLibrary,
    records: computed(() => tagManagement.records.value),
    customTagsByTrackId: computed(() => tagManagement.tagsByTrackId.value),
  }
  const externalSourcesEnabled = shallowRef(false)
  const registry = useMusicSourceRegistry(
    getWorkbenchRuntime().builtInMusicSources,
    externalSourcesEnabled,
  )
  const sourceModuleEnabled = shallowRef<(id: string) => boolean>(() => true)
  const queue = usePlaybackQueue({ resolveTrack: library.getTrack })
  const session = usePluginSession(() => registry.activePlugin.value)
  const workspace = useMusicSourceWorkspace({
    plugins: registry.plugins,
    availabilityByPluginId: registry.availabilityByPluginId,
    activePlugin: () => registry.activePlugin.value,
    activatePlugin: registry.activate,
    getPlugin: registry.getPlugin,
    isPluginAllowed: (id) => sourceModuleEnabled.value(id),
    getSourceAccount: (pluginId) => {
      const known = session.getKnownSession(pluginId)
      if (known?.status === 'signed-in') return { name: known.user.name }
      if (known?.status === 'signed-out') return { name: '访客' }
      if (known?.status === 'not-required') return { name: '无需登录' }
      return undefined
    },
    onAuthenticationExpired: (pluginId, error) => {
      if (pluginId === registry.activePluginId.value) session.markExpired(error)
    },
  })
  const downloads = useDownloadManager({
    scheduler: getWorkbenchRuntime().downloadScheduler,
    verifyDownload: getWorkbenchRuntime().verifyDownload,
    concurrency: workspace.downloadConcurrency,
    creatorName: () => library.profile.value.displayName,
    createRecipe: (track) =>
      createPlayerExportRecipe(track, library.getCustomTrack(track.id)?.compiledSegments),
    resolveTrack: library.getTrack,
    resolveMedia: registry.resolveMedia,
    subscribeSourceInvalidation: getWorkbenchRuntime().subscribeSourceInvalidation,
  })
  let viewRevision = 0
  const modules = useWorkbenchModules(
    getWorkbenchRuntime(),
    {
      navigation: {
        selectView: selectTab,
        currentView: () => activeTab.value,
        revision: () => viewRevision,
      },
      optionalFeatures: {
        revision: () => tagManagement.generation.value + musicCreation.generation.value,
        isUsable: (id) =>
          id === 'feature.tags'
            ? tagManagement.available.value
            : id === 'feature.composer'
              ? musicCreation.available.value
              : true,
        addTags: (tracks, tag) =>
          runFeatureAction(() => tagManagement.addTags(tracks, tag), 'tagAdd'),
        tagInputOptions: (tracks) => tagManagement.tagInputOptions(tracks),
      },
      interaction: {
        hasUserGesture: () =>
          typeof navigator !== 'undefined' && navigator.userActivation?.isActive === true,
      },
      library: {
        getSummary: () => ({
          trackCount: library.records.value.length,
          playlistCount: library.playlists.value.length,
        }),
      },
      playback: { stop: stopPlayback },
      downloads: { cancelActiveBatch: () => downloads.cancelActiveBatch() },
    },
    workbenchOptions.onRestoreDefaultTheme,
  )
  const tagManagement = useTagManagement(
    getWorkbenchRuntime(),
    () => modules.isEnabled('feature.tags'),
    () => hostLibrary.records.value,
    (tracks) => {
      hostLibrary.rememberTracks(tracks)
      if (hostLibrary.persistenceErrorState.value)
        throw new AppError('storage-write-failed', '歌曲资料保存失败。')
    },
  )
  const musicCreation = useMusicCreation(
    getWorkbenchRuntime(),
    () => modules.isEnabled('feature.composer'),
    {
      rememberTracks: (tracks) => {
        hostLibrary.rememberTracks(tracks)
        if (hostLibrary.persistenceErrorState.value)
          throw new AppError('storage-write-failed', '素材资料保存失败。')
      },
      publishCustomTrack: hostLibrary.publishCustomTrack,
      readPublishedRecipe: (id) =>
        hostLibrary.getCustomTrack(id)?.recipe.map((segment) => Object.assign({}, segment)),
      deleteCreationMaterials: hostLibrary.deleteCreationMaterials,
    },
    () => {
      if (previewTrack.value) stopPlayback()
      if (creationExportActive) exportController?.abort()
    },
  )
  const creationPendingRecords = computed(() => {
    const ids = new Set(musicCreation.state.value.pendingMaterialTrackIds)
    const byId = new Map(library.records.value.map((record) => [record.track.id, record]))
    return [...ids].flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []))
  })
  const publishedTrackViews = computed(() =>
    library.customTracks.value.map((asset) => ({
      ...asset,
      materialCollectionId:
        musicCreation.state.value.materialCollectionByTrackId[asset.trackId] ?? '',
    })),
  )
  const creationPageActions = computed(() => {
    const created = musicCreation.actions.value
    if (!created) return undefined
    return {
      createCollection: (name: string) =>
        runFeatureAction(() => created.createMaterialCollection(name)),
      deleteCollection: (id: string, cleanup: boolean) =>
        runFeatureAction(() => created.deleteMaterialCollection(id, cleanup)),
      removePendingMaterial: (id: string) =>
        runFeatureAction(() => created.removePendingMaterialTrack(id)),
      addMaterial: (id: string, track: Track) =>
        runFeatureAction(() => created.addTracksToMaterialCollection(id, [track])),
      removeMaterial: (id: string, trackId: string) =>
        runFeatureAction(() => created.removeTrackFromMaterialCollection(id, trackId)),
      updateDraft: (draft: MusicCreationDraft) => runFeatureAction(() => created.saveDraft(draft)),
      clearData: () =>
        runFeatureAction(() => {
          created.clearData()
          composerGeneration.value++
        }),
      save: (title: string, collectionId: string, recipe: readonly SegmentRecipe[]) =>
        runFeatureAction(() => {
          const track = created.publish(title, collectionId, recipe)
          queue.play(track)
          composerGeneration.value++
          activeTab.value = 'custom-tracks'
        }),
      preview: (segment: SegmentRecipe) =>
        runFeatureAction(() => {
          created.assertCurrent()
          previewSegment(segment)
        }),
      download: (title: string, recipe: readonly SegmentRecipe[], format: AudioExportFormat) => {
        runFeatureAction(() => {
          created.assertCurrent()
          void downloadRecipe(title, recipe, format, true)
        })
      },
    }
  })
  const tagPageActions = computed(() => {
    const tagSession = tagManagement.actions.value
    if (!tagSession) return undefined
    return {
      createTag: (name: string) => tagSession.createTag(name),
      removeTagAssociations: (kind: 'tracks' | 'playlists', ids: readonly string[], tag: string) =>
        tagSession.removeTagAssociations(kind, ids, tag),
      addTag: (track: Track, tag: string) =>
        runFeatureAction(() => tagSession.addTag(track, tag), 'tagAdd'),
      removeTag: (track: Track, tag: string) =>
        runFeatureAction(() => tagSession.removeTag(track, tag), 'tagRemove'),
      renameTag: (tag: string, next: string) =>
        runFeatureAction(() => tagSession.renameTag(tag, next), 'tagRename'),
      deleteTag: (tag: string) => runFeatureAction(() => tagSession.deleteTag(tag), 'tagDelete'),
      deleteTags: (tags: readonly string[]) =>
        runFeatureAction(() => tagSession.deleteTags(tags), 'tagDelete'),
      mergeTags: (tags: readonly string[], target: string) =>
        runFeatureAction(() => tagSession.mergeTags(tags, target), 'tagRename'),
    }
  })
  const enabledBuiltInPlugins = computed(() =>
    registry.plugins.value.filter(
      (plugin) =>
        plugin.descriptor.provenance === 'built-in' &&
        workspace.isPluginEnabled(plugin.descriptor.id),
    ),
  )
  const enabledExternalPlugins = computed(() =>
    registry.plugins.value.filter(
      (plugin) =>
        plugin.descriptor.provenance === 'external' &&
        workspace.isPluginEnabled(plugin.descriptor.id),
    ),
  )
  const currentCustomTrack = computed(() => {
    const trackId = queue.currentTrackId.value
    return trackId ? library.getCustomTrack(trackId) : undefined
  })
  const playerTrack = computed(() => previewTrack.value ?? queue.currentTrack.value)
  const playerSegments = computed(() =>
    previewTrack.value ? previewSegments.value : currentCustomTrack.value?.compiledSegments,
  )
  const favoritePlatforms = computed(() =>
    registry.plugins.value.map((plugin) => ({
      id: plugin.descriptor.id,
      name: plugin.descriptor.name,
    })),
  )
  const platformNameById = computed(() => {
    const names = new Map(favoritePlatforms.value.map((platform) => [platform.id, platform.name]))
    names.set(CUSTOM_TRACK_PLATFORM_ID, '自定义拼接音乐')
    return names
  })
  const taggedRecordCount = computed(
    () => library.records.value.filter((record) => record.customTags.length > 0).length,
  )
  const localError = computed(() => featureError.value || library.persistenceError.value)
  const downloadBusy = computed(() => exportBusy.value || downloads.isBusy.value)
  const downloadedTrackIds = computed(() => getDownloadedTrackIds(downloads.batches.value))
  // 提示期间可能自动切歌；重试必须沿用首次点击的叶子配方，尤其是未持久化的试听片段。
  const playerDownloadRecipes = new WeakMap<Track, readonly SegmentRecipe[]>()
  const playerDownload = usePlayerDownload({
    batches: downloads.batches,
    isBusy: downloadBusy,
    onNotice: workbenchOptions.onPlayerDownloadNotice,
    startDownload: (track) => {
      const recipe =
        playerDownloadRecipes.get(track) ?? createPlayerExportRecipe(track, playerSegments.value)
      playerDownloadRecipes.set(track, recipe)
      if (track.id !== previewTrack.value?.id) library.rememberTracks([track])
      return downloads.startDownloadBatch({
        tracks: [track],
        origin: { kind: 'player', label: '播放器', referenceId: track.id },
        createRecipe: () => recipe,
      })
    },
  })

  let activeHistoryId: string | undefined
  let pluginActivationGeneration = 0
  let exportController: AbortController | undefined
  let exportTrackIds: readonly string[] = []
  const exportAccountIds = new Set<string>()
  let isDisposed = false

  function usesInvalidatedSource(track: Track | undefined, event: SourceInvalidation): boolean {
    if (isInvalidatedTrack(track, event)) return true
    if (!track) return false
    const segments =
      track.id === playerTrack.value?.id
        ? playerSegments.value
        : library.getCustomTrack(track.id)?.compiledSegments
    return (
      segments?.some((segment) =>
        isInvalidatedTrack(library.getTrack(segment.sourceTrackId), event),
      ) ?? false
    )
  }
  function invalidateSource(event: SourceInvalidation): void {
    if (!event.accountId) registry.invalidateSource(event.pluginId)
    workspace.invalidateSource(event)
    session.invalidateSource(event.pluginId, event.error)
    if (!event.accountId && usesInvalidatedSource(playerTrack.value, event)) stopPlayback()
    if (
      exportController &&
      (event.accountId
        ? exportAccountIds.has(event.accountId)
        : exportTrackIds.some((id) => isInvalidatedTrack(library.getTrack(id), event)))
    ) {
      exportController.abort()
      exportErrorState.value = event.error
      exportStatusMessage.value = ''
      reportActionResult('export', event.error)
    }
    for (const item of !event.accountId ? (downloads.activeBatch.value?.items ?? []) : []) {
      if (
        ['queued', 'downloading'].includes(item.status) &&
        usesInvalidatedSource(item.track, event)
      )
        downloads.cancelDownloadItem(item.id)
    }
  }
  function stopPlayback(): void {
    clearPreview()
    queue.stop()
  }
  const unsubscribeInvalidation =
    getWorkbenchRuntime().subscribeSourceInvalidation?.(invalidateSource)
  watch(
    () => registry.plugins.value.map((plugin) => plugin.descriptor.id),
    (ids, previous) => {
      for (const id of previous)
        if (!ids.includes(id))
          invalidateSource({
            pluginId: id,
            error: createAppErrorState(
              'operation-cancelled',
              '列表使用的音乐源已卸载，加载已中止。请重新安装音乐源后重试。',
            ),
          })
    },
    { flush: 'sync' },
  )
  watch(
    () => workspace.enabledPlugins.value.map((plugin) => plugin.descriptor.id),
    (ids, previous = []) => {
      for (const plugin of registry.plugins.value)
        registry.setEnabled(plugin.descriptor.id, ids.includes(plugin.descriptor.id))
      for (const id of previous) {
        if (!ids.includes(id)) {
          const availability = registry.getAvailability(id)
          invalidateSource({
            pluginId: id,
            error:
              availability.status === 'invalid' || availability.status === 'unavailable'
                ? availability.error
                : createAppErrorState(
                    'operation-cancelled',
                    '列表使用的音乐源已停用，加载已中止。请在设置中启用后重试。',
                  ),
          })
        }
      }
    },
    { flush: 'sync', immediate: true },
  )

  sourceModuleEnabled.value = modules.isSourceEnabled

  watch(
    () =>
      modules.isEnabled('feature.external-sources') &&
      !modules.busy.value &&
      !modules.failure.value,
    (enabled) => {
      externalSourcesEnabled.value = enabled && !!getWorkbenchRuntime().nativePluginAuthority
    },
    { immediate: true, flush: 'sync' },
  )

  watch(registry.activePluginId, () => {
    void session.refresh()
  })
  watch(workspace.proxySettings, configureHttpProxy, { flush: 'sync', immediate: true })
  watch(queue.currentTrack, (track) => {
    activeHistoryId = track ? library.beginHistory(track) : undefined
  })

  // Module startup temporarily withdraws sources. Probe only after activation so
  // the initial account check cannot be cancelled by that startup generation.
  void modules.ready.then(() => {
    if (!isDisposed) return session.refresh()
  })

  function selectTab(tab: ProductViewId): void {
    if (!modules.canOpenView(tab)) return
    activeTab.value = tab
    viewRevision++
  }

  function updateMode(mode: PlaybackMode) {
    queue.setMode(mode)
  }

  function playTrack(track: Track) {
    if (isAlreadyPlaying(track)) return
    clearPreview()
    library.rememberTracks([track])
    queue.play(track)
  }

  function playFavoriteTrack(track: Track, tracks: readonly Track[]) {
    if (isAlreadyPlaying(track)) return
    clearPreview()
    queue.playTracks(tracks, track.id)
  }

  function isAlreadyPlaying(track: Track): boolean {
    if (playerTrack.value?.id !== track.id) return false
    workbenchOptions.onAlreadyPlaying?.(track)
    return true
  }

  function queueTrack(track: Track) {
    try {
      library.rememberTracks([track])
      if (library.persistenceErrorState.value) {
        reportActionResult('queueAdd', library.persistenceErrorState.value)
        return
      }
      queue.add(track)
      reportActionResult(
        'queueAdd',
        library.persistenceErrorState.value ?? queue.persistenceErrorState.value,
      )
    } catch (cause) {
      featureErrorState.value = toAppErrorState(cause, 'unknown', '添加待听失败。')
      reportActionResult('queueAdd', featureErrorState.value)
    }
  }

  function favoriteTrack(track: Track) {
    runFeatureAction(() => library.favoriteTrack(track), 'favorite')
  }

  /** 列表与待听的单曲按钮切换同一个资料库事实源，其他集合入口仍保持“添加”语义。 */
  function toggleTrackFavorite(track: Track): void {
    if (library.favoriteTrackIds.value.has(track.id)) unfavoriteTrack(track.id)
    else favoriteTrack(track)
  }

  function toggleTrackQueue(track: Track): void {
    if (queue.trackIds.value.has(track.id)) removeQueueTracks([track.id])
    else queueTrack(track)
  }

  function queueTracks(tracks: readonly Track[]): void {
    if (!tracks.length) return
    try {
      library.rememberTracks(tracks)
      if (library.persistenceErrorState.value) {
        reportActionResult('queueAdd', library.persistenceErrorState.value)
        return
      }
      const count = queue.addMany(tracks)
      const error = library.persistenceErrorState.value ?? queue.persistenceErrorState.value
      reportActionResult('queueAdd', error, count)
    } catch (cause) {
      featureErrorState.value = toAppErrorState(cause, 'unknown', '添加待听失败。')
      reportActionResult('queueAdd', featureErrorState.value)
    }
  }

  function favoriteTracks(tracks: readonly Track[]) {
    runFeatureAction(() => library.favoriteTracks(tracks), 'favorite')
  }

  const pendingFavoriteDrawerIds = new Set<string>()

  async function favoriteDrawer(drawerId: string): Promise<void> {
    const drawer = workspace.drawers.value.find((candidate) => candidate.id === drawerId)
    if (isDisposed || pendingFavoriteDrawerIds.has(drawerId) || !drawer?.tracks.length) return
    // Capture the reviewed batch: pages loaded while confirming must not expand the operation.
    const tracks = [...drawer.tracks]
    pendingFavoriteDrawerIds.add(drawerId)
    try {
      const confirmed = await workbenchOptions.confirm({
        title: '加入我的喜欢',
        message: `确定将“${drawer.title}”当前已加载的 ${tracks.length} 首歌曲加入“我的喜欢”吗？已喜欢或已失效的歌曲会跳过，尚未加载的分页不会处理。`,
        confirmLabel: '加入我的喜欢',
      })
      if (
        !confirmed ||
        isDisposed ||
        !workspace.drawers.value.some((candidate) => candidate.id === drawerId)
      )
        return
      const favoriteIds = library.favoriteTrackIds.value
      const invalidIds = workspace.invalidTrackIds.value
      const eligible = tracks.filter(
        (track) => !favoriteIds.has(track.id) && !invalidIds.has(track.id),
      )
      // favoriteTracks publishes and persists the entire batch once; do not save it again here.
      runFeatureAction(() => library.favoriteTracks(eligible), 'favorite', false)
    } finally {
      pendingFavoriteDrawerIds.delete(drawerId)
    }
  }

  function removeDrawers(drawerIds: readonly string[]) {
    runWorkspaceAction(() => workspace.removeDrawers(drawerIds), 'drawerDelete')
  }

  function restoreDrawerNames(drawerIds: readonly string[]): void {
    runWorkspaceAction(() => workspace.restoreDrawerNames(drawerIds), 'drawerRestore')
  }

  function renameDrawer(drawerId: string, title: string): void {
    runWorkspaceAction(() => workspace.renameDrawer(drawerId, title), 'drawerRename')
  }

  function toggleDrawerPinned(drawerId: string): void {
    runWorkspaceAction(() => workspace.toggleDrawerPinned(drawerId), 'drawerPin')
  }

  function moveDrawer(drawerId: string, targetId: string, visibleIds: readonly string[]): void {
    runWorkspaceAction(() => workspace.moveDrawer(drawerId, targetId, visibleIds), 'drawerReorder')
  }

  function restoreTrackNames(trackIds: readonly string[]): void {
    // restoreTrackNames 自己仅在变化时保存一次，零变化不需要额外落盘。
    runFeatureAction(() => library.restoreTrackNames(trackIds), 'trackRestore', false)
  }

  function clearHistory(): void {
    runFeatureAction(() => library.clearHistory(), 'historyClear')
  }

  function removeQueueTracks(trackIds: readonly string[]): void {
    queue.removeMany(trackIds)
    reportActionResult('queueRemove', queue.persistenceErrorState.value)
  }

  function openCatalogComposer(track: Track) {
    if (!modules.canOpenView('composer')) return
    runFeatureAction(() => musicCreation.current().stageMaterialTrack(track))
    activeTab.value = 'composer'
  }

  function openLibraryComposer(trackId: string) {
    if (!modules.canOpenView('composer')) return
    const track = library.getTrack(trackId)
    if (!track) {
      featureErrorState.value = createAppErrorState('not-found', '找不到要截取的音乐。')
      return
    }
    runFeatureAction(() => musicCreation.current().stageMaterialTrack(track))
    activeTab.value = 'composer'
  }

  function previewSegment(segment: SegmentRecipe) {
    runFeatureAction(() => {
      const compiledSegments = compileRecipe([segment])
      const sourceTrack = library.getTrack(segment.sourceTrackId)
      if (!sourceTrack) throw new AppError('source-not-found', '找不到要试听的素材。')
      const durationMs = getCompiledDurationMs(compiledSegments)
      previewSegments.value = compiledSegments
      previewTrack.value = {
        id: `local:preview:${crypto.randomUUID()}`,
        title: `试听片段 · ${sourceTrack.title}`,
        artists: sourceTrack.artists,
        artworkUrl: sourceTrack.artworkUrl,
        durationMs,
        description: '未持久化的素材范围试听',
        source: {
          pluginId: 'local-preview',
          mediaKind: 'custom',
          resourceId: crypto.randomUUID(),
        },
      }
    })
  }

  async function downloadRecipe(
    title: string,
    recipe: readonly SegmentRecipe[],
    format: AudioExportFormat,
    creation = false,
  ) {
    if (downloadBusy.value) return
    const controller = new AbortController()
    exportController = controller
    creationExportActive = creation
    exportBusy.value = true
    exportErrorState.value = undefined
    exportStatusMessage.value = EXPORT_PREPARING_MESSAGE
    try {
      const compiledSegments = compileRecipe(recipe)
      exportTrackIds = compiledSegments.map((segment) => segment.sourceTrackId)
      // Mediabunny 与 MP3 编码器只在导出动作发生后执行，普通浏览和播放不会初始化编码栈。
      const [{ exportAudioSegments }, { loadResolvedMediaFile }] = await Promise.all([
        import('../audio-export/audio-exporter'),
        import('../../media/resolved-media-loader'),
      ])
      if (controller.signal.aborted) return
      const file = await exportAudioSegments({
        title,
        creatorName: library.profile.value.displayName,
        segments: compiledSegments,
        format,
        resolveTrack: library.getTrack,
        resolveMedia: async (track, resolveOptions) => {
          const source = await registry.resolveMedia(track, resolveOptions)
          if (source.accountId) exportAccountIds.add(source.accountId)
          return source
        },
        loadMediaFile: loadResolvedMediaFile,
        signal: controller.signal,
        onProgress: (progress) => {
          exportStatusMessage.value = progress.message
        },
      })
      if (controller.signal.aborted) return
      await downloadAudioBlob(file.blob, title, file.extension)
      exportStatusMessage.value = getExportSavedMessage(title, file.extension)
      workbenchOptions.onActionResult?.({ status: 'success', message: exportStatusMessage.value })
    } catch (error) {
      if (controller.signal.aborted) return
      exportErrorState.value = toAppErrorState(error, 'export-failed', '音频导出失败。')
      reportActionResult('export', exportErrorState.value)
    } finally {
      if (exportController === controller) {
        creationExportActive = false
        exportController = undefined
        exportTrackIds = []
        exportAccountIds.clear()
      }
      exportBusy.value = false
    }
  }

  function downloadCustomTrack(trackId: string, format: AudioExportFormat) {
    const track = library.getTrack(trackId)
    const definition = library.getCustomTrack(trackId)
    if (!track || !definition) {
      exportErrorState.value = createAppErrorState('not-found', '找不到要导出的自定义歌曲。')
      return
    }
    void downloadRecipe(track.title, definition.compiledSegments, format)
  }

  function downloadPlayerTrack(track: Track): void {
    playerDownload.requestDownload(track)
  }

  function downloadCatalogTracks(tracks: readonly Track[], drawerId: string): void {
    const drawer = workspace.drawers.value.find((candidate) => candidate.id === drawerId)
    startTrackDownloads(tracks, {
      kind: 'music-list',
      label: `音乐列表 · ${drawer?.title ?? '未知列表'}`,
      referenceId: drawerId,
    })
  }

  function downloadQueueTracks(tracks: readonly Track[]): void {
    startTrackDownloads(tracks, { kind: 'queue', label: '待听' })
  }

  function downloadFavoriteTracks(tracks: readonly Track[]): void {
    startTrackDownloads(tracks, { kind: 'favorites', label: '我的喜欢' })
  }

  function downloadPlaylistTracks(tracks: readonly Track[], playlist: MusicPlaylist): void {
    startTrackDownloads(tracks, {
      kind: 'playlist',
      label: `我的歌单 · ${playlist.name}`,
      referenceId: playlist.id,
    })
  }

  function startTrackDownloads(
    tracks: readonly Track[],
    origin: Parameters<typeof downloads.startDownloadBatch>[0]['origin'],
  ): void {
    if (downloadBusy.value || tracks.length === 0) return
    try {
      // 列表搜索结果可能尚未进入资料库；导出配方按稳定 ID 解析前必须先保存规范 Track。
      library.rememberTracks(tracks)
      // 下载创建后立即切到实时面板，长媒体解析阶段也会有可见反馈与中止入口。
      activeTab.value = 'downloads'
      const pending = downloads.startDownloadBatch({ tracks, origin })
      void pending
        .then((batchId) => {
          if (isDisposed || !batchId) return
          const batch = downloads.batches.value.find((candidate) => candidate.id === batchId)
          if (!batch || batch.status === 'cancelled') return
          // 下载管理器把失败收口为历史而非拒绝 Promise，必须检查实际结果才可报告完成。
          const error =
            batch.archiveError ??
            batch.items.find((item) => item.status === 'failed')?.error ??
            downloads.persistenceErrorState.value
          if (error) reportActionResult('downloadComplete', error)
          else if (batch.items.every((item) => item.status === 'succeeded'))
            reportActionResult('downloadComplete')
        })
        .catch((error: unknown) => {
          if (isDisposed) return
          featureErrorState.value = toAppErrorState(error, 'download-failed', '批量下载启动失败。')
          reportActionResult('downloadStart', featureErrorState.value)
        })
      featureErrorState.value = undefined
      reportActionResult('downloadStart', downloads.persistenceErrorState.value)
    } catch (error) {
      featureErrorState.value = toAppErrorState(error, 'download-failed', '批量下载启动失败。')
      reportActionResult('downloadStart', featureErrorState.value)
    }
  }

  async function renderPlayerCustomMedia(
    track: Track,
    segments: readonly CompiledSegmentRecipe[],
    options: {
      signal?: AbortSignal
      onSourceResolved?: (source: ResolvedMediaSource) => void
    } = {},
  ) {
    // 仅在范围解码不可用时生成兼容成品；Object URL 生命周期仍由 PlayerBar 管理。
    const [{ renderCustomTrackMedia }, { loadResolvedMediaFile }] = await Promise.all([
      import('../player/render-custom-track-media'),
      import('../../media/resolved-media-loader'),
    ])
    return renderCustomTrackMedia({
      track,
      segments,
      resolveTrack: library.getTrack,
      resolveMedia: async (sourceTrack, resolveOptions) => {
        const source = await registry.resolveMedia(sourceTrack, resolveOptions)
        options.onSourceResolved?.(source)
        return source
      },
      loadMediaFile: loadResolvedMediaFile,
      signal: options.signal,
    })
  }

  function compileRecipe(recipe: readonly SegmentRecipe[]) {
    return compileSegmentRecipe(recipe, {
      resolveTrack: library.getTrack,
      resolveCustomTrack: library.getCustomTrack,
    })
  }

  function clearPreview() {
    previewTrack.value = undefined
    previewSegments.value = []
  }

  function handlePlayerEnded() {
    if (previewTrack.value) clearPreview()
    else queue.next()
  }

  function handlePlayerPrevious() {
    if (previewTrack.value) clearPreview()
    else queue.previous()
  }

  function handlePlayerNext() {
    if (previewTrack.value) clearPreview()
    else queue.next()
  }

  async function activatePlugin(pluginId: string) {
    const activationGeneration = ++pluginActivationGeneration
    try {
      const plugin = registry.getPlugin(pluginId)
      if (!plugin) throw new AppError('not-found', '找不到音乐源插件。')
      if (!workspace.isPluginEnabled(pluginId)) {
        throw new AppError('unsupported-operation', '该音乐源尚未启用。')
      }
      if (plugin.descriptor.provenance === 'external') {
        // 外部服务只在用户明确切换时探测，避免脚本启动或设置开关产生网络请求。
        const availability = await registry.checkAvailability(pluginId)
        if (activationGeneration !== pluginActivationGeneration) return
        if (availability.status !== 'available') {
          pluginErrorState.value = getPluginAvailabilityError(availability)
          activeTab.value = 'plugins'
          return
        }
      }
      if (activationGeneration !== pluginActivationGeneration) return
      workspace.selectPlugin(pluginId)
      pluginErrorState.value = undefined
      featureErrorState.value = undefined
      activeTab.value = 'catalog'
    } catch (error) {
      if (activationGeneration !== pluginActivationGeneration) return
      pluginErrorState.value = toAppErrorState(error, 'upstream-error', '音乐源切换失败。')
      activeTab.value = 'plugins'
    }
  }

  function setPluginEnabled(pluginId: string, isEnabled: boolean) {
    workspace.setPluginEnabled(pluginId, isEnabled)
    if (!workspace.actionErrorState.value) void modules.setSourceEnabled(pluginId, isEnabled)
  }

  function checkPlugin(pluginId: string) {
    void registry.checkAvailability(pluginId)
  }

  function updateLocalUserDisplayName(displayName: string) {
    runSettingsAction(
      () => library.updateLocalUserDisplayName(displayName),
      getActionSuccessMessage('profile'),
      () => library.persistenceErrorState.value,
    )
  }

  function setHistoryLimit(limit: number) {
    runSettingsAction(
      () => library.setHistoryLimit(limit),
      getActionSuccessMessage('historySettings'),
      () => library.persistenceErrorState.value,
    )
  }

  function setDownloadConcurrency(concurrency: number) {
    runSettingsAction(
      () => {
        if (
          !Number.isInteger(concurrency) ||
          concurrency < MIN_DOWNLOAD_CONCURRENCY ||
          concurrency > MAX_DOWNLOAD_CONCURRENCY
        ) {
          throw new AppError(
            'invalid-input',
            `下载并发须为 ${MIN_DOWNLOAD_CONCURRENCY} 至 ${MAX_DOWNLOAD_CONCURRENCY} 的整数。`,
          )
        }
        workspace.setDownloadConcurrency(concurrency)
        workspace.persistNow()
      },
      getActionSuccessMessage('downloadSettings'),
      () => workspace.persistenceErrorState.value,
    )
  }

  function setProxySettings(settings: NetworkProxySettings) {
    const isToggle = settings.isEnabled !== workspace.proxySettings.value.isEnabled
    runSettingsAction(
      () => {
        workspace.setProxySettings(settings)
        workspace.persistNow()
      },
      isToggle
        ? settings.isEnabled
          ? getActionSuccessMessage('proxyEnabled')
          : getActionSuccessMessage('proxyDisabled')
        : getActionSuccessMessage('proxySettings'),
      () => workspace.persistenceErrorState.value,
    )
  }

  function addTracksToPlaylist(playlistId: string, tracks: readonly Track[]): void {
    runFeatureAction(() => library.addTracksToPlaylist(playlistId, tracks), 'playlistAdd')
  }

  function unfavoriteTracks(trackIds: readonly string[]): void {
    runFeatureAction(() => {
      library.unfavoriteTracks(trackIds)
    }, 'unfavorite')
  }

  function addTag(track: Track, tag: string): void {
    runFeatureAction(() => tagManagement.addTag(track, tag), 'tagAdd')
  }

  function renameTrack(track: Track, name: string): void {
    runFeatureAction(() => library.renameTrack(track, name), 'trackRename', false)
  }

  function removeTag(track: Track, tag: string): void {
    runFeatureAction(() => tagManagement.removeTag(track, tag), 'tagRemove')
  }

  function unfavoriteTrack(trackId: string): void {
    runFeatureAction(() => library.unfavoriteTrack(trackId), 'unfavorite')
  }

  function renameTag(currentTag: string, nextTag: string): void {
    runFeatureAction(() => tagManagement.renameTag(currentTag, nextTag), 'tagRename')
  }

  function deleteTag(tag: string): void {
    runFeatureAction(() => tagManagement.deleteTag(tag), 'tagDelete')
  }

  function createPlaylist(name: string, description?: string, coverId?: string): void {
    runFeatureAction(() => {
      library.createPlaylist(name, description, coverId)
    }, 'playlistCreate')
  }

  function deletePlaylist(playlistIds: string | readonly string[]): void {
    runFeatureAction(() => library.deletePlaylist(playlistIds), 'playlistDelete')
  }

  function renamePlaylist(playlistId: string, name: string): void {
    runFeatureAction(() => library.renamePlaylist(playlistId, name))
  }

  function reorderPlaylistTracks(playlistId: string, ids: readonly string[]): void {
    runFeatureAction(() => library.reorderPlaylistTracks(playlistId, ids))
  }

  function removeTrackFromPlaylist(playlistId: string, trackId: string): void {
    runFeatureAction(() => library.removeFromPlaylist(playlistId, trackId), 'playlistRemove')
  }

  function removeLibraryTrack(trackId: string): void {
    runFeatureAction(() => {
      library.removeTrack(trackId)
    })
  }

  function recordProgress(positionMs: number, durationMs: number | undefined, completed: boolean) {
    if (previewTrack.value) return
    const track = playerTrack.value
    if (track) library.updateTrackDuration(track.id, durationMs)
    if (activeHistoryId) library.updateHistory(activeHistoryId, positionMs, durationMs, completed)
  }

  function runSettingsAction(
    action: () => void,
    message: string,
    getPersistenceError: () => AppErrorState | undefined,
  ): void {
    let result: SettingsActionResult
    try {
      action()
      const error = getPersistenceError()
      featureErrorState.value = error
      result = error ? { status: 'error', error } : { status: 'success', message }
    } catch (cause) {
      const error = toAppErrorState(cause, 'unknown', '设置保存失败。')
      featureErrorState.value = error
      result = { status: 'error', error }
    }
    workbenchOptions.onSettingsResult?.(result)
  }

  function reportActionResult(
    action: ActionFeedbackKind,
    error?: AppErrorState,
    count?: number,
  ): void {
    if (isDisposed) return
    workbenchOptions.onActionResult?.(
      error
        ? { status: 'error', error, action }
        : {
            status: action === 'unfavorite' || action === 'queueRemove' ? 'info' : 'success',
            message: getActionSuccessMessage(action, count),
          },
    )
  }

  function runWorkspaceAction(action: () => void | number, kind: ActionFeedbackKind): void {
    try {
      const count = action()
      // 零变化恢复不写入；失败后允许通过同一恢复入口重新尝试保存会话状态。
      if (
        !workspace.actionErrorState.value &&
        (count !== 0 || workspace.persistenceErrorState.value)
      )
        workspace.persistNow()
      featureErrorState.value =
        workspace.actionErrorState.value ?? workspace.persistenceErrorState.value
      reportActionResult(
        kind,
        featureErrorState.value,
        typeof count === 'number' ? count : undefined,
      )
    } catch (cause) {
      featureErrorState.value = toAppErrorState(cause, 'unknown', '音乐列表操作失败。')
      reportActionResult(kind, featureErrorState.value)
    }
  }

  function runFeatureAction(
    action: () => unknown,
    kind?: ActionFeedbackKind,
    shouldPersist = true,
  ) {
    try {
      const count = action()
      if (kind && (shouldPersist || (count === 0 && library.persistenceErrorState.value)))
        library.persistNow()
      featureErrorState.value = kind ? library.persistenceErrorState.value : undefined
      if (kind)
        reportActionResult(
          kind,
          featureErrorState.value,
          typeof count === 'number' ? count : undefined,
        )
    } catch (error) {
      featureErrorState.value = toAppErrorState(error, 'unknown', '本地资料操作失败。')
      if (kind) reportActionResult(kind, featureErrorState.value)
    }
  }

  onScopeDispose(() => {
    isDisposed = true
    pluginActivationGeneration += 1
    exportController?.abort()
    unsubscribeInvalidation?.()
  })

  return {
    modules,
    externalSourcesEnabled: readonly(externalSourcesEnabled),
    tagManagement,
    musicCreation,
    creationPendingRecords,
    publishedTrackViews,
    creationPageActions,
    tagPageActions,
    activeTab: readonly(activeTab),
    activatePlugin,
    addTag,
    addTracksToPlaylist,
    checkPlugin,
    clearHistory,
    composerGeneration: readonly(composerGeneration),
    createPlaylist,
    deletePlaylist,
    renamePlaylist,
    reorderPlaylistTracks,
    deleteTag,
    downloadBusy,
    downloadedTrackIds,
    downloadCatalogTracks,
    downloadCustomTrack,
    downloadFavoriteTracks,
    downloadPlayerTrack,
    playerDownloadNotice: playerDownload.notice,
    downloadPlaylistTracks,
    downloadQueueTracks,
    downloadRecipe,
    downloads,
    enabledBuiltInPlugins,
    enabledExternalPlugins,
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
    previewSegment,
    previewTrack: readonly(previewTrack),
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
    renameTag,
    renameTrack,
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
  }
}
