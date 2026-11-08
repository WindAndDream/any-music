import type { AppIconName } from '../components/app-icon'

/** 稳定设置标识只表达产品目的地，不携带存储键或运行端能力。 */
export type SettingsSectionId =
  | 'appearance'
  | 'navigation'
  | 'display'
  | 'sources'
  | 'external-sources'
  | 'accounts'
  | 'proxy'
  | 'downloads'
  | 'cache'
  | 'playback-history'
  | 'filter-history'
  | 'creator-profile'

export interface SettingsEntry {
  id: SettingsSectionId
  title: string
  description: string
  icon: AppIconName
  summary?: string
}

export interface SettingsGroup {
  id: string
  title: string
  entries: readonly SettingsEntry[]
}

export interface SettingsNavigationProps {
  groups: readonly SettingsGroup[]
  isMobileLayout: boolean
  initialSection?: SettingsSectionId | null
}
