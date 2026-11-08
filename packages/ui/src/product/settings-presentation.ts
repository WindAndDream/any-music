import type {
  AppShellPreferenceKind,
  AppThemePreference,
  SidebarSide,
} from './app-shell-preferences'
import type { ProductDestination } from './product-navigation'
import type { UiThemeSelection } from './theme-selection'

/** Controlled ordinary settings. No account models, storage or runtime authority. */
export interface AppShellPreferencesProps {
  destinations: readonly ProductDestination[]
  hiddenDestinationIds: readonly ProductDestination['id'][]
  sidebarSide: SidebarSide
  theme: AppThemePreference
  isMobileNavigationEnabled: boolean
  isMobileLayout?: boolean
  section?: 'appearance' | 'navigation'
  themeSelection?: UiThemeSelection
}
export interface AppShellPreferencesEmits {
  openPreferenceSelection: [setting: AppShellPreferenceKind]
  setMobileNavigationEnabled: [isEnabled: boolean]
  setDestinationVisible: [id: ProductDestination['id'], isVisible: boolean]
  moveDestination: [id: ProductDestination['id'], offset: -1 | 1]
}
export interface AppShellPreferenceDialogProps {
  setting: AppShellPreferenceKind | null
  sidebarSide: SidebarSide
  theme: AppThemePreference
  suspended?: boolean
  themeSelection?: UiThemeSelection
}
export interface AppShellPreferenceDialogEmits {
  close: []
  setSidebarSide: [side: SidebarSide]
  setTheme: [theme: AppThemePreference]
}
