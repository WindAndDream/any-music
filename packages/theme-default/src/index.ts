import type { UiThemeDescriptor } from '@any-music/ui/theme'

/** Build metadata stays independent of Vue, styles and the running workbench. */
export const descriptor: UiThemeDescriptor = {
  id: 'default',
  title: '经典',
  contractVersion: 1,
  settingsSchemaVersion: 1,
  forms: ['desktop', 'mobile'],
}
