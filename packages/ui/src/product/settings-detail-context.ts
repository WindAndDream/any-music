/** Runtime settings reuse the product overlay host and suspend the parent modal while editing. */
export interface SettingsDetailContext {
  isMobileLayout: boolean
  overlayTarget?: HTMLElement | null
  suspended?: boolean
  detailOpenChange(open: boolean): void
}

/** Cache help and content keep their host-owned surfaces within the theme's layout. */
export interface ResourceCacheSettingsContext extends SettingsDetailContext {
  placement: 'header' | 'content'
}
