import { freezeModuleData } from '@any-music/plugin-center'
import type {
  ExtensionPoint,
  ModuleDescriptor,
  ModuleRuntime,
  ModuleContribution,
} from '@any-music/plugin-center'
import { THEME_ROOT_POINT, BUILT_IN_UI_THEMES } from '@any-music/plugin-ui-vue/directory'
import type { UiThemeDescriptor } from '@any-music/ui/theme'

import { getModuleUiContributions } from './workbench-ui-directory'

/** Build-known modules declare lifecycle and contribution ownership. */
export const WORKBENCH_EXTENSION_POINTS: readonly ExtensionPoint[] = freezeModuleData([
  {
    id: 'music.sources',
    version: 1,
    inputSchema: 'music-source-context.v1',
    eventSchema: 'music-source-result.v1',
    cardinality: 'multiple',
    implementations: ['declarative'],
    trust: 'trusted-built-in',
    groups: ['source'],
    maxContributions: 32,
  },
  {
    id: THEME_ROOT_POINT,
    version: 1,
    inputSchema: 'workbench-ui-context.v1',
    eventSchema: 'workbench-ui-event.v1',
    cardinality: 'single',
    implementations: ['host-component'],
    trust: 'trusted-built-in',
    groups: ['content'],
    maxContributions: 1,
    defaultContributionId: 'theme.default/root',
  },
  ...[
    'navigation.sidebar',
    'workspace.views',
    'track.actions.secondary',
    'track.details',
    'trackList.operator.actions',
    'trackList.filters',
  ].map((id): ExtensionPoint => ({
    id,
    version: 1,
    inputSchema: 'workbench-ui-context.v1',
    eventSchema: 'workbench-ui-event.v1',
    cardinality: 'multiple',
    implementations: ['host-component'],
    trust: 'trusted-built-in',
    groups: ['content'],
    maxContributions: 64,
  })),
  {
    id: 'workbench.commands',
    version: 1,
    inputSchema: 'workbench-command-context.v1',
    eventSchema: 'workbench-command-result.v1',
    cardinality: 'multiple',
    implementations: ['host-command'],
    trust: 'trusted-built-in',
    groups: ['core', 'feature'],
    maxContributions: 32,
    scopeValues: {
      areas: [
        'catalog',
        'queue',
        'favorites',
        'playlists',
        'custom-tracks',
        'history',
        'downloads',
        'plugins',
        'tags',
        'composer',
      ],
      listTypes: [],
    },
  },
])

function command(localId: string, group: string, area?: string): ModuleContribution {
  return {
    localId,
    pointId: 'workbench.commands',
    contractVersion: 1,
    inputSchema: 'workbench-command-context.v1',
    eventSchema: 'workbench-command-result.v1',
    implementation: 'host-command',
    implementationId: localId,
    group,
    order: 0,
    ...(area ? { scope: { areas: [area] } } : {}),
  }
}

/** Optional host feature; enabling it never grants native installation or network authority. */
export function createExternalSourcesModule(runtime: ModuleRuntime): ModuleDescriptor {
  return freezeModuleData({
    id: 'feature.external-sources',
    name: '外置音乐源',
    version: 1,
    installationId: `${runtime}:feature.external-sources:1`,
    contentHash: 'app-build:feature.external-sources:1',
    required: false,
    provides: [],
    requires: [
      { id: 'host.sources', version: 1 },
      { id: 'host.plugins', version: 1 },
    ],
    optional: [],
    contributions: [],
  })
}

/** Called by each application's build directory. Contains no Vue, source loader or credentials. */
export function createWorkbenchModuleDirectory(
  runtime: ModuleRuntime,
  features: readonly ModuleDescriptor[] = [],
  themes: readonly UiThemeDescriptor[] = BUILT_IN_UI_THEMES,
): readonly ModuleDescriptor[] {
  function module(
    id: string,
    required: boolean,
    provides: string[],
    commands: ModuleContribution[],
    requires: string[] = [],
  ): ModuleDescriptor {
    return {
      id,
      name: id,
      version: 1,
      installationId: `${runtime}:${id}:1`,
      contentHash: `app-build:${id}:1`,
      required,
      provides: provides.map((serviceId) => ({ id: serviceId, version: 1 })),
      requires: requires.map((serviceId) => ({ id: serviceId, version: 1 })),
      optional: [],
      contributions: [...commands, ...getModuleUiContributions(id)],
    }
  }
  return freezeModuleData([
    module(
      'system.library',
      true,
      ['host.library'],
      [
        command('open-favorites', 'core'),
        command('open-playlists', 'core'),
        command('open-history', 'core'),
        command('library-summary', 'core'),
      ],
    ),
    module(
      'system.playback',
      true,
      ['host.playback'],
      [command('open-queue', 'core'), command('stop-playback', 'core')],
      ['host.library'],
    ),
    module(
      'system.downloads',
      true,
      ['host.downloads'],
      [command('open-downloads', 'core'), command('cancel-downloads', 'core')],
      ['host.library'],
    ),
    module('system.sources', true, ['host.sources'], [command('open-catalog', 'core')]),
    module('system.plugins', true, ['host.plugins'], [command('open-plugins', 'core')]),
    ...features,
    ...themes.map(({ id, unavailableReason }) => ({
      ...module(`theme.${id}`, id === 'default', [], []),
      ...(unavailableReason ? { unavailableReason } : {}),
    })),
  ])
}
