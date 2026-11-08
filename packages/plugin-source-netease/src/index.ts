import type { ModuleDescriptor, ModuleRuntime } from '@any-music/plugin-center'
import type { BuiltInSourceTarget } from '@any-music/plugin-center/music-sources'

export { NETEASE_MUSIC_SOURCE_DESCRIPTOR } from './descriptor'
export { parseNeteaseImportUrl } from './url-parser'

/** Mobile account/authentication acceptance remains independent of desktop delivery. */
export const NETEASE_BUILT_IN_TARGETS: readonly BuiltInSourceTarget[] = Object.freeze([
  'userscript',
  'desktop',
])

export function createNeteaseSourceModule(runtime: ModuleRuntime): ModuleDescriptor {
  return {
    id: 'source.netease',
    name: '网易云音乐',
    version: 1,
    installationId: `${runtime}:source.netease:1`,
    contentHash: 'app-build:source.netease:1',
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
        implementationId: 'netease',
        group: 'source',
        order: 2,
      },
    ],
  }
}
