import type { UiThemeDescriptor } from '@any-music/ui/theme'

/** Build-only metadata; loading the directory never starts a renderer or business session. */
export const descriptor: UiThemeDescriptor = {
  id: 'studio',
  title: '工作室',
  unavailableReason: '工作室主题正在开发中，暂时无法使用，敬请期待。',
  contractVersion: 1,
  settingsSchemaVersion: 1,
  forms: ['desktop', 'mobile'],
}
