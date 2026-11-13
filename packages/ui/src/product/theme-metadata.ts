/** Build metadata only. Importing this module never starts Vue or a business instance. */
export const UI_THEME_CONTRACT_VERSION = 1
export type UiThemeForm = 'desktop' | 'mobile'

export interface UiThemeDescriptor {
  /** Stable build-owned identifier; the application registration supplies admission. */
  readonly id: string
  readonly title: string
  /** Build-owned startup gate, also shown when the user requests this theme. */
  readonly unavailableReason?: string
  readonly contractVersion: typeof UI_THEME_CONTRACT_VERSION
  readonly forms: readonly UiThemeForm[]
  readonly settingsSchemaVersion: 1
}

/** Every complete theme owns these surfaces, including ordinary settings and dialogs. */
export const UI_THEME_REQUIRED_VIEWS = Object.freeze([
  'shell',
  'navigation',
  'player',
  'catalog',
  'queue',
  'favorites',
  'playlists',
  'custom-tracks',
  'history',
  'downloads',
  'plugins',
  'settings',
  'overlays',
] as const)
export const UI_THEME_OPTIONAL_VIEWS = Object.freeze(['tags', 'composer'] as const)
export type UiThemeRequiredView = (typeof UI_THEME_REQUIRED_VIEWS)[number]
export type UiThemeOptionalView = (typeof UI_THEME_OPTIONAL_VIEWS)[number]
export type UiThemeViewId = UiThemeRequiredView | UiThemeOptionalView

export function assertUiThemeDescriptor(
  value: unknown,
  form: UiThemeForm,
): asserts value is UiThemeDescriptor {
  const descriptor = value as Partial<UiThemeDescriptor> | null
  if (
    !descriptor ||
    typeof descriptor.id !== 'string' ||
    descriptor.id === 'host' ||
    !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(descriptor.id) ||
    descriptor.id.length > 64 ||
    typeof descriptor.title !== 'string' ||
    !descriptor.title.trim() ||
    descriptor.contractVersion !== UI_THEME_CONTRACT_VERSION ||
    descriptor.settingsSchemaVersion !== 1 ||
    !Array.isArray(descriptor.forms) ||
    !descriptor.forms.length ||
    new Set(descriptor.forms).size !== descriptor.forms.length ||
    descriptor.forms.some((entry) => entry !== 'desktop' && entry !== 'mobile') ||
    !descriptor.forms.includes(form)
  )
    throw new Error('Incompatible build theme')
}
