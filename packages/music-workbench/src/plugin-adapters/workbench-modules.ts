import { AppError, toAppErrorState } from '@any-music/core'
import type { Track } from '@any-music/core'
import { ModuleController, ModuleFrameworkError } from '@any-music/plugin-center'
import type {
  BuiltInModule,
  ModuleCommandContext,
  ModuleDescriptor,
  ModuleFailureRecord,
  ModuleForm,
  ModuleRuntime,
} from '@any-music/plugin-center'
import type { ProductViewId } from '@any-music/ui'
import type { UiThemeDescriptor } from '@any-music/ui/theme'

import type { WorkbenchRuntime } from '../runtime/workbench-runtime'
import {
  createWorkbenchModuleDirectory,
  WORKBENCH_EXTENSION_POINTS,
} from './workbench-module-directory'

/** Named host business ports reference the existing instances; modules cannot create replacements. */
export interface WorkbenchModulePorts {
  navigation: {
    selectView(id: ProductViewId): void
    currentView(): ProductViewId
    revision(): number
  }
  interaction: { hasUserGesture(): boolean }
  optionalFeatures?: {
    revision?(): number
    isUsable(id: string): boolean
    addTags?(tracks: readonly Track[], tag: string): void
    tagInputOptions?(tracks: readonly Track[]): readonly { value: string; selected: boolean }[]
  }
  library: { getSummary(): { trackCount: number; playlistCount: number } }
  playback: { stop(): void }
  downloads: { cancelActiveBatch(): void }
}
export interface WorkbenchModuleHost {
  controller: ModuleController
  start(): Promise<void>
  dispose(): Promise<void>
}

export function createWorkbenchModuleHost(options: {
  directory: readonly ModuleDescriptor[]
  features?: readonly ModuleDescriptor[]
  themes?: readonly UiThemeDescriptor[]
  runtime: ModuleRuntime
  form: ModuleForm
  ports: WorkbenchModulePorts
  onRequiredFailure(failure: ModuleFailureRecord): void
}): WorkbenchModuleHost {
  // Pin immutable core providers to this build's descriptors, before creating any runtime instance.
  const canonical = createWorkbenchModuleDirectory(
    options.runtime,
    options.features,
    options.themes,
  )
  for (const expected of canonical.filter((module) => module.required)) {
    const actual = options.directory.find((module) => module.id === expected.id)
    if (!actual || JSON.stringify(actual) !== JSON.stringify(expected))
      throw new ModuleFrameworkError('core-provider-contract', [expected.id])
  }
  const destinations: Readonly<Record<string, ProductViewId>> = {
    'open-catalog': 'catalog',
    'open-queue': 'queue',
    'open-favorites': 'favorites',
    'open-playlists': 'playlists',
    'open-works': 'custom-tracks',
    'open-history': 'history',
    'open-downloads': 'downloads',
    'open-plugins': 'plugins',
    'open-tags': 'tags',
    'open-composer': 'composer',
  }
  const builtIns: BuiltInModule[] = options.directory.map((descriptor) => {
    const expected = canonical.find((module) => module.id === descriptor.id)
    if (!expected || JSON.stringify(expected) !== JSON.stringify(descriptor))
      throw new ModuleFrameworkError('unknown-build-module', [descriptor.id])
    return {
      descriptor,
      activate: () => ({
        contributionIds: descriptor.contributions.map((entry) => entry.localId),
        commands: descriptor.contributions
          .filter((entry) => entry.implementation === 'host-command')
          .map((entry) => ({
            localId: entry.localId,
            validate: () => true,
            execute: () => {
              const view = destinations[entry.localId]
              if (view) options.ports.navigation.selectView(view)
              else if (entry.localId === 'stop-playback') options.ports.playback.stop()
              else if (entry.localId === 'cancel-downloads')
                options.ports.downloads.cancelActiveBatch()
              else if (entry.localId === 'library-summary')
                return options.ports.library.getSummary()
              else
                throw new ModuleFrameworkError('unknown-build-command', [
                  descriptor.id,
                  entry.localId,
                ])
            },
          })),
      }),
    }
  })
  const controller = new ModuleController({
    builtIns,
    points: WORKBENCH_EXTENSION_POINTS,
    readCommandContext: (): ModuleCommandContext => ({
      runtime: options.runtime,
      form: options.form,
      area: options.ports.navigation.currentView(),
      selectionCount: 0,
      hasTrack: false,
      userGesture: options.ports.interaction.hasUserGesture(),
      objectRevision: options.ports.navigation.revision(),
      viewRevision: options.ports.navigation.revision(),
    }),
    onRequiredFailure: options.onRequiredFailure,
  })
  return {
    controller,
    start: async () => {
      await controller.start()
    },
    dispose: () => controller.dispose(),
  }
}

/** Translate framework diagnostics at the host boundary; persisted errors use the core contract. */
export function toModuleStartupError(error: unknown) {
  return toAppErrorState(
    new AppError('invariant-violation', '系统模块启动失败，请使用恢复入口。', { cause: error }),
  )
}

export function getWorkbenchModuleConfiguration(runtime: WorkbenchRuntime) {
  return {
    ...(runtime.modules ?? {
      runtime: 'userscript' as const,
      form: 'desktop' as const,
      directory: createWorkbenchModuleDirectory('userscript', [], runtime.uiThemes),
    }),
    themes: runtime.uiThemes,
  }
}
