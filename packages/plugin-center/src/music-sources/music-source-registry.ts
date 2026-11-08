import { AppError, createAppErrorState, MusicSourceError, toAppErrorState } from '@any-music/core'
import type {
  MediaResolveOptions,
  MusicSourceAvailability,
  MusicSourcePlugin,
  ResolvedMediaSource,
  Track,
} from '@any-music/core'

import { allowsExternalPlugins } from '../external-plugin-policy'
import type { ExternalPluginPolicy } from '../external-plugin-policy'
import { PluginCatalog, PluginCatalogError } from '../plugin-catalog'
import { createManagedMusicSourcePlugin } from './managed-music-source-plugin'

/** Runtime sources are injected: registration never chooses HTTP, storage or permission UI. */
export interface MusicSourceRegistryOptions {
  externalPlugins: ExternalPluginPolicy
  builtInPlugins: readonly MusicSourcePlugin[]
  prepareMedia?: (track: Track, source: ResolvedMediaSource) => Promise<ResolvedMediaSource>
}

/** Framework-free state owner; subscribers receive snapshots and must unsubscribe on disposal. */
export function createMusicSourceRegistry(options: MusicSourceRegistryOptions) {
  const { builtInPlugins } = options
  // Only the application directory confers built-in identity. Never trust provenance
  // or a builtIn/signature field supplied by an external source projection.
  const builtInIds = new Set(builtInPlugins.map((plugin) => plugin.descriptor.id))
  const allowExternal = allowsExternalPlugins(options.externalPlugins)
  function assertAllowed(pluginId: string): void {
    if (!allowExternal && !builtInIds.has(pluginId))
      throw new AppError('unsupported-operation', '当前运行端仅支持内置插件。')
  }
  const listeners = new Set<() => void>()
  const notify = (): void => {
    for (const listener of listeners) listener()
  }
  const checkGeneration = new Map<string, symbol>()
  const managed = new Map<string, ReturnType<typeof createManagedMusicSourcePlugin>>()
  const disabled = new Set<string>()
  const runtimeSources = new Set<string>()
  function manage(plugin: MusicSourcePlugin): MusicSourcePlugin {
    const descriptor = Object.freeze({
      ...plugin.descriptor,
      provenance: builtInIds.has(plugin.descriptor.id)
        ? ('built-in' as const)
        : ('external' as const),
    })
    const lifetime = createManagedMusicSourcePlugin(plugin, options.prepareMedia)
    managed.set(plugin.descriptor.id, lifetime)
    return { ...lifetime.plugin, descriptor }
  }

  if (builtInPlugins.length === 0) throw new Error('音乐源注册表至少需要一个内置插件。')
  const catalog = new PluginCatalog(builtInPlugins.map(manage))
  const pluginById = {
    get: (id: string) => catalog.get(id),
    has: (id: string) => Boolean(catalog.get(id)),
  }
  const initialAvailability: Record<string, MusicSourceAvailability> = Object.fromEntries(
    builtInPlugins.map((plugin) => [
      plugin.descriptor.id,
      { status: 'available', checkedAtMs: Date.now() } satisfies MusicSourceAvailability,
    ]),
  )

  let availabilityByPluginId: Readonly<Record<string, MusicSourceAvailability>> =
    initialAvailability
  let activePluginId = builtInPlugins[0]?.descriptor.id ?? ''

  function activate(pluginId: string): void {
    assertAllowed(pluginId)
    if (!pluginById.has(pluginId)) throw new AppError('not-found', '找不到音乐源插件。')
    activePluginId = pluginId
    notify()
  }

  function remove(pluginId: string): void {
    try {
      catalog.remove(pluginId)
    } catch (error) {
      if (error instanceof PluginCatalogError)
        throw new AppError(error.code, error.message, { cause: error })
      throw error
    }
    managed.get(pluginId)?.dispose()
    managed.delete(pluginId)
    disabled.delete(pluginId)
    checkGeneration.delete(pluginId)
    const nextAvailability = { ...availabilityByPluginId }
    delete nextAvailability[pluginId]
    availabilityByPluginId = nextAvailability
    if (activePluginId === pluginId) activePluginId = builtInPlugins[0]?.descriptor.id ?? ''
    notify()
  }

  function getPlugin(pluginId: string): MusicSourcePlugin | undefined {
    if (!allowExternal && !builtInIds.has(pluginId)) return undefined
    return pluginById.get(pluginId)
  }

  function getAvailability(pluginId: string): MusicSourceAvailability {
    return (
      availabilityByPluginId[pluginId] ?? {
        status: 'unavailable',
        checkedAtMs: Date.now(),
        error: createAppErrorState('not-found', '插件未安装。'),
      }
    )
  }

  function syncEnabled(pluginId: string): void {
    managed
      .get(pluginId)
      ?.setEnabled(!disabled.has(pluginId) && getAvailability(pluginId).status === 'available')
  }
  function setEnabled(pluginId: string, enabled: boolean): void {
    if (enabled) assertAllowed(pluginId)
    if (enabled) disabled.delete(pluginId)
    else disabled.add(pluginId)
    syncEnabled(pluginId)
  }

  async function checkAvailability(pluginId: string): Promise<MusicSourceAvailability> {
    assertAllowed(pluginId)
    const plugin = pluginById.get(pluginId)
    if (!plugin) throw new AppError('not-found', '找不到音乐源插件。')
    // A unique token also protects remove/reinstall of the same plugin object.
    const generation = Symbol(pluginId)
    checkGeneration.set(pluginId, generation)
    availabilityByPluginId = {
      ...availabilityByPluginId,
      [pluginId]: { status: 'checking' },
    }
    notify()
    let result: MusicSourceAvailability
    try {
      result = await plugin.checkAvailability()
    } catch (error) {
      // 第三方实现违反契约时也必须离开 checking，避免插件永久卡在不可操作状态。
      result = {
        status: 'unavailable',
        checkedAtMs: Date.now(),
        error: toAppErrorState(error, 'upstream-error', '音乐源有效性检测失败。'),
      }
    }
    // 检测期间插件可能被删除或同 ID 被重新安装，旧请求不得覆盖新实例状态。
    if (pluginById.get(pluginId) === plugin && checkGeneration.get(pluginId) === generation) {
      availabilityByPluginId = { ...availabilityByPluginId, [pluginId]: result }
      syncEnabled(pluginId)
      notify()
    }
    return result
  }

  function resolveMedia(
    track: Track,
    resolveOptions?: MediaResolveOptions,
  ): Promise<ResolvedMediaSource> {
    try {
      assertAllowed(track.source.pluginId)
    } catch (error) {
      return Promise.reject(error)
    }
    const plugin = pluginById.get(track.source.pluginId)
    if (!plugin) {
      return Promise.reject(
        new MusicSourceError('not-found', `曲目所需插件未安装：${track.source.pluginId}`),
      )
    }
    return plugin.resolveMedia(track, resolveOptions)
  }

  /**
   * 后台预取只能调用“解析后仍是远程 URL”的轻量解析器。complete-binary 会在 resolveMedia
   * 内完整读取媒体，因此必须等该叶子真正成为当前播放目标后再执行。
   */
  function canPrefetchMedia(track: Track): boolean {
    if (!allowExternal && !builtInIds.has(track.source.pluginId)) return false
    const plugin = pluginById.get(track.source.pluginId)
    if (
      !plugin ||
      disabled.has(track.source.pluginId) ||
      getAvailability(track.source.pluginId).status !== 'available'
    )
      return false
    // External catalogs currently have no admitted media provider.
    return builtInIds.has(track.source.pluginId)
  }

  for (const plugin of catalog.plugins) syncEnabled(plugin.descriptor.id)
  return {
    get plugins() {
      return catalog.plugins
    },
    get availabilityByPluginId() {
      return availabilityByPluginId
    },
    get activePluginId() {
      return activePluginId
    },
    get activePlugin() {
      return pluginById.get(activePluginId) ?? builtInPlugins[0]!
    },
    subscribe(listener: () => void): () => void {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    activate,
    remove,
    getPlugin,
    getAvailability,
    checkAvailability,
    canPrefetchMedia,
    resolveMedia,
    setEnabled,
    /** Trusted runtime projection only. Native installation/authorization stays behind
     * its port; replacing a generation disposes all old cursors and media first. */
    setRuntimeSources(sources: readonly MusicSourcePlugin[]) {
      for (const id of runtimeSources) remove(id)
      runtimeSources.clear()
      if (!allowExternal) return
      for (const plugin of sources) {
        const id = plugin.descriptor.id
        if (catalog.get(id)) continue
        try {
          catalog.assertCanInstall(plugin.descriptor)
        } catch {
          continue
        }
        catalog.install(manage(plugin))
        runtimeSources.add(id)
        availabilityByPluginId = {
          ...availabilityByPluginId,
          [id]: { status: 'available', checkedAtMs: Date.now() },
        }
        syncEnabled(id)
      }
      notify()
    },
    invalidateSource: (pluginId: string) => managed.get(pluginId)?.invalidate(),
    dispose: () => {
      for (const lifetime of managed.values()) lifetime.dispose()
      listeners.clear()
    },
  }
}
