import type { InjectionKey } from 'vue'

/** Host-owned selection; theme renderers can request a build-known complete root. */
export interface UiThemeSelection {
  choices: readonly { id: string; title: string; unavailableReason?: string }[]
  currentId(): string
  select(id: string): void
  error?(): string
}
export const UI_THEME_SELECTION: InjectionKey<UiThemeSelection> = Symbol('ui-theme-selection')
