import type { TagManagementPresentation, MusicCreationPresentation } from '../../src/theme'
import type {
  UiThemeDefinition,
  UiThemeFeatureMap,
  UiThemeHostSlots,
  UiThemeViews,
} from '../../src/theme'
import { railTheme } from '../fixtures/themes/compliant-themes'

/** Compiled by vue-tsc: an unused expect-error fails if the public contract becomes permissive. */
export function checkThemeTypeFailures(features: UiThemeFeatureMap, slots: UiThemeHostSlots) {
  const { settings: _settings, ...incompleteViews } = railTheme.views
  // @ts-expect-error A complete root cannot omit an ordinary required page.
  const missing: UiThemeDefinition = { ...railTheme, views: incompleteViews }
  // @ts-expect-error A feature renderer must accept that feature's typed input.
  const wrongView: UiThemeViews['player'] = railTheme.views.catalog
  // @ts-expect-error Operations retain their domain parameters.
  features.player.actions.seek('1200')
  // @ts-expect-error Stable navigation IDs cannot be invented by a layout.
  features.shell.actions.navigate('arbitrary-route')
  // @ts-expect-error Both snapshot properties and nested tracks are readonly.
  features.catalog.state.tracks[0].title = 'changed by theme'
  // @ts-expect-error Selection belongs to the stable controller.
  features.catalog.state.selectedTrackIds.push('track')
  // @ts-expect-error Theme actions cannot be replaced.
  features.player.actions.pause = () => {}
  // @ts-expect-error Themes receive a bound renderless editor, never its owning editing session.
  features.composer.state.editing.dispose()
  // @ts-expect-error Themes receive projections, not disposal or repository authority.
  features.composer.actions.dispose()
  // @ts-expect-error Host identity slots use a named, typed public context.
  slots['source-identity']?.({ accountCookie: 'secret' })
  // @ts-expect-error Independent recovery stays outside the replaceable tree.
  slots['recovery']?.()
  return { missing, wrongView }
}

export function checkSpecialistTypeFailures(
  tags: TagManagementPresentation,
  creation: MusicCreationPresentation,
) {
  // @ts-expect-error Even nested filter projections are readonly.
  tags.state.filters.searchQuery = 'theme write'
  // @ts-expect-error Unsaved recipes change only through named editor actions.
  creation.state.recipe.push({ sourceTrackId: 'x', startMs: 0, endMs: 1 })
  // @ts-expect-error Session ownership is never passed into a theme.
  creation.actions.dispose()
  // @ts-expect-error Namespace writes remain plugin-owned.
  tags.actions.write({})
}
