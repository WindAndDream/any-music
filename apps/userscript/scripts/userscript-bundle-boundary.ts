import { relative } from 'node:path'
import { fileURLToPath } from 'node:url'

import type { Plugin } from 'vite'

const WORKSPACE_ROOT = fileURLToPath(new URL('../../..', import.meta.url))
const EXTERNAL_RUNTIME =
  /(?:plugin-(?:vm|sandbox|testkit|cli)|quickjs|apps\/tauri\/src\/(?:platform\/native-plugin-authority|plugin-executor\/))/i
const EAGER_PRESENTATION =
  /(?:node_modules\/.*(?:\/vue\/|\/@vue\/|\/pinia\/)|\.(?:vue|s?css)$|packages\/plugin-source-(?:bilibili|douyin)\/src\/(?:runtime|.*-api|.*-plugin|a-bogus|sm3|wbi-signature|track-mappers)\.ts)/

/** Check rendered output, including lazy chunks. Parsing a tree-shaken barrel is not inclusion. */
export function assertUserscriptBundleBoundary(
  rendered: readonly string[],
  eager: readonly string[],
): void {
  const external = rendered.find((id) => EXTERNAL_RUNTIME.test(id))
  if (external) throw new Error(`Userscript includes external plugin runtime: ${external}`)
  const premature = eager.find((id) => EAGER_PRESENTATION.test(id))
  if (premature)
    throw new Error(`Userscript document-start eagerly loads product code: ${premature}`)
}

/** Runs on the actual production graph before monkey inlines the lazy SystemJS modules. */
export function userscriptBundleBoundary(): Plugin {
  return {
    name: 'any-music-userscript-bundle-boundary',
    apply: 'build',
    enforce: 'pre',
    generateBundle(_options, bundle) {
      const normalize = (id: string) =>
        relative(WORKSPACE_ROOT, id.split('?')[0]!).replaceAll('\\', '/')
      const rendered = [
        ...new Set(
          Object.values(bundle).flatMap((chunk) =>
            chunk.type === 'chunk'
              ? Object.entries(chunk.modules)
                  .filter(([, module]) => module.renderedLength > 0)
                  .map(([id]) => normalize(id))
              : [],
          ),
        ),
      ].toSorted()
      const entry = [...this.getModuleIds()].find(
        (id) => normalize(id) === 'apps/userscript/src/main.ts',
      )
      if (!entry) throw new Error('Missing Userscript document-start entry in build graph')
      const visited = new Set<string>()
      const visit = (id: string) => {
        if (visited.has(id)) return
        visited.add(id)
        for (const dependency of this.getModuleInfo(id)?.importedIds ?? []) visit(dependency)
      }
      visit(entry)
      const eager = [...visited].map(normalize).toSorted()
      assertUserscriptBundleBoundary(rendered, eager)
      this.emitFile({
        type: 'asset',
        fileName: 'userscript-build-audit.json',
        source: JSON.stringify(
          { schemaVersion: 1, externalPlugins: 'none', rendered, eager },
          null,
          2,
        ),
      })
    },
  }
}
