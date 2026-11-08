// Build metadata and local URL preflight never load signatures, HTTP or browser state.
export { DOUYIN_MUSIC_SOURCE_DESCRIPTOR } from './descriptor'
export { createDouyinSearchPageUrl, parseDouyinImportUrl } from './url-parser'
import type { BuiltInSourceTarget } from '@any-music/plugin-center/music-sources'

export const DOUYIN_BUILT_IN_TARGETS: readonly BuiltInSourceTarget[] = Object.freeze([
  'userscript',
  'desktop',
])
import type { ModuleDescriptor, ModuleRuntime } from '@any-music/plugin-center'

/** Package, module, provider and contribution identities are deliberately independent. */
export function createDouyinSourceModule(runtime: ModuleRuntime): ModuleDescriptor {
  return {
    id: 'source.douyin',
    name: '抖音',
    version: 1,
    installationId: `${runtime}:source.douyin:1`,
    contentHash: 'app-build:source.douyin:1',
    required: false,
    provides: [],
    requires: [{ id: 'host.sources', version: 1 }],
    optional: [],
    contributions: [
      {
        localId: 'provider',
        pointId: 'music.sources',
        contractVersion: 1,
        inputSchema: 'music-source-context.v1',
        eventSchema: 'music-source-result.v1',
        implementation: 'declarative',
        implementationId: 'douyin',
        group: 'source',
        order: 0,
      },
    ],
  }
}
