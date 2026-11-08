import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

import { themeComponentId, themeStyleResources } from '../vite/theme-style-resources.ts'
import { createWorkspace } from './helpers/package-workspace.mjs'

test('third theme styles load as inert values with the same scope ID as their templates', (context) => {
  const workspace = createWorkspace(context)
  workspace.theme('theme-paper')
  const filename = join(workspace.root, 'packages/theme-paper/src/ThemeRoot.vue')
  writeFileSync(
    filename,
    '<template><main /></template><style scoped>.paper { color: red; }</style>',
  )
  // The host collector must never include a theme skin.
  mkdirSync(join(workspace.root, 'apps/tauri/src'), { recursive: true })
  const plugin = themeStyleResources(workspace.root, 'tauri')
  const watched = []
  const host = { addWatchFile: (path) => watched.push(path) }
  const resourceId = plugin.resolveId('virtual:any-music-theme-styles/paper')
  const output = plugin.load.call(host, resourceId)
  assert.match(output, new RegExp(`scoped=${themeComponentId(workspace.root, filename)}&inline`))
  assert.match(output, /export default \[/)
  assert.deepEqual(watched, [filename])
  for (const directory of [
    'ui',
    'card-styles',
    'music-workbench',
    'plugin-ui-vue',
    'plugin-tag-management',
    'plugin-music-creation',
  ])
    mkdirSync(join(workspace.root, `packages/${directory}/src`), { recursive: true })
  const hostOutput = plugin.load.call(host, plugin.resolveId('virtual:any-music-theme-styles/host'))
  assert.doesNotMatch(hostOutput, /theme-paper|paper\.vue/)
  assert.equal(
    plugin
      .transform('import "/paper.vue?vue&type=style&index=0";\nexport default {};', filename)
      .code.trim(),
    'export default {};',
  )
  assert.throws(
    () => plugin.load.call(host, '\0virtual:any-music-theme-styles/unknown'),
    /Unknown build-owned/,
  )
  assert.throws(
    () => plugin.load.call(host, '\0virtual:any-music-theme-styles/toString'),
    /Unknown build-owned/,
  )
})
