import type { AppErrorState } from '@any-music/core'
import { createModuleRecovery, ModuleFrameworkError } from '@any-music/plugin-center'
import type { ModuleFailureRecord } from '@any-music/plugin-center'
import type { AllocationSnapshot } from '@any-music/plugin-center'
import { THEME_ROOT_POINT } from '@any-music/plugin-ui-vue/directory'
import { UI_CONTRIBUTIONS } from '@any-music/ui'
import type { UiContributionHost } from '@any-music/ui'
import type { ProductViewId } from '@any-music/ui'
import { computed, getCurrentInstance, onScopeDispose, provide, readonly, shallowRef } from 'vue'

import {
  createWorkbenchModuleHost,
  getWorkbenchModuleConfiguration,
  toModuleStartupError,
} from '../../plugin-adapters/workbench-modules'
import type {
  WorkbenchModuleHost,
  WorkbenchModulePorts,
} from '../../plugin-adapters/workbench-modules'
import { WORKBENCH_VIEW_OWNERS } from '../../plugin-adapters/workbench-ui-directory'
import type { WorkbenchRuntime } from '../../runtime/workbench-runtime'

interface RecoverySnapshot {
  lastFailure?: { moduleIds: readonly string[]; reason?: string; error: AppErrorState }
  disableOptional: boolean
  disabledModuleIds?: readonly string[]
}
const RECOVERY_KEY = 'module-recovery:v1'

/** Recovery state belongs to the host, outside module registration and allocation. */
export function useWorkbenchModules(
  runtime: WorkbenchRuntime,
  ports: WorkbenchModulePorts,
  onRestoreDefaultTheme?: () => void,
) {
  const failure = shallowRef<AppErrorState>()
  const busy = shallowRef(false)
  const recoveryOpen = shallowRef(false)
  let host: WorkbenchModuleHost | undefined
  const allocation = shallowRef<AllocationSnapshot>()
  const revision = shallowRef(0)
  let unsubscribe: (() => void) | undefined
  let startupComplete = Promise.resolve()
  let disposed = false
  let snapshot: RecoverySnapshot = { disableOptional: false }
  const disableOptional = shallowRef(false)
  try {
    const stored = runtime.storage.read<RecoverySnapshot>(RECOVERY_KEY)
    if (stored && typeof stored.disableOptional === 'boolean')
      snapshot = {
        ...stored,
        disabledModuleIds: Array.isArray(stored.disabledModuleIds)
          ? stored.disabledModuleIds.filter((id): id is string => typeof id === 'string')
          : [],
      }
    disableOptional.value = snapshot.disableOptional
    if (snapshot.lastFailure) failure.value = snapshot.lastFailure.error
  } catch (error) {
    failure.value = toModuleStartupError(error)
  }

  function report(record: ModuleFailureRecord | undefined): void {
    failure.value = record ? toModuleStartupError(record.reason) : undefined
    snapshot = {
      ...snapshot,
      lastFailure: record
        ? { moduleIds: record.moduleIds, reason: record.reason, error: failure.value! }
        : undefined,
    }
    try {
      runtime.storage.write(RECOVERY_KEY, snapshot)
    } catch (error) {
      failure.value = toModuleStartupError(error)
    }
  }
  const recovery = createModuleRecovery({
    readFailure: () =>
      snapshot.lastFailure
        ? {
            moduleIds: snapshot.lastFailure.moduleIds,
            reason: snapshot.lastFailure.reason ?? 'previous-startup-failed',
          }
        : undefined,
    writeFailure: report,
    disableOptionalModules: () => {
      snapshot = { ...snapshot, disableOptional: true }
      disableOptional.value = true
    },
    restoreDefaultTheme: () => {
      // Only the existing appearance field is reset; navigation and user business data survive.
      const preferences = runtime.storage.read<Record<string, unknown>>('app-shell:v1')
      runtime.storage.write('app-shell:v1', {
        ...(preferences && typeof preferences === 'object' ? preferences : {}),
        theme: 'system',
      })
      onRestoreDefaultTheme?.()
    },
  })

  async function start(safe?: boolean): Promise<void> {
    if (busy.value || disposed) return
    busy.value = true
    let completeStartup: (() => void) | undefined
    startupComplete = new Promise<void>((resolve) => {
      completeStartup = resolve
    })
    try {
      if (safe) await recovery.safeStart()
      else if (safe === false) {
        snapshot = { ...snapshot, disableOptional: false }
        disableOptional.value = false
      }
      await host?.dispose()
      unsubscribe?.()
      if (disposed) return
      const config = getWorkbenchModuleConfiguration(runtime)
      host = createWorkbenchModuleHost({ ...config, ports, onRequiredFailure: report })
      unsubscribe = host.controller.subscribe((value) => {
        allocation.value = value
        revision.value++
      })
      await Promise.all(
        (snapshot.disabledModuleIds ?? [])
          .filter((id) =>
            host!.controller.descriptors.some((entry) => entry.id === id && !entry.required),
          )
          .map((id) => host!.controller.setEnabled(id, false)),
      )
      if (snapshot.disableOptional) {
        await Promise.all(
          host.controller.descriptors
            .filter((entry) => !entry.required)
            .map((descriptor) => host!.controller.setEnabled(descriptor.id, false)),
        )
      }
      await host.start()
      if (safe && !disposed) ports.navigation.selectView('catalog')
      if (!disposed) {
        failure.value = undefined
        recoveryOpen.value = false
        if (snapshot.lastFailure || safe !== undefined) report(undefined)
      }
    } catch (error) {
      if (!disposed)
        report({
          moduleIds:
            snapshot.lastFailure?.moduleIds ??
            (error instanceof ModuleFrameworkError ? error.path : []),
          reason: error instanceof ModuleFrameworkError ? error.reason : 'startup-failed',
        })
    } finally {
      busy.value = false
      completeStartup?.()
    }
  }

  onScopeDispose(() => {
    disposed = true
    unsubscribe?.()
    void host?.dispose()
  })
  // A saved failure first exposes recovery; it does not silently replay a failed optional startup.
  const ready = failure.value ? Promise.resolve() : start()
  const contributionHost: UiContributionHost = {
    resolve(point, context) {
      void revision.value
      if (!host) return []
      const config = getWorkbenchModuleConfiguration(runtime)
      const effectiveContext = {
        runtime: config.runtime,
        form: config.form,
        area: ports.navigation.currentView(),
        hasTrack: false,
        selectionCount: 0,
        ...context,
      }
      const current = host.controller.preview({ context: effectiveContext })
      const ids = current.slots[point] ?? []
      return host.controller.definitions.contributions
        .filter(
          (entry) =>
            ids.includes(entry.id) && ports.optionalFeatures?.isUsable(entry.ownerId) !== false,
        )
        .map((entry) => ({
          id: entry.id,
          implementationId: entry.implementationId,
          revision: revision.value + (ports.optionalFeatures?.revision?.() ?? 0),
          viewRevision: ports.navigation.revision(),
          contextKey: JSON.stringify(effectiveContext),
          title: entry.implementationId === 'batch-tags' ? '添加标签' : undefined,
          inputLabel: entry.implementationId === 'batch-tags' ? '标签名称' : undefined,
          inputOptions:
            entry.implementationId === 'batch-tags' || entry.implementationId === 'manage-tags'
              ? ports.optionalFeatures?.tagInputOptions?.(context?.selectedTracks ?? [])
              : undefined,
        }))
    },
    accepts(item, point, context) {
      return (
        item.revision === revision.value + (ports.optionalFeatures?.revision?.() ?? 0) &&
        item.viewRevision === ports.navigation.revision() &&
        contributionHost
          .resolve(point, context)
          .some((entry) => entry.id === item.id && entry.contextKey === item.contextKey)
      )
    },
    invoke(item, point, context, input) {
      if (
        !host ||
        !ports.interaction.hasUserGesture() ||
        !contributionHost.accepts(item, point, context) ||
        point !== 'trackList.operator.actions' ||
        !context?.selectionCount
      )
        return
      if (item.implementationId === 'batch-tags' && input !== undefined) {
        if (!context?.selectedTracks || context.selectedTracks.length !== context.selectionCount)
          return
        ports.optionalFeatures?.addTags?.(context.selectedTracks, input)
        return
      }
      if (item.implementationId === 'batch-tags')
        void host.controller
          .executeCommand('feature.tags/open-tags', {
            objectRevision: item.viewRevision,
            viewRevision: item.viewRevision,
          })
          .catch((error: unknown) => {
            failure.value = toModuleStartupError(error)
          })
    },
  }
  if (getCurrentInstance()) provide(UI_CONTRIBUTIONS, contributionHost)
  return {
    async setSourceEnabled(providerId: string, enabled: boolean) {
      if (!host || busy.value) return
      const owners = host.controller.descriptors.filter((entry) =>
        entry.contributions.some(
          (contribution) =>
            contribution.pointId === 'music.sources' &&
            contribution.implementationId === providerId,
        ),
      )
      // User source switches are persisted by the source workspace; recovery remains an overlay.
      await Promise.all(owners.map((owner) => host!.controller.setEnabled(owner.id, enabled)))
    },
    /** Resolve provider identities from the build directory, never from editable source manifests. */
    isSourceEnabled(providerId: string) {
      void revision.value
      const config = getWorkbenchModuleConfiguration(runtime)
      const owners = config.directory.filter((entry) =>
        entry.contributions.some(
          (contribution) =>
            contribution.pointId === 'music.sources' &&
            contribution.implementationId === providerId,
        ),
      )
      if (!owners.length) return true
      if (!host) return false
      const slots =
        host.controller.preview({
          context: {
            runtime: config.runtime,
            form: config.form,
            area: ports.navigation.currentView(),
            hasTrack: false,
            selectionCount: 0,
          },
        }).slots['music.sources'] ?? []
      return owners.some((owner) => {
        const state = host?.controller.states.get(owner.id)
        return (
          state?.enabled &&
          !['failed', 'suspended'].includes(state.activation) &&
          owner.contributions.some((entry) => slots.includes(`${owner.id}/${entry.localId}`))
        )
      })
    },
    contributions: contributionHost,
    getDevelopmentStatus: (id: string) =>
      getWorkbenchModuleConfiguration(runtime).directory.find(
        (entry) =>
          entry.id === id ||
          entry.contributions.some(
            (contribution) =>
              contribution.pointId === 'music.sources' && contribution.implementationId === id,
          ),
      )?.developmentStatus,
    getUnavailableReason: (id: string) =>
      getWorkbenchModuleConfiguration(runtime).directory.find(
        (entry) =>
          entry.id === id ||
          entry.contributions.some(
            (contribution) =>
              contribution.pointId === 'music.sources' && contribution.implementationId === id,
          ),
      )?.unavailableReason,
    isEnabled: (id: string) => {
      void revision.value
      return !!host?.controller.states.get(id)?.enabled
    },
    setEnabled: async (id: string, enabled: boolean) => {
      if (!host || busy.value) return
      if (
        enabled &&
        host.controller.descriptors.find((entry) => entry.id === id)?.unavailableReason
      )
        return
      try {
        await host.controller.setEnabled(id, enabled)
        const disabled = new Set(snapshot.disabledModuleIds)
        if (enabled) disabled.delete(id)
        else disabled.add(id)
        snapshot = { ...snapshot, disabledModuleIds: [...disabled] }
        if (!enabled && WORKBENCH_VIEW_OWNERS[ports.navigation.currentView()] === id)
          ports.navigation.selectView('catalog')
        runtime.storage.write(RECOVERY_KEY, snapshot)
      } catch (error) {
        failure.value = toModuleStartupError(error)
      }
    },
    prepareTheme: async (id: string) => {
      await ready
      await startupComplete
      // The system fallback must remain usable even when the registry/allocator cannot start.
      if ((!host || failure.value) && id === 'default' && !disposed)
        return {
          registryRevision: 0,
          lifecycleGeneration: 0,
          slots: { [THEME_ROOT_POINT]: ['theme.default/root'] },
        }
      if (!host || disposed || failure.value) throw new Error('Module host is unavailable')
      const config = getWorkbenchModuleConfiguration(runtime)
      return host.controller.activate([`theme.${id}`], {
        context: {
          runtime: config.runtime,
          form: config.form,
          area: ports.navigation.currentView(),
          hasTrack: false,
          selectionCount: 0,
        },
        themeMappings: { [THEME_ROOT_POINT]: `theme.${id}/root` },
      })
    },
    allocation: readonly(allocation),
    resolveViews: () => {
      void revision.value
      if (!host) return []
      const config = getWorkbenchModuleConfiguration(runtime)
      const viewAllocation = host.controller.preview({
        context: {
          runtime: config.runtime,
          form: config.form,
          area: ports.navigation.currentView(),
          hasTrack: false,
          selectionCount: 0,
        },
      })
      return host.controller.definitions.contributions
        .filter(
          (entry) =>
            viewAllocation.slots['workspace.views']?.includes(entry.id) &&
            ports.optionalFeatures?.isUsable(entry.ownerId) !== false,
        )
        .map((entry) => ({
          id: entry.id,
          implementationId: entry.implementationId,
          hasNavigation: host!.controller.definitions.contributions.some(
            (navigation) =>
              viewAllocation.slots['navigation.sidebar']?.includes(navigation.id) &&
              navigation.ownerId === entry.ownerId &&
              navigation.implementationId === entry.implementationId,
          ),
        }))
    },
    failure: readonly(failure),
    busy: readonly(busy),
    needsRecovery: computed(() => recoveryOpen.value || Boolean(failure.value)),
    ready,
    retry: () => start(false),
    openRecovery: () => {
      recoveryOpen.value = true
    },
    safeStart: () => start(true),
    canOpenView: (id: ProductViewId) => {
      void revision.value
      const owner = WORKBENCH_VIEW_OWNERS[id]
      if (owner === 'feature.tags' || owner === 'feature.composer')
        return (
          !!host?.controller.states.get(owner)?.enabled &&
          ports.optionalFeatures?.isUsable(owner) !== false
        )
      return true
    },
    restoreDefaultTheme: () => {
      try {
        recovery.restoreDefaultTheme()
      } catch (error) {
        failure.value = toModuleStartupError(error)
      }
    },
  }
}
