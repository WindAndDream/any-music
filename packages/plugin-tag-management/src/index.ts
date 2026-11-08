import type { ModuleContribution, ModuleDescriptor, ModuleRuntime } from '@any-music/plugin-center'

/** Build-known metadata; discovery never loads Vue, state or styles. */
export function createTagManagementModule(runtime: ModuleRuntime): ModuleDescriptor {
  return {
    id: 'feature.tags',
    name: '标签管理',
    version: 1,
    installationId: `${runtime}:feature.tags:1`,
    contentHash: 'app-build:feature.tags:1',
    required: false,
    provides: [],
    requires: [{ id: 'host.library', version: 1 }],
    optional: [],
    contributions: [
      contribution('navigation-tags', 'navigation.sidebar', 'tags'),
      contribution('view-tags', 'workspace.views', 'tags'),
      contribution('manage-tags', 'track.actions.secondary'),
      contribution('tag-details', 'track.details'),
      contribution('tag-filter', 'trackList.filters'),
      contribution('batch-tags', 'trackList.operator.actions'),
      {
        localId: 'open-tags',
        pointId: 'workbench.commands',
        implementationId: 'open-tags',
        contractVersion: 1,
        inputSchema: 'workbench-command-context.v1',
        eventSchema: 'workbench-command-result.v1',
        implementation: 'host-command',
        group: 'feature',
        order: 0,
      },
    ],
  }
}

function contribution(
  localId: string,
  pointId: string,
  implementationId = localId,
): ModuleContribution {
  return {
    localId,
    pointId,
    implementationId,
    contractVersion: 1,
    inputSchema: 'workbench-ui-context.v1',
    eventSchema: 'workbench-ui-event.v1',
    implementation: 'host-component',
    group: 'content',
    order: 0,
  }
}
