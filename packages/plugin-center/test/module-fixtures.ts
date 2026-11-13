import type {
  BuiltInModule,
  ExtensionPoint,
  ModuleCommandContext,
  ModuleContribution,
  ModuleDescriptor,
} from '../src/index'

export const context: ModuleCommandContext = {
  runtime: 'userscript',
  form: 'desktop',
  area: 'catalog',
  selectionCount: 0,
  hasTrack: false,
  userGesture: true,
  objectRevision: 1,
  viewRevision: 1,
}
export const points: readonly ExtensionPoint[] = [
  {
    id: 'workspace.views',
    version: 1,
    inputSchema: 'view.v1',
    eventSchema: 'view-event.v1',
    cardinality: 'multiple',
    implementations: ['host-component', 'declarative'],
    trust: 'public',
    groups: ['core', 'plugin'],
    maxContributions: 100,
    scopeValues: { areas: ['catalog', 'queue'], listTypes: ['tracks'] },
  },
  {
    id: 'theme.layout',
    version: 1,
    inputSchema: 'layout.v1',
    eventSchema: 'layout-event.v1',
    cardinality: 'single',
    implementations: ['host-component'],
    trust: 'trusted-built-in',
    defaultContributionId: 'default/layout',
    groups: ['core', 'plugin'],
    maxContributions: 1,
  },
  {
    id: 'host.commands',
    version: 1,
    inputSchema: 'command.v1',
    eventSchema: 'result.v1',
    cardinality: 'multiple',
    implementations: ['host-command'],
    trust: 'trusted-built-in',
    groups: ['core', 'plugin'],
    maxContributions: 100,
  },
]
export function contribution(
  localId = 'view',
  patch: Partial<ModuleContribution> = {},
): ModuleContribution {
  return {
    localId,
    pointId: 'workspace.views',
    contractVersion: 1,
    inputSchema: 'view.v1',
    eventSchema: 'view-event.v1',
    implementation: 'host-component',
    implementationId: localId,
    group: 'plugin',
    order: 0,
    ...patch,
  }
}
export function moduleFixture(id: string, patch: Partial<ModuleDescriptor> = {}): BuiltInModule {
  const descriptor: ModuleDescriptor = {
    id,
    name: id,
    version: 1,
    installationId: `${id}-install`,
    contentHash: `${id}-hash`,
    required: false,
    requires: [],
    optional: [],
    provides: [],
    contributions: [contribution()],
    ...patch,
  }
  return {
    descriptor,
    activate: () => ({ contributionIds: descriptor.contributions.map((entry) => entry.localId) }),
  }
}
export function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}
