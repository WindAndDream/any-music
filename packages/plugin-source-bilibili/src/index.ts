// Build metadata and local URL preflight never load signatures, HTTP or browser state.
export { BILIBILI_MUSIC_SOURCE_DESCRIPTOR } from './descriptor'
export { parseBilibiliImportUrl } from './url-parser'
import type { BuiltInSourceTarget } from '@any-music/plugin-center/music-sources'

export const BILIBILI_BUILT_IN_TARGETS: readonly BuiltInSourceTarget[] = Object.freeze([
  'userscript',
  'desktop',
  'mobile',
])
import type { ModuleDescriptor, ModuleRuntime } from '@any-music/plugin-center'

/** Package, module, provider and contribution identities are deliberately independent. */
export function createBilibiliSourceModule(runtime: ModuleRuntime): ModuleDescriptor {
  return {
    id: 'source.bilibili',
    name: '哔哩哔哩',
    version: 1,
    installationId: `${runtime}:source.bilibili:1`,
    contentHash: 'app-build:source.bilibili:1',
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
        implementationId: 'bilibili',
        group: 'source',
        order: 0,
      },
    ],
  }
}
