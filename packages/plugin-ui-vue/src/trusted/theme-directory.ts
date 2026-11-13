import type { UiThemeDescriptor } from '@any-music/ui/theme'

/** Metadata only: safe for application build discovery before Vue or product styles load. */
export const BUILT_IN_UI_THEMES: readonly UiThemeDescriptor[] = Object.freeze([
  Object.freeze({
    id: 'default',
    title: '经典',
    contractVersion: 1,
    forms: ['desktop', 'mobile'] as const,
    settingsSchemaVersion: 1,
  }),
  Object.freeze({
    id: 'studio',
    title: '工作室',
    contractVersion: 1,
    forms: ['desktop', 'mobile'] as const,
    settingsSchemaVersion: 1,
  }),
])
/** Complete-theme admission is atomic; no row/list/navigation substitutions. */
export const THEME_ROOT_POINT = 'theme.root'
export interface ThemeSettings {
  schemaVersion: 1
  density: 'standard' | 'compact'
}
/** Invalid settings are isolated from appearance, navigation and all business repositories. */
export function normalizeThemeSettings(input: unknown): ThemeSettings {
  const value = input as Partial<ThemeSettings> | null
  return {
    schemaVersion: 1,
    density: value?.schemaVersion === 1 && value.density === 'compact' ? 'compact' : 'standard',
  }
}
