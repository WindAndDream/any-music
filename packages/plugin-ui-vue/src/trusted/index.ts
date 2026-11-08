export { createThemeController } from './theme-controller'
export { default as ThemeHost } from './ThemeHost.vue'
export { default as ThemeHostSurface } from './ThemeHostSurface.vue'
export { createThemeResources } from './theme-resources'
export { BUILT_IN_UI_THEMES, normalizeThemeSettings } from './theme-directory'
export type { ThemeSettings } from './theme-directory'
export type {
  LoadedRootTheme,
  ThemeRegistration,
  ThemeApplicationComposition,
} from './theme-contracts'
export type {
  ThemeResources,
  ThemeResource,
  ThemeSnapshot,
  ThemeAllocation,
} from './theme-contracts'
export { default as WorkspaceViewOutlet } from './WorkspaceViewOutlet.vue'
