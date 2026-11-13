import type { UiThemeDefinition, UiThemeDescriptor } from '@any-music/ui/theme'

import type { ThemeSettings } from './theme-directory'

/** Build-owned content only; no loader is decoded from data. */
export interface LoadedRootTheme {
  readonly definition: UiThemeDefinition
  readonly css: string
  activate?(defer: (dispose: () => void) => void): void
}
export interface ThemeRegistration {
  readonly descriptor: UiThemeDescriptor
  readonly load: () => Promise<LoadedRootTheme>
}
export interface ThemeApplicationComposition {
  readonly themes: readonly ThemeRegistration[]
  /** Build-known fallback can be preloaded without restarting any business session. */
  readonly fallback: {
    readonly descriptor: UiThemeDescriptor
    readonly loaded: LoadedRootTheme
  }
}

export interface ThemeSnapshot {
  generation: number
  theme: LoadedRootTheme
  settings: ThemeSettings
  allocation?: ThemeAllocation
}
export interface ThemeAllocation {
  registryRevision: number
  lifecycleGeneration: number
  slots: Readonly<Record<string, readonly string[]>>
}
export interface ThemeResources {
  /** Preparation is inert. Only the committed resource may affect the active root. */
  prepare(id: string, css: string): ThemeResource
  capture(signal?: AbortSignal): () => void | Promise<void>
  afterRender(restore: () => void): void
}
export interface ThemeResource {
  activate(): void
  deactivate(): void
  dispose(): void
}
