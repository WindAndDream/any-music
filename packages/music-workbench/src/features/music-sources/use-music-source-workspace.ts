import {
  AppError,
  createAppErrorState,
  formatAppErrorMessage,
  toAppErrorState,
} from '@any-music/core'
import type {
  AppErrorCode,
  AppErrorState,
  MusicSourceAvailability,
  MusicSourcePlugin,
  TrackListing,
} from '@any-music/core'
import type { CatalogDrawerStatus, CatalogDrawerView } from '@any-music/ui'
import { storeToRefs } from 'pinia'
import {
  computed,
  onScopeDispose,
  readonly,
  shallowReactive,
  shallowRef,
  toValue,
  watch,
} from 'vue'
import type { MaybeRefOrGetter, ShallowRef } from 'vue'

import type { SourceInvalidation } from '../../runtime/workbench-runtime'
import { useMusicSourceWorkspaceStore } from '../../stores/music-source-workspace-store'
import type { NetworkProxySettings } from '../settings/network-proxy-settings'
import { type CatalogDrawerRecipe, type CatalogRequestKind } from './music-source-workspace-state'
import { useTrackCatalog } from './use-track-catalog'

type Catalog = ReturnType<typeof useTrackCatalog>
interface CatalogDrawerRuntime {
  catalog?: Catalog
  plugin?: MusicSourcePlugin
  account?: TrackListing['account']
  status: ShallowRef<CatalogDrawerStatus>
  invalidReason: ShallowRef<string>
  pendingRun?: Promise<void>
  requiresRestart?: boolean
  interruptionError: ShallowRef<AppErrorState | undefined>
  accountStatusVisible: ShallowRef<boolean>
}

interface UseMusicSourceWorkspaceOptions {
  plugins: MaybeRefOrGetter<readonly MusicSourcePlugin[]>
  availabilityByPluginId: MaybeRefOrGetter<Readonly<Record<string, MusicSourceAvailability>>>
  activePlugin: MaybeRefOrGetter<MusicSourcePlugin>
  activatePlugin: (pluginId: string) => void
  getPlugin: (pluginId: string) => MusicSourcePlugin | undefined
  isPluginAllowed?: (pluginId: string) => boolean
  /** 单账号运行端只复用已知身份，不为列表详情额外发起会话请求。 */
  getSourceAccount?: (pluginId: string) => TrackListing['account']
  onAuthenticationExpired?: (pluginId: string, error: AppErrorState) => void
}

/**
 * 将已保留结果与每个抽屉独立的惰性分页管线连接。
 * 缓存直接展示，缺少缓存的配方才在首次展开时请求；续载与刷新由用户操作触发。
 */
export function useMusicSourceWorkspace(options: UseMusicSourceWorkspaceOptions) {
  const store = useMusicSourceWorkspaceStore()
  const {
    disabledPluginIds,
    drawerRecipes,
    downloadConcurrency,
    importUrl,
    persistenceError,
    persistenceErrorState,
    proxySettings,
    searchQuery,
    unavailableTrackIds,
  } = storeToRefs(store)
  // Synchronous consumers may read a new recipe before its runtime is inserted.
  // Track membership so that first read cannot cache an absent runtime indefinitely.
  const runtimeById = shallowReactive(new Map<string, CatalogDrawerRuntime>())
  const invalidTrackIds = computed<ReadonlySet<string>>(() => new Set(unavailableTrackIds.value))
  const actionErrorState = shallowRef<AppErrorState>()
  const actionError = computed(() =>
    actionErrorState.value ? formatAppErrorMessage(actionErrorState.value) : '',
  )
  const allPlugins = computed(() => toValue(options.plugins))
  const availabilityByPluginId = computed(() => toValue(options.availabilityByPluginId))
  const disabledPluginIdSet = computed(() => new Set(disabledPluginIds.value))
  const enabledPlugins = computed(() =>
    allPlugins.value.filter(
      (plugin) => isPluginEnabled(plugin.descriptor.id) && isPluginAvailable(plugin.descriptor.id),
    ),
  )
  const configuredEnabledPluginIds = computed(() =>
    allPlugins.value.map((plugin) => plugin.descriptor.id).filter(isPluginEnabled),
  )
  const drawers = computed<readonly CatalogDrawerView[]>(() => {
    // 稳定分组让置顶列表始终优先；新搜索与重复提交不会越过置顶区，也不会改写普通顺序。
    const recipes = drawerRecipes.value
    return [
      ...recipes.filter((recipe) => recipe.isPinned),
      ...recipes.filter((recipe) => !recipe.isPinned),
    ].map((recipe) => createDrawerView(recipe))
  })
  const isBusy = computed(() =>
    drawers.value.some((drawer) => drawer.status === 'restoring' || drawer.isLoading),
  )

  syncRuntimeDrawers()
  const savedPluginId = store.activePluginId
  if (savedPluginId && options.getPlugin(savedPluginId) && isPluginEnabled(savedPluginId)) {
    options.activatePlugin(savedPluginId)
  }
  ensureEnabledPlugin()

  watch(drawerRecipes, syncRuntimeDrawers)
  watch(
    [allPlugins, configuredEnabledPluginIds, availabilityByPluginId],
    () => {
      ensureEnabledPlugin()
      syncRuntimeAvailability()
    },
    { flush: 'sync' },
  )

  async function search(query: string): Promise<void> {
    await submitRequest('search', query)
  }

  async function importFromUrl(url: string): Promise<void> {
    await submitRequest('import-url', url)
  }

  async function submitRequest(kind: CatalogRequestKind, rawInput: string): Promise<void> {
    const input = rawInput.normalize('NFKC').trim()
    if (!input) {
      actionErrorState.value = createAppErrorState(
        'invalid-input',
        kind === 'search' ? '搜索关键词不能为空。' : '导入 URL 不能为空。',
      )
      return
    }
    const plugin = toValue(options.activePlugin)
    if (!isPluginEnabled(plugin.descriptor.id)) {
      actionErrorState.value = createAppErrorState(
        'unsupported-operation',
        '当前音乐源未启用，请先在全局设置中启用。',
      )
      return
    }
    if (!isPluginAvailable(plugin.descriptor.id)) {
      actionErrorState.value = getPluginAvailabilityError(plugin.descriptor.id)
      return
    }
    const supportsRequest =
      kind === 'search'
        ? plugin.descriptor.capabilities.search
        : plugin.descriptor.capabilities.importUrl
    if (!supportsRequest) {
      actionErrorState.value = createAppErrorState(
        'unsupported-operation',
        kind === 'search' ? '当前音乐源不支持搜索。' : '当前音乐源不支持 URL 导入。',
      )
      return
    }
    if (kind === 'import-url') {
      try {
        // URL 预检是纯本地解析；失败时不会创建抽屉或发出任何网络请求。
        plugin.validateImportUrl(input)
      } catch (error) {
        actionErrorState.value = toAppErrorState(
          error,
          'unsupported-url',
          '导入 URL 不在支持范围内。',
        )
        return
      }
    }

    const existing = drawerRecipes.value.find(
      (drawer) =>
        drawer.pluginId === plugin.descriptor.id && drawer.kind === kind && drawer.input === input,
    )
    if (existing) {
      store.moveDrawerToFront(existing.id)
      store.setDrawerExpanded(existing.id, true)
      actionErrorState.value = undefined
      openDrawer(existing.id)
      await runtimeById.get(existing.id)?.pendingRun
      return
    }

    const recipe: CatalogDrawerRecipe = {
      id: `drawer:${crypto.randomUUID()}`,
      pluginId: plugin.descriptor.id,
      kind,
      input,
      title: createDefaultDrawerTitle(plugin, kind, input),
      originalTitle: createDefaultDrawerTitle(plugin, kind, input),
      isExpanded: true,
      createdAtMs: Date.now(),
    }
    store.addDrawerRecipe(recipe)
    syncRuntimeDrawers()
    actionErrorState.value = undefined
    await runDrawer(recipe.id)
  }

  async function runDrawer(drawerId: string): Promise<void> {
    const recipe = drawerRecipes.value.find((drawer) => drawer.id === drawerId)
    const runtime = runtimeById.get(drawerId)
    if (!recipe || !runtime) return
    if (runtime.pendingRun) return runtime.pendingRun

    const task = performDrawerRequest(recipe, runtime).finally(() => {
      runtime.pendingRun = undefined
    })
    runtime.pendingRun = task
    return task
  }

  async function performDrawerRequest(
    recipe: CatalogDrawerRecipe,
    runtime: CatalogDrawerRuntime,
  ): Promise<void> {
    const plugin = options.getPlugin(recipe.pluginId)
    if (!plugin) {
      runtime.catalog?.pause()
      runtime.status.value = 'missing'
      runtime.invalidReason.value = '创建该抽屉的音乐源已卸载。'
      return
    }
    if (!isPluginEnabled(recipe.pluginId)) {
      runtime.catalog?.pause()
      runtime.status.value = 'disconnected'
      runtime.invalidReason.value = '音乐源已停用，已加载歌曲仍可查看。'
      return
    }
    if (!isPluginAvailable(recipe.pluginId)) {
      runtime.catalog?.pause()
      runtime.status.value = 'paused'
      runtime.invalidReason.value = getPluginAvailabilityReason(recipe.pluginId)
      return
    }

    const catalog = ensureCatalog(runtime, plugin)
    if (catalog.isVerifying.value) return
    runtime.account = options.getSourceAccount?.(recipe.pluginId)
    runtime.accountStatusVisible.value = true
    runtime.status.value = 'restoring'
    runtime.interruptionError.value = undefined
    runtime.invalidReason.value = ''
    // search/import 自身只消费第一页；后续页由详情列表的滚动动作逐页推进。
    runtime.requiresRestart = false
    if (recipe.kind === 'search') await catalog.search(recipe.input)
    else await catalog.importUrl(recipe.input)
    updateDrawerOutcome(recipe, runtime)
  }

  async function loadNext(drawerId: string): Promise<void> {
    const recipe = drawerRecipes.value.find((drawer) => drawer.id === drawerId)
    const runtime = runtimeById.get(drawerId)
    if (!recipe || !runtime?.catalog) return
    if (!isPluginEnabled(recipe.pluginId)) {
      runtime.catalog.pause()
      runtime.status.value = 'disconnected'
      runtime.invalidReason.value = '音乐源已停用，已加载歌曲仍可查看。'
      return
    }
    const plugin = options.getPlugin(recipe.pluginId)
    if (!plugin || !isPluginAvailable(recipe.pluginId)) {
      syncRuntimeAvailability()
      return
    }
    if (runtime.requiresRestart) {
      if (!recipe.result) return runDrawer(drawerId)
      // Source generations revoke live readers, not retained rows or their checkpoint.
      // Rebind through the current plugin; only an explicit refresh starts at page one.
      restoreCatalog(recipe, runtime, plugin)
    }
    await runtime.catalog.loadNext()
    updateDrawerOutcome(recipe, runtime)
  }

  /** 删除歌曲同步当前抽屉的保留结果，不改写资料库、喜欢列表或原始请求。 */
  function removeTracks(drawerId: string, trackIds: readonly string[]): void {
    const runtime = runtimeById.get(drawerId)
    if (!runtime?.catalog) return
    runtime.catalog.removeTracks(trackIds)
    saveDrawerResult(drawerId, runtime)
  }

  function retry(drawerId: string): Promise<void> {
    return runDrawer(drawerId)
  }

  function prepareVerification(drawerId: string): void {
    const recipe = drawerRecipes.value.find((drawer) => drawer.id === drawerId)
    if (recipe && isPluginEnabled(recipe.pluginId))
      runtimeById.get(drawerId)?.catalog?.prepareVerification()
  }

  async function verify(drawerId: string): Promise<void> {
    const recipe = drawerRecipes.value.find((drawer) => drawer.id === drawerId)
    const runtime = runtimeById.get(drawerId)
    if (!recipe || !runtime?.catalog || !isPluginEnabled(recipe.pluginId)) return
    await runtime.catalog.verify()
    if (runtimeById.get(drawerId) === runtime) updateDrawerOutcome(recipe, runtime)
  }

  function cancelVerification(drawerId?: string): void {
    if (drawerId) runtimeById.get(drawerId)?.catalog?.cancelVerification()
  }

  function invalidateSource(event: SourceInvalidation): void {
    for (const recipe of drawerRecipes.value) {
      if (recipe.pluginId !== event.pluginId) continue
      const runtime = runtimeById.get(recipe.id)
      const catalog = runtime?.catalog
      if (
        !runtime ||
        !catalog ||
        (event.accountId && catalog.account.value?.id !== event.accountId)
      )
        continue
      // The old native work is already revoked; the verified listing will start from page one.
      // Only its successful credential commit may cross this boundary. Removal/proxy changes still cancel.
      if (event.reason === 'credentials-updated' && catalog.acceptsCredentialRecovery.value)
        continue
      const wasBusy = catalog.isLoading.value || catalog.isVerifying.value
      if (!event.accountId) {
        runtime.requiresRestart = true
        if (!wasBusy) {
          catalog.suspend()
          void catalog.resume()
          continue
        }
      }
      catalog.invalidate(event.error, !wasBusy && Boolean(event.accountId))
      if (wasBusy) {
        runtime.interruptionError.value = event.error
        runtime.status.value = 'error'
        runtime.invalidReason.value = ''
      }
    }
  }

  function renameDrawer(drawerId: string, title: string): void {
    try {
      const recipe = drawerRecipes.value.find((drawer) => drawer.id === drawerId)
      if (!recipe) throw new AppError('not-found', '找不到音乐列表。')
      store.renameDrawer(drawerId, title, getOriginalDrawerTitle(recipe))
      actionErrorState.value = undefined
    } catch (error) {
      actionErrorState.value = toAppErrorState(error, 'invalid-input', '抽屉重命名失败。')
    }
  }

  /** 旧 v1 配方按原有默认命名算法兼容恢复，不触发来源加载。 */
  function getOriginalDrawerTitle(recipe: CatalogDrawerRecipe): string {
    return (
      recipe.originalTitle ??
      createDefaultDrawerTitle(
        options.getPlugin(recipe.pluginId)?.descriptor.name ?? recipe.pluginId,
        recipe.kind,
        recipe.input,
      )
    )
  }

  function restoreDrawerNames(drawerIds: readonly string[]): number {
    actionErrorState.value = undefined
    const selectedIds = new Set(drawerIds)
    const originals = new Map<string, string>()
    for (const recipe of drawerRecipes.value) {
      if (selectedIds.has(recipe.id)) originals.set(recipe.id, getOriginalDrawerTitle(recipe))
    }
    return store.restoreDrawerNames(originals)
  }

  function toggleDrawerPinned(drawerId: string): void {
    actionErrorState.value = undefined
    const recipe = drawerRecipes.value.find((drawer) => drawer.id === drawerId)
    if (recipe) store.setDrawerPinned(drawerId, !recipe.isPinned)
  }

  function moveDrawer(drawerId: string, targetId: string, visibleIds: readonly string[]): number {
    actionErrorState.value = undefined
    return store.moveDrawer(drawerId, targetId, visibleIds) ? 1 : 0
  }

  /** 歌曲页首次打开时恢复持久化配方；重复进入只复用已加载结果和正在执行的请求。 */
  function openDrawer(drawerId: string): void {
    const recipe = drawerRecipes.value.find((drawer) => drawer.id === drawerId)
    if (!recipe) return
    if (!recipe.isExpanded) store.setDrawerExpanded(drawerId, true)
    const runtime = runtimeById.get(drawerId)
    if (runtime) runtime.accountStatusVisible.value = true
    if (runtime?.status.value === 'idle') void runDrawer(drawerId)
  }

  function toggleDrawer(drawerId: string): void {
    const recipe = drawerRecipes.value.find((drawer) => drawer.id === drawerId)
    if (!recipe) return
    if (!recipe.isExpanded) openDrawer(drawerId)
    else store.setDrawerExpanded(drawerId, false)
  }

  function removeDrawer(drawerId: string): void {
    removeDrawers([drawerId])
  }

  /** 批量集合操作 O(k + n)，只发布一次配方快照并逐个释放旧分页会话。 */
  function removeDrawers(drawerIds: readonly string[]): void {
    actionErrorState.value = undefined
    const selectedIds = new Set(drawerIds)
    for (const drawerId of selectedIds) {
      const runtime = runtimeById.get(drawerId)
      if (runtime) {
        disposeCatalog(runtime)
        runtimeById.delete(drawerId)
      }
    }
    store.removeDrawerRecipes(selectedIds)
  }

  function selectPlugin(pluginId: string): void {
    if (!enabledPlugins.value.some((plugin) => plugin.descriptor.id === pluginId)) {
      actionErrorState.value = createAppErrorState('unsupported-operation', '该音乐源尚未启用。')
      return
    }
    options.activatePlugin(pluginId)
    // 只保存用户选择；临时停用或卸载导致的自动回退不改写上次偏好。
    store.setActivePluginId(pluginId)
    store.persistNow()
    actionErrorState.value = undefined
  }

  function setPluginEnabled(pluginId: string, isEnabled: boolean): void {
    if (
      !isEnabled &&
      !disabledPluginIdSet.value.has(pluginId) &&
      allPlugins.value.filter((plugin) => !disabledPluginIdSet.value.has(plugin.descriptor.id))
        .length <= 1
    ) {
      actionErrorState.value = createAppErrorState('conflict', '至少需要保留一个已启用的音乐源。')
      return
    }
    store.setPluginEnabled(pluginId, isEnabled)
    ensureEnabledPlugin()
    syncRuntimeAvailability()
    actionErrorState.value = undefined
  }

  function setProxySettings(settings: NetworkProxySettings): void {
    store.setProxySettings(settings)
    actionErrorState.value = undefined
  }

  function setDownloadConcurrency(concurrency: number): void {
    store.setDownloadConcurrency(concurrency)
    actionErrorState.value = undefined
  }

  function markTrackUnavailable(trackId: string, error?: AppErrorState): void {
    // Transport, authentication, security challenges and malformed responses are retryable.
    if (error && error.code !== 'not-found' && error.code !== 'source-not-found') return
    store.setTrackUnavailable(trackId, true)
    store.persistNow()
  }

  function markTrackAvailable(trackId: string): void {
    if (!invalidTrackIds.value.has(trackId)) return
    store.setTrackUnavailable(trackId, false)
    store.persistNow()
  }

  function saveDrawerResult(drawerId: string, runtime: CatalogDrawerRuntime): void {
    const catalog = runtime.catalog
    if (!catalog || runtimeById.get(drawerId) !== runtime) return
    const identity =
      catalog.originAccount.value ??
      (catalog.hasAccountIdentity.value ? catalog.account.value : runtime.account)
    store.setDrawerResult(drawerId, {
      tracks: catalog.tracks.value,
      account: identity
        ? { id: identity.id, name: identity.name, customName: identity.customName }
        : undefined,
      loadedPageCount: catalog.loadedPageCount.value,
      total: catalog.total.value,
      sourceUrl: catalog.sourceUrl.value,
      hasMore: catalog.hasMore.value,
      continuation: catalog.continuation.value,
      error: catalog.error.value,
    })
    // A reload immediately after page completion must not lose the rows or their checkpoint.
    store.persistNow()
  }

  function updateDrawerOutcome(recipe: CatalogDrawerRecipe, runtime: CatalogDrawerRuntime): void {
    if (runtimeById.get(recipe.id) !== runtime) return
    if (runtime.catalog && !runtime.catalog.isLoading.value) saveDrawerResult(recipe.id, runtime)
    // 可用性优先于请求结果，防止停用之前发出的请求在完成后把状态改回错误或就绪。
    if (
      !options.getPlugin(recipe.pluginId) ||
      !isPluginEnabled(recipe.pluginId) ||
      !isPluginAvailable(recipe.pluginId)
    ) {
      syncRuntimeAvailability()
      return
    }
    const catalog = runtime.catalog
    if (!catalog) return
    if (catalog.isLoading.value) {
      runtime.status.value = catalog.loadedPageCount.value === 0 ? 'restoring' : 'ready'
      runtime.invalidReason.value = ''
      return
    }
    const code = catalog.errorCode.value
    if (code === 'not-authenticated' && catalog.error.value) {
      options.onAuthenticationExpired?.(recipe.pluginId, catalog.error.value)
    }
    if (isTerminalInvalidError(code)) {
      runtime.status.value = 'invalid'
      runtime.invalidReason.value = catalog.errorMessage.value
      return
    }
    if (code) {
      runtime.status.value = 'error'
      runtime.invalidReason.value = ''
      return
    }
    if (
      recipe.kind === 'import-url' &&
      catalog.loadedPageCount.value > 0 &&
      catalog.tracks.value.length === 0 &&
      !catalog.hasMore.value
    ) {
      runtime.status.value = 'invalid'
      runtime.invalidReason.value = '该 URL 当前没有返回可用音乐，内容可能已失效。'
      return
    }
    runtime.status.value =
      catalog.loadedPageCount.value > 0 || !catalog.hasMore.value ? 'ready' : 'idle'
    runtime.invalidReason.value = ''
  }

  function ensureCatalog(runtime: CatalogDrawerRuntime, plugin: MusicSourcePlugin): Catalog {
    if (runtime.catalog && runtime.plugin === plugin) return runtime.catalog
    disposeCatalog(runtime)
    const catalog = useTrackCatalog(plugin)
    runtime.catalog = catalog
    runtime.plugin = plugin
    return catalog
  }

  function createDrawerView(recipe: CatalogDrawerRecipe): CatalogDrawerView {
    const runtime = runtimeById.get(recipe.id)
    const catalog = runtime?.catalog
    const isSourceEnabled =
      isPluginEnabled(recipe.pluginId) && Boolean(options.getPlugin(recipe.pluginId))
    const status = !options.getPlugin(recipe.pluginId)
      ? 'missing'
      : !isSourceEnabled
        ? 'disconnected'
        : (runtime?.status.value ?? getDormantDrawerStatus(recipe.pluginId))
    const liveAccount = catalog?.account.value
    const origin = catalog?.originAccount.value ?? liveAccount ?? recipe.result?.account
    const account = origin
      ? {
          ...origin,
          ...(liveAccount && origin.id && liveAccount.id === origin.id && liveAccount.state
            ? { state: liveAccount.state }
            : {}),
        }
      : catalog?.hasAccountIdentity.value
        ? liveAccount
        : runtime?.account
    return {
      ...recipe,
      isCustomNamed: recipe.title !== getOriginalDrawerTitle(recipe),
      pluginName: options.getPlugin(recipe.pluginId)?.descriptor.name ?? recipe.pluginId,
      // 多账号列表尚未选出身份时保持未知，不能拿当前平台会话冒充请求账号。
      account,
      accountStatusVisible: runtime?.accountStatusVisible.value ?? false,
      sourceUrl: catalog?.sourceUrl.value ?? recipe.result?.sourceUrl,
      isSourceEnabled,
      loadedPageCount: catalog?.loadedPageCount.value ?? recipe.result?.loadedPageCount ?? 0,
      tracks: catalog?.tracks.value ?? recipe.result?.tracks ?? [],
      total: catalog ? catalog.total.value : recipe.result?.total,
      hasMore:
        isSourceEnabled && isPluginAvailable(recipe.pluginId) && (catalog?.hasMore.value ?? false),
      isLoading: isSourceEnabled && (catalog?.isLoading.value ?? false),
      status,
      errorCode:
        runtime?.interruptionError.value?.code ??
        (isSourceEnabled ? catalog?.errorCode.value : undefined),
      canVerify: catalog?.canVerify.value,
      isVerifying: catalog?.isVerifying.value,
      verificationPhase: catalog?.verificationPhase.value,
      verificationErrorMessage: catalog?.verificationErrorMessage.value,
      failureOperation: catalog?.failureOperation.value,
      errorMessage: runtime?.interruptionError.value
        ? formatAppErrorMessage(runtime.interruptionError.value)
        : isSourceEnabled
          ? (catalog?.errorMessage.value ?? '')
          : '',
      invalidReason: runtime?.invalidReason.value ?? '',
    }
  }

  function syncRuntimeDrawers(): void {
    const recipeIds = new Set(drawerRecipes.value.map((drawer) => drawer.id))
    for (const recipe of drawerRecipes.value) {
      if (!runtimeById.has(recipe.id)) {
        runtimeById.set(recipe.id, {
          status: shallowRef(getDormantDrawerStatus(recipe.pluginId)),
          invalidReason: shallowRef(getDormantDrawerReason(recipe.pluginId)),
          interruptionError: shallowRef(),
          accountStatusVisible: shallowRef(false),
        })
        const runtime = runtimeById.get(recipe.id)!
        const plugin = options.getPlugin(recipe.pluginId)
        if (recipe.result && plugin) {
          restoreCatalog(recipe, runtime, plugin)
        }
      }
    }
    for (const [drawerId, runtime] of runtimeById) {
      if (recipeIds.has(drawerId)) continue
      disposeCatalog(runtime)
      runtimeById.delete(drawerId)
    }
  }

  /** Restoring retained metadata never creates a platform listing, lease or request. */
  function restoreCatalog(
    recipe: CatalogDrawerRecipe,
    runtime: CatalogDrawerRuntime,
    plugin: MusicSourcePlugin,
  ): void {
    if (!recipe.result) return
    const catalog = ensureCatalog(runtime, plugin)
    runtime.requiresRestart = false
    catalog.restore(recipe.result, () =>
      recipe.kind === 'search'
        ? plugin.search({ query: recipe.input })
        : plugin.importFromUrl({ url: recipe.input }),
    )
    if (getDormantDrawerStatus(recipe.pluginId) !== 'idle') return
    const emptyImport =
      recipe.kind === 'import-url' &&
      catalog.loadedPageCount.value > 0 &&
      catalog.tracks.value.length === 0 &&
      !catalog.hasMore.value &&
      !catalog.error.value
    runtime.status.value =
      isTerminalInvalidError(catalog.errorCode.value) || emptyImport
        ? 'invalid'
        : catalog.error.value
          ? 'error'
          : 'ready'
    runtime.invalidReason.value = emptyImport
      ? '该 URL 当前没有返回可用音乐，内容可能已失效。'
      : runtime.status.value === 'invalid'
        ? catalog.errorMessage.value
        : ''
  }

  function syncRuntimeAvailability(): void {
    for (const recipe of drawerRecipes.value) {
      const runtime = runtimeById.get(recipe.id)
      if (!runtime) continue

      const plugin = options.getPlugin(recipe.pluginId)
      if (!plugin) {
        runtime.requiresRestart = true
        if (runtime.catalog?.isLoading.value || runtime.catalog?.isVerifying.value)
          invalidateSource({
            pluginId: recipe.pluginId,
            error: createAppErrorState(
              'operation-cancelled',
              '列表使用的音乐源已卸载，加载已中止。请重新安装音乐源后重试。',
            ),
          })
        runtime.catalog?.suspend()
        runtime.status.value = 'missing'
        runtime.invalidReason.value = '创建该抽屉的音乐源已卸载。'
        continue
      }
      if (!isPluginEnabled(recipe.pluginId)) {
        runtime.requiresRestart = true
        if (runtime.catalog?.isLoading.value || runtime.catalog?.isVerifying.value)
          invalidateSource({
            pluginId: recipe.pluginId,
            error: createAppErrorState(
              'operation-cancelled',
              '列表使用的音乐源已停用，加载已中止。请在设置中启用后重试。',
            ),
          })
        runtime.catalog?.suspend()
        runtime.status.value = 'disconnected'
        runtime.invalidReason.value = '音乐源已停用，已加载歌曲仍可查看。'
        continue
      }
      if (!isPluginAvailable(recipe.pluginId)) {
        runtime.requiresRestart = true
        runtime.catalog?.suspend()
        runtime.status.value = 'paused'
        runtime.invalidReason.value = getPluginAvailabilityReason(recipe.pluginId)
        continue
      }
      if (runtime.plugin && runtime.plugin !== plugin) disposeCatalog(runtime)
      if (!runtime.catalog) {
        if (recipe.result) {
          restoreCatalog(recipe, runtime, plugin)
        } else {
          runtime.status.value = 'idle'
          runtime.invalidReason.value = ''
        }
      } else if (
        runtime.status.value === 'disconnected' ||
        runtime.status.value === 'paused' ||
        runtime.status.value === 'missing'
      ) {
        void runtime.catalog.resume().then(() => updateDrawerOutcome(recipe, runtime))
        updateDrawerOutcome(recipe, runtime)
      }
    }
  }

  function ensureEnabledPlugin(): void {
    const plugins = allPlugins.value
    if (plugins.length === 0) return
    // Availability/policy failure may leave zero usable sources; never rewrite the user's switches.
    const activePluginId = toValue(options.activePlugin).descriptor.id
    const fallback = enabledPlugins.value[0]
    if ((!isPluginEnabled(activePluginId) || !isPluginAvailable(activePluginId)) && fallback) {
      options.activatePlugin(fallback.descriptor.id)
    }
  }

  function isPluginEnabled(pluginId: string): boolean {
    return !disabledPluginIdSet.value.has(pluginId) && options.isPluginAllowed?.(pluginId) !== false
  }

  function isPluginAvailable(pluginId: string): boolean {
    return availabilityByPluginId.value[pluginId]?.status === 'available'
  }

  function getPluginAvailabilityReason(pluginId: string): string {
    return formatAppErrorMessage(getPluginAvailabilityError(pluginId))
  }

  function getPluginAvailabilityError(pluginId: string): AppErrorState {
    const availability = availabilityByPluginId.value[pluginId]
    switch (availability?.status) {
      case 'checking':
        return createAppErrorState('unsupported-operation', '外部插件正在检测有效性，请稍候。')
      case 'invalid':
        return availability.error
      case 'unavailable':
        return availability.error
      case 'unchecked':
      default:
        return createAppErrorState('unsupported-operation', '外部插件尚未通过有效性检测。')
    }
  }

  function getDormantDrawerStatus(pluginId: string): CatalogDrawerStatus {
    if (!options.getPlugin(pluginId)) return 'missing'
    if (!isPluginEnabled(pluginId)) return 'disconnected'
    return isPluginAvailable(pluginId) ? 'idle' : 'paused'
  }

  function getDormantDrawerReason(pluginId: string): string {
    if (!options.getPlugin(pluginId)) return '创建该抽屉的音乐源已卸载。'
    if (!isPluginEnabled(pluginId)) return '音乐源已停用，启用后可展开此抽屉。'
    return isPluginAvailable(pluginId) ? '' : getPluginAvailabilityReason(pluginId)
  }

  function persistNow(): void {
    store.persistNow()
  }

  onScopeDispose(() => {
    for (const runtime of runtimeById.values()) disposeCatalog(runtime)
    persistNow()
  })

  return {
    searchQuery,
    importUrl,
    proxySettings,
    downloadConcurrency,
    drawers,
    enabledPlugins,
    configuredEnabledPluginIds,
    invalidTrackIds: readonly(invalidTrackIds),
    isBusy,
    actionError: readonly(actionError),
    actionErrorState: readonly(actionErrorState),
    persistenceError,
    persistenceErrorState: readonly(persistenceErrorState),
    search,
    importFromUrl,
    loadNext,
    removeTracks,
    retry,
    verify,
    prepareVerification,
    cancelVerification,
    cancel(drawerId: string): void {
      const runtime = runtimeById.get(drawerId)
      if (!runtime?.catalog) return
      runtime.catalog.suspend()
      runtime.requiresRestart = true
      runtime.status.value = 'paused'
      runtime.invalidReason.value = '已停止加载，可重试此列表。'
    },
    invalidateSource,
    renameDrawer,
    restoreDrawerNames,
    toggleDrawerPinned,
    moveDrawer,
    openDrawer,
    toggleDrawer,
    removeDrawer,
    removeDrawers,
    selectPlugin,
    setPluginEnabled,
    setProxySettings,
    setDownloadConcurrency,
    isPluginEnabled,
    markTrackUnavailable,
    markTrackAvailable,
    persistNow,
  }
}

function createDefaultDrawerTitle(
  plugin: MusicSourcePlugin | string,
  kind: CatalogRequestKind,
  input: string,
): string {
  const requestTitle = kind === 'search' ? `搜索：${input}` : 'URL 导入'
  return `${typeof plugin === 'string' ? plugin : plugin.descriptor.name} · ${requestTitle}`.slice(
    0,
    80,
  )
}

function isTerminalInvalidError(code: AppErrorCode | undefined): boolean {
  return code === 'not-found' || code === 'unsupported-url'
}

function disposeCatalog(runtime: CatalogDrawerRuntime): void {
  runtime.catalog?.reset()
  runtime.catalog = undefined
  runtime.plugin = undefined
}
