import type { Slots, VNodeChild } from 'vue'

import type { ResourceCacheSettingsContext, SettingsDetailContext } from './settings-detail-context'
import type { UiThemeFeatureMap } from './theme-features'
import {
  assertUiThemeDescriptor,
  UI_THEME_OPTIONAL_VIEWS,
  UI_THEME_REQUIRED_VIEWS,
} from './theme-metadata'
import type {
  UiThemeDescriptor,
  UiThemeForm,
  UiThemeOptionalView,
  UiThemeRequiredView,
  UiThemeViewId,
} from './theme-metadata'

/** Structural Vue contract, independent of any concrete classic component or DOM. */
export type UiThemeComponent<Props, ComponentSlots = Slots> = new () => {
  $props: Props
  $slots: ComponentSlots
}
export type UiThemeViews = {
  readonly [Key in UiThemeRequiredView]: UiThemeComponent<{ feature: UiThemeFeatureMap[Key] }>
} & {
  readonly [Key in UiThemeOptionalView]?: UiThemeComponent<{ feature: UiThemeFeatureMap[Key] }>
}

/** Slots contain trusted host content. Themes may arrange it, never replace its authority. */
export interface UiThemeHostSlots {
  'account-settings'?: (context: SettingsDetailContext) => VNodeChild
  'network-settings'?: () => VNodeChild
  'download-settings'?: () => VNodeChild
  'cache-settings'?: (context: ResourceCacheSettingsContext) => VNodeChild
  'external-source-settings'?: () => VNodeChild
  'source-identity'?: (context: { sourceId: string }) => VNodeChild
  'request-account'?: (context: { drawerId: string }) => VNodeChild
}

export interface UiThemeRootProps {
  readonly features: Readonly<UiThemeFeatureMap>
  readonly views: UiThemeViews
  readonly form: UiThemeForm
}
export interface UiThemeDefinition {
  readonly id: UiThemeDescriptor['id']
  readonly contractVersion: UiThemeDescriptor['contractVersion']
  readonly Root: UiThemeComponent<UiThemeRootProps, UiThemeHostSlots>
  readonly views: UiThemeViews
}

function isComponent(component: unknown): boolean {
  if (typeof component === 'function') return true
  if (typeof component !== 'object' || component === null) return false
  return (
    ('setup' in component && typeof component.setup === 'function') ||
    ('render' in component && typeof component.render === 'function') ||
    ('template' in component && typeof component.template === 'string')
  )
}

/** Validate the loaded batch before resource preparation/commit; never fill missing views. */
export function assertUiThemeDefinition(
  descriptor: UiThemeDescriptor,
  value: unknown,
  form: UiThemeForm,
  requiredOptionalViews: readonly UiThemeOptionalView[] = [],
): asserts value is UiThemeDefinition {
  assertUiThemeDescriptor(descriptor, form)
  const definition = value as Partial<UiThemeDefinition> | null
  if (
    !definition ||
    definition.id !== descriptor.id ||
    definition.contractVersion !== descriptor.contractVersion ||
    !isComponent(definition.Root) ||
    !definition.views ||
    [...UI_THEME_REQUIRED_VIEWS, ...requiredOptionalViews].some(
      (key) => !isComponent(definition.views?.[key]),
    ) ||
    Object.entries(definition.views).some(
      ([key, component]) =>
        ![...UI_THEME_REQUIRED_VIEWS, ...UI_THEME_OPTIONAL_VIEWS].includes(key as UiThemeViewId) ||
        !isComponent(component),
    )
  )
    throw new Error('Incomplete theme definition')
}
