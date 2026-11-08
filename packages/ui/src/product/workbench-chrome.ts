import type { MediaQuality, PlaybackMode, Track } from '@any-music/core'
import type { DeepReadonly } from 'vue'

import type { NavigationItem } from '../components/navigation'
import type { AppThemePreference, SidebarSide } from './app-shell-preferences'
import type { ProductDestination, ProductViewId } from './product-navigation'

/** Controlled shell/player widget contracts; no controller or media ownership. */
export interface UiWorkbenchShellProps {
  activeDestination: ProductDestination
  activeDescription: string
  navigationItems: readonly NavigationItem[]
  mobileNavigationItems: readonly NavigationItem[]
  activeMobileNavigationId: string
  preferenceDestinations: readonly ProductDestination[]
  hiddenDestinationIds: readonly ProductViewId[]
  sidebarSide: SidebarSide
  sidebarCollapsed: boolean
  mobileDrawerOpen: boolean
  mobileNavigationEnabled: boolean
  mobileLayout: boolean
  preferencesOpen: boolean
  theme: AppThemePreference
  resolvedTheme: 'light' | 'dark'
  modalOpen?: boolean
  playerModalOpen?: boolean
  hasPlayer?: boolean
  productHidden?: boolean
  canHideProduct?: boolean
  presentation?: 'overlay' | 'embedded'
  brandTitle?: string
  brandDescription?: string
}
export interface UiWorkbenchShellEmits {
  selectNavigation: [id: string]
  selectMobileNavigation: [id: string]
  closeMobileDrawer: []
  toggleMobileDrawer: []
  openGlobalSettings: []
  openPreferences: []
  closePreferences: []
  toggleSidebarCollapsed: []
  setSidebarSide: [side: SidebarSide]
  setTheme: [theme: AppThemePreference]
  setMobileNavigationEnabled: [isEnabled: boolean]
  setDestinationVisible: [id: ProductViewId, isVisible: boolean]
  moveDestination: [id: ProductViewId, offset: -1 | 1]
  hideProduct: []
  showProduct: []
}
export interface UiPlayerState {
  readonly positionMs: number
  readonly durationMs: number | undefined
  readonly bufferedUntilMs: number
  readonly playing: boolean
  readonly seekDisabled: boolean
  readonly playbackRate: number
  readonly volume: number
  readonly qualityOptions: readonly Readonly<MediaQuality>[]
  readonly selectedQualityId: string | undefined
  readonly status: 'idle' | 'resolving' | 'ready' | 'error'
  readonly statusLabel: string
}
export interface UiPlayerProps {
  state: UiPlayerState
  track?: DeepReadonly<Track>
  downloadBusy: boolean
  mobileOverlayTarget?: HTMLElement | null
  mode: PlaybackMode
  canDownload?: boolean
}
export interface UiPlayerEmits {
  download: [track: Track]
  next: []
  previous: []
  play: []
  pause: []
  seek: [positionMs: number]
  seekBy: [seconds: number]
  selectQuality: [qualityId: string]
  setPlaybackRate: [rate: number]
  setVolume: [volume: number]
  mobileExpandedChange: [isExpanded: boolean]
  settingsOpenChange: [isOpen: boolean]
  updateMode: [mode: PlaybackMode]
}
