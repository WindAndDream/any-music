import type { ModuleDescriptor, ModuleRuntime } from '@any-music/plugin-center'

/** Build metadata alone is safe to discover before Vue, editing state or styles load. */
export function createMusicCreationModule(runtime: ModuleRuntime): ModuleDescriptor {
  return {
    id: 'feature.composer',
    name: '片段创作',
    developmentStatus: 'developing',
    unavailableReason: '片段创作正在开发中，暂时无法启用，敬请期待。',
    version: 1,
    installationId: `${runtime}:feature.composer:1`,
    contentHash: 'app-build:feature.composer:1',
    required: false,
    provides: [],
    requires: [{ id: 'host.library', version: 1 }],
    optional: [],
    contributions: [
      ...[
        ['navigation-custom-tracks', 'navigation.sidebar', 'custom-tracks'],
        ['view-custom-tracks', 'workspace.views', 'custom-tracks'],
        ['navigation-composer', 'navigation.sidebar', 'composer'],
        ['view-composer', 'workspace.views', 'composer'],
        ['compose', 'track.actions.secondary', 'compose'],
      ].map(([localId, pointId, implementationId]) => ({
        localId: localId!,
        pointId: pointId!,
        implementationId: implementationId!,
        contractVersion: 1,
        inputSchema: 'workbench-ui-context.v1',
        eventSchema: 'workbench-ui-event.v1',
        implementation: 'host-component' as const,
        group: 'content',
        order: 0,
      })),
      ...['open-works', 'open-composer'].map((localId) => ({
        localId,
        pointId: 'workbench.commands',
        implementationId: localId,
        contractVersion: 1,
        inputSchema: 'workbench-command-context.v1',
        eventSchema: 'workbench-command-result.v1',
        implementation: 'host-command' as const,
        group: 'feature',
        order: 0,
      })),
    ],
  }
}
