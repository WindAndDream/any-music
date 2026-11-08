// UI 包的稳定组件出口；跨端应用只导入实际使用的组件，避免聚合桌面重型功能。
export { default as AppIcon } from './components/AppIcon.vue'
export { default as CollectionCard } from './components/CollectionCard.vue'
export { default as CollectionGrid } from './components/CollectionGrid.vue'
export { default as CollectionBreadcrumbs } from './components/CollectionBreadcrumbs.vue'
export { useCollectionNavigation } from './composables/use-collection-navigation'
export {
  createBackNavigation,
  provideBackNavigation,
  useBackNavigation,
  useBackHandler,
  useBackNavigationScope,
} from './composables/use-back-navigation'
export type { BackNavigation } from './composables/use-back-navigation'
export { useOverlayKeyboard } from './composables/use-overlay-keyboard'
export { default as AppDialog } from './components/AppDialog.vue'
export { default as AppToast } from './components/AppToast.vue'
export { useToastNotice } from './composables/use-toast-notice'
export {
  provideSettingsFeedback,
  useSettingsFeedback,
  type SettingsActionResult,
} from './composables/use-settings-feedback'
export { default as BottomSheet } from './components/BottomSheet.vue'
export { default as MobileBottomNavigation } from './components/MobileBottomNavigation.vue'
export { default as MusicAppShell } from './components/MusicAppShell.vue'
export { default as NavigationRail } from './components/NavigationRail.vue'
export { default as PanelShell } from './components/PanelShell.vue'
export { default as SidePanel } from './components/SidePanel.vue'
export { default as ConfirmationDialog } from './components/product-workbench/ConfirmationDialog.vue'
export { createAsyncFeatureComponent } from './components/music-sources/async-feature-component'
export {
  filterCatalogDrawers,
  useCatalogDrawerList,
} from './composables/music-sources/use-catalog-drawer-list'
export type { CatalogDrawerListSummary } from './composables/music-sources/use-catalog-drawer-list'
export type {
  CatalogTrackDisplayMode,
  MobileTrackColumns,
} from './components/music-sources/catalog-track-display-mode'
export { default as PrecisionAudioSeekBar } from './components/music-sources/PrecisionAudioSeekBar.vue'
export { default as CompactAudioSeekBar } from './components/music-sources/CompactAudioSeekBar.vue'
export { useMobilePlayerSheet } from './composables/player/use-mobile-player-sheet'
export { default as PlayerControlPager } from './components/music-sources/PlayerControlPager.vue'
export { default as PlaybackModeChoices } from './components/music-sources/PlaybackModeChoices.vue'
export { playbackModeOptions } from './components/music-sources/playback-mode-options'
export type { TrackPlaybackState } from './product/track-playback-state'
export { default as RemoteImage } from './components/music-sources/RemoteImage.vue'
export { provideRemoteImageResolver } from './composables/use-remote-image'
export type { RemoteImageResolver, RemoteImageLease } from './composables/use-remote-image'
export type { ResourceCacheSnapshot } from './product/resource-cache'
export { DEFAULT_MEMORY_CACHE_MIB, MAX_MEMORY_CACHE_MIB } from './product/resource-cache'
export { MIN_RESOURCE_CACHE_MIB, MAX_RESOURCE_CACHE_MIB } from './product/resource-cache'
export { default as SessionBadge } from './components/music-sources/SessionBadge.vue'
export { default as TrackCardSummary } from './components/tracks/TrackCardSummary.vue'
export { provideTrackNames, useTrackName, useTrackNames } from './composables/tracks/use-track-name'
export { default as TrackSourcePageLink } from './components/tracks/TrackSourcePageLink.vue'
export type { AppIconName } from './components/app-icon'
export type { NavigationItem } from './components/navigation'
export {
  calculatePointerPositionMs,
  clampPlaybackPositionMs,
  formatPrecisePlaybackTime,
  seekNativeMedia,
} from './composables/precision-seek'
export {
  cloneCatalogTrackFilterState,
  countCatalogTrackFilters,
  createCatalogTrackFilterState,
  filterCatalogTracks,
  useCatalogTrackFilters,
} from './composables/music-sources/use-catalog-track-filters'
export { useCatalogErrorNotifications } from './composables/music-sources/use-catalog-error-notifications'
export type {
  CatalogTagStat,
  CatalogNamingFilter,
  CatalogPlatformStat,
  CatalogTrackDurationRangeFilter,
  CatalogTrackFilterCounts,
  CatalogTrackFilterState,
  CatalogTrackPublishedRangeFilter,
  CatalogTrackSearchFilter,
} from './composables/music-sources/use-catalog-track-filters'
export {
  createFavoriteFilterState,
  CUSTOM_TRACK_PLATFORM_ID,
  useFavoriteFilters,
} from './composables/library/use-favorite-filters'
export type {
  FavoriteArrangementMode,
  FavoriteFilterState,
  FavoritePlatformDrawer,
  FavoritePlatformOption,
  MusicPlatformOption,
} from './composables/library/use-favorite-filters'
export { getPlaybackHistoryStartedAfterMs } from './composables/library/playback-history-filters'
export { provideCatalogFilterHistory } from './composables/music-sources/use-catalog-filter-history'
export { useCatalogFilterHistory } from './composables/music-sources/use-catalog-filter-history'
export { useFilterDraft } from './composables/filters/use-filter-draft'
export { useElementBlockSize } from './composables/use-element-block-size'
export { useAnimatedScrollToTop } from './composables/use-animated-scroll-to-top'
export type {
  CatalogFilterHistoryDimension,
  CatalogFilterHistoryEntry,
  CatalogFilterHistoryRepository,
} from './composables/music-sources/use-catalog-filter-history'
export type { CatalogFilterHistorySettings } from './composables/music-sources/catalog-filter-history-settings'
export type { PlaybackHistoryTimeRange } from './composables/library/playback-history-filters'
export {
  createConfirmationDialogController,
  provideConfirmationDialog,
  useConfirmAction,
} from './composables/use-confirmation-dialog'
export type {
  ActiveConfirmationRequest,
  ConfirmationDialogController,
  ConfirmationRequest,
  ConfirmationTone,
  ConfirmAction,
} from './composables/use-confirmation-dialog'
export { useAppShell } from './composables/use-app-shell'
export type { AppShellPreferencesRepository, UseAppShellOptions } from './composables/use-app-shell'
export {
  createDefaultAppShellPreferences,
  normalizeAppShellPreferences,
} from './product/app-shell-preferences'
export type { AudioExportFormat } from './product/audio-export-format'
export type {
  CatalogDrawerStatus,
  CatalogDrawerView,
  CatalogRequestKind,
  CatalogTrackListSummary,
} from './product/catalog-drawer'
export type {
  AppShellPreferences,
  AppThemePreference,
  SidebarSide,
} from './product/app-shell-preferences'
export {
  DEFAULT_DESTINATION_IDS,
  getProductDestination,
  PRODUCT_DESTINATIONS,
} from './product/product-navigation'
export type { ProductDestination, ProductViewId } from './product/product-navigation'
export type { SettingsEntry, SettingsGroup, SettingsSectionId } from './product/settings-navigation'
export type { AppShellPreferenceKind } from './product/app-shell-preferences'
export { provideActionFeedback, useActionFeedback } from './composables/use-action-feedback'
export {
  ACTION_FEEDBACK_MESSAGES,
  ALREADY_PLAYING_MESSAGE,
  EXPORT_PREPARING_MESSAGE,
  getActionSuccessMessage,
  getExportSavedMessage,
  getFilterHistorySavedMessage,
} from './product/action-feedback'
export type {
  ActionFeedbackKind,
  ActionFeedbackResult,
  ActionFeedbackTone,
} from './product/action-feedback'
export type {
  ResourceCacheSettingsContext,
  SettingsDetailContext,
} from './product/settings-detail-context'
export type { QueueListSummary } from './composables/music-sources/use-queue-list-controls'
export { UI_THEME_SELECTION } from './product/theme-selection'
export type { UiThemeSelection } from './product/theme-selection'
export { UI_CONTRIBUTIONS, useUiContributionAvailability } from './product/ui-contributions'
export type {
  UiContributionHost,
  UiContributionItem,
  UiContributionPoint,
  UiListContext,
} from './product/ui-contributions'
export { createPluginViewReference } from './product/plugin-view-reference'
export type { PluginViewReference } from './product/plugin-view-reference'

export type {
  TagManagementPorts,
  TagManagementSession,
  TagManagementImplementation,
} from './product/tag-management'

export type * from './product/music-creation'
export type {
  NativePluginSnapshot,
  NativePluginPackagePreview,
} from './product/native-plugin-authority'
export { provideTrackAccountName } from './composables/tracks/use-track-account-name'

export {
  createEditingSession,
  editingStateKey,
  provideEditingSession,
  useEditingSession,
  type EditingSession,
  type EditingStateKey,
} from './composables/use-editing-session'

export { useGlobalSettings } from './composables/use-global-settings'
export type {
  GlobalSettingsProps,
  GlobalSettingsEmits,
  GlobalSettingsSlots,
} from './composables/use-global-settings'
export { useSettingsNavigation } from './composables/use-settings-navigation'
export { useDestinationReorder } from './composables/use-destination-reorder'
export { usePointerGestureGuard } from './composables/use-pointer-gesture-guard'
export { useIntrinsicWrap } from './composables/use-intrinsic-wrap'
export type { SettingsNavigationProps } from './product/settings-navigation'
export { useCatalogFilterHistorySettings } from './composables/music-sources/use-catalog-filter-history-settings'
export type { CatalogFilterHistoryPreferencesDraft } from './composables/music-sources/use-catalog-filter-history-settings'
export { MAX_CATALOG_FILTER_HISTORY_LIMIT } from './composables/music-sources/catalog-filter-history-settings'
export { FILTER_HISTORY_SETTINGS_GROUPS } from './product/filter-history-settings'
export type { FilterHistorySettingsRegion } from './product/filter-history-settings'
export { getCatalogFilterDimensions } from './components/music-sources/catalog-track-filter-presentation'
export type {
  CatalogFilterContext,
  CatalogTrackFilterDimension,
} from './components/music-sources/catalog-track-filter-presentation'
export { usePluginCenterView } from './composables/plugins/use-plugin-center-view'
export * from './product/plugin-center-presentation'
export type {
  PluginCenterFilter,
  PluginCenterDisplay,
} from './composables/plugins/use-plugin-center-view'
export * from './composables/use-collection-display-settings'
export * from './product/track-display-preferences'
