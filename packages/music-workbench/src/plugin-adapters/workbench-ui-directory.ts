import type { ModuleContribution } from '@any-music/plugin-center'
import { THEME_ROOT_POINT } from '@any-music/plugin-ui-vue/directory'

/** Built-in product views belong to explicit modules and register stable owner/local keys. */
export const WORKBENCH_VIEW_OWNERS = {
  catalog: 'system.sources',
  queue: 'system.playback',
  favorites: 'system.library',
  playlists: 'system.library',
  'custom-tracks': 'feature.composer',
  history: 'system.library',
  downloads: 'system.downloads',
  plugins: 'system.plugins',
  tags: 'feature.tags',
  composer: 'feature.composer',
} as const
export function uiContribution(
  localId: string,
  pointId: string,
  implementationId: string,
  order = 0,
): ModuleContribution {
  return {
    localId,
    pointId,
    contractVersion: 1,
    inputSchema: 'workbench-ui-context.v1',
    eventSchema: 'workbench-ui-event.v1',
    implementation: 'host-component',
    implementationId,
    group: 'content',
    order,
  }
}
export function getModuleUiContributions(ownerId: string): ModuleContribution[] {
  if (ownerId.startsWith('theme.'))
    return [uiContribution('root', THEME_ROOT_POINT, `${ownerId}.root`)]
  const views = Object.entries(WORKBENCH_VIEW_OWNERS).filter(([, owner]) => owner === ownerId)
  const result = views.flatMap(([id], index) => [
    uiContribution(`navigation-${id}`, 'navigation.sidebar', id, index),
    uiContribution(`view-${id}`, 'workspace.views', id, index),
  ])
  return result
}
