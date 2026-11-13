import type { MusicSourcePlugin } from '@any-music/core'
import { createMusicSourceRegistry } from '@any-music/plugin-center/music-sources'
import {
  computed,
  getCurrentScope,
  onScopeDispose,
  readonly,
  shallowRef,
  toValue,
  watch,
} from 'vue'
import type { MaybeRefOrGetter } from 'vue'

import { createNativeCatalogSource } from '../../plugin-adapters/native-catalog-source'
import { getWorkbenchRuntime } from '../../runtime/workbench-runtime'

/** Vue only observes snapshots; registration, conflicts and asynchronous checks belong to plugin-center. */
export function useMusicSourceRegistry(
  builtInPlugins: readonly MusicSourcePlugin[],
  externalSourcesEnabled: MaybeRefOrGetter<boolean> = false,
) {
  const runtime = getWorkbenchRuntime()
  const registry = createMusicSourceRegistry({
    externalPlugins: runtime.externalPlugins,
    builtInPlugins,
    prepareMedia: (track, source) =>
      getWorkbenchRuntime().prepareMedia?.(track, source) ?? Promise.resolve(source),
  })
  const plugins = shallowRef(registry.plugins)
  const availabilityByPluginId = shallowRef(registry.availabilityByPluginId)
  const activePluginId = shallowRef(registry.activePluginId)
  const unsubscribe = registry.subscribe(() => {
    plugins.value = registry.plugins
    availabilityByPluginId.value = registry.availabilityByPluginId
    activePluginId.value = registry.activePluginId
  })
  const stopExternalSources = watch(
    () => toValue(externalSourcesEnabled),
    (enabled, _, onCleanup) => {
      if (!enabled || runtime.externalPlugins === 'none') return
      let current = true
      let signature = ''
      const unsubscribeNative = runtime.nativePluginAuthority?.subscribeInstalls?.((states) => {
        if (!current) return
        const sources = states.filter(
          (state) =>
            state.enabled &&
            !state.dev &&
            state.contributions?.includes('music.sources') &&
            state.commands?.some((command) => command.id === 'search'),
        )
        const next = JSON.stringify(
          sources.map((state) => [state.installId, state.permissionEpoch, state.contentHash]),
        )
        if (signature === next) return
        signature = next
        registry.setRuntimeSources(
          sources.map((state) => createNativeCatalogSource(runtime.nativePluginAuthority!, state)),
        )
      })
      onCleanup(() => {
        current = false
        unsubscribeNative?.()
        // Disposal aborts managed listings before the next feature generation can register.
        registry.setRuntimeSources([])
      })
    },
    { immediate: true, flush: 'sync' },
  )
  if (getCurrentScope())
    onScopeDispose(() => {
      unsubscribe()
      stopExternalSources()
      registry.dispose()
    })
  const activePlugin = computed(() => {
    // Reading both snapshots invalidates selection when an installed plugin changes.
    return (
      plugins.value.find((plugin) => plugin.descriptor.id === activePluginId.value) ??
      builtInPlugins[0]!
    )
  })
  return {
    plugins: readonly(plugins),
    availabilityByPluginId: readonly(availabilityByPluginId),
    activePluginId: readonly(activePluginId),
    activePlugin,
    activate: registry.activate,
    remove: registry.remove,
    getPlugin: registry.getPlugin,
    getAvailability: registry.getAvailability,
    checkAvailability: registry.checkAvailability,
    canPrefetchMedia: registry.canPrefetchMedia,
    resolveMedia: registry.resolveMedia,
    setEnabled: registry.setEnabled,
    invalidateSource: registry.invalidateSource,
  }
}
