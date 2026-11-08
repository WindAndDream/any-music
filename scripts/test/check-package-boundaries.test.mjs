import assert from 'node:assert/strict'
import { test } from 'node:test'

import { createWorkspace } from './helpers/package-workspace.mjs'

test('accepts valid sources and deferred/type-only heavy imports', (context) => {
  const workspace = createWorkspace(context)
  workspace.write(
    'packages/audio-composition/src/index.ts',
    "import type { Input } from 'mediabunny'; export const load = () => import('mediabunny')",
  )
  assert.deepEqual(workspace.check(), [])
})

test('VM profiles and adapter roots stay engine-free; native imports and production testkit are rejected', (context) => {
  const workspace = createWorkspace(context)
  workspace.write(
    'packages/plugin-vm/src/profile.ts',
    "import '@jitl/quickjs-wasmfile-release-sync'",
  )
  workspace.write('packages/plugin-vm/src/index.ts', "import 'node:fs'; import '@any-music/core'")
  workspace.write('apps/tauri/src/main.ts', "import '@any-music/plugin-testkit'")
  const errors = workspace.check()
  assert.ok(errors.some((error) => error.includes('profile.ts eagerly loads @jitl/')))
  assert.ok(errors.some((error) => error.includes('inject native runtime capabilities')))
  assert.ok(errors.some((error) => error.includes('disallowed internal import @any-music/core')))
  assert.ok(errors.some((error) => error.includes('production applications cannot import testkit')))
})

test('trusted build directory discovery cannot eagerly load Vue through the workbench root', (context) => {
  const workspace = createWorkspace(context)
  workspace.write('packages/music-workbench/src/index.ts', "export * from './build-directory'")
  workspace.write(
    'packages/music-workbench/src/build-directory.ts',
    "import { ref } from 'vue'; export const value = ref(1)",
  )
  assert.ok(
    workspace
      .check()
      .some((error) => error.includes('music-workbench/src/index.ts eagerly loads vue')),
  )
})

test('theme metadata stays lightweight and Vue adapters cannot import private workbench state', (context) => {
  const workspace = createWorkspace(context)
  workspace.write(
    'packages/plugin-ui-vue/src/trusted/theme-directory.ts',
    "import { ref } from 'vue'; export const state = ref(1)",
  )
  workspace.write(
    'packages/plugin-ui-vue/src/index.ts',
    "import '@any-music/music-workbench/features/private-store'; import 'node:fs'",
  )
  const errors = workspace.check()
  assert.ok(errors.some((error) => error.includes('theme-directory.ts eagerly loads vue')))
  assert.ok(
    errors.some((error) => error.includes('disallowed internal import @any-music/music-workbench')),
  )
  assert.ok(errors.some((error) => error.includes('inject native runtime capabilities')))
})

test('rejects undeclared and forbidden internal dependencies', (context) => {
  const workspace = createWorkspace(context)
  workspace.write('packages/ui/src/index.ts', "export { item } from '@any-music/core'")
  workspace.manifest('audio-composition', { dependencies: { '@any-music/core': 'workspace:*' } })
  const errors = workspace.check()
  assert.ok(errors.some((error) => error.includes('undeclared dependency')))
  assert.ok(errors.some((error) => error.includes('disallowed dependency')))
})

test('tag metadata remains lightweight and the feature cannot consume host repositories', (context) => {
  const workspace = createWorkspace(context)
  workspace.write('packages/plugin-tag-management/src/index.ts', "export * from './hidden'")
  workspace.write(
    'packages/plugin-tag-management/src/hidden.ts',
    "import 'vue'; import '@any-music/music-workbench/features/private-store'",
  )
  const errors = workspace.check()
  assert.ok(
    errors.some((error) => error.includes('plugin-tag-management/src/index.ts eagerly loads vue')),
  )
  assert.ok(
    errors.some((error) => error.includes('disallowed internal import @any-music/music-workbench')),
  )
})

test('rejects app aliases and relative paths outside the package', (context) => {
  const workspace = createWorkspace(context)
  workspace.write(
    'packages/core/src/index.ts',
    "import app from '@/platform/http'; export * from '../../../apps/runtime'",
  )
  const errors = workspace.check()
  assert.ok(errors.some((error) => error.includes('application runtime import')))
  assert.ok(errors.some((error) => error.includes('relative import escapes package')))
})

test('creation metadata cannot load presentation or access private host state', (context) => {
  const workspace = createWorkspace(context)
  workspace.write('packages/plugin-music-creation/src/index.ts', "export * from './hidden'")
  workspace.write(
    'packages/plugin-music-creation/src/hidden.ts',
    "import './editor.scss'; import 'vue'; import '@any-music/music-workbench/features/private-store'",
  )
  const errors = workspace.check()
  assert.ok(
    errors.some((error) => error.includes('plugin-music-creation/src/index.ts eagerly loads vue')),
  )
  assert.ok(errors.some((error) => error.includes('eagerly loads presentation')))
  assert.ok(
    errors.some((error) => error.includes('disallowed internal import @any-music/music-workbench')),
  )
})

test('routing packages reject Node and music dependencies while accepting their public edge', (context) => {
  const workspace = createWorkspace(context)
  workspace.manifest('account-pool', {
    dependencies: { '@any-music/network-routing': 'workspace:*' },
  })
  workspace.write(
    'packages/account-pool/src/index.ts',
    "export { item } from '@any-music/network-routing'",
  )
  assert.deepEqual(workspace.check(), [])
  workspace.write(
    'packages/network-routing/src/index.ts',
    "import { readFile } from 'node:fs'; export * from '@any-music/core'",
  )
  const errors = workspace.check()
  assert.ok(errors.some((error) => error.includes('portable routing imports Node')))
  assert.ok(errors.some((error) => error.includes('disallowed internal import @any-music/core')))
})

test('follows the source plugin root barrel to eager codecs', (context) => {
  const workspace = createWorkspace(context)
  workspace.write('packages/plugin-source-bilibili/src/index.ts', "export * from './hidden'")
  workspace.write('packages/plugin-source-bilibili/src/hidden.ts', "import 'mediabunny'")
  assert.ok(workspace.check().some((error) => error.includes('eagerly loads mediabunny')))
})

test('SDK rejects runtime libraries, even through a local barrel', (context) => {
  const workspace = createWorkspace(context)
  workspace.write('packages/plugin-sdk/src/index.ts', "export * from './hidden'")
  workspace.write('packages/plugin-sdk/src/hidden.ts', "import 'ajv'; import '@any-music/core'")
  const errors = workspace.check()
  assert.ok(errors.some((error) => error.includes('eagerly loads ajv')))
  assert.ok(errors.some((error) => error.includes('disallowed internal import @any-music/core')))
  assert.ok(errors.some((error) => error.includes('SDK production imports must be local')))
})

test('rejects browser audio implementations without a codec import', (context) => {
  const workspace = createWorkspace(context)
  workspace.write('packages/audio-composition/src/index.ts', "export * from './browser/engine'")
  workspace.write('packages/audio-composition/src/browser/engine.ts', 'export {}')
  assert.ok(
    workspace.check().some((error) => error.includes('eagerly loads a browser implementation')),
  )
})

test('accepts export patterns and rejects private exports', (context) => {
  const workspace = createWorkspace(context)
  workspace.manifest('core', {
    exports: { '.': './src/index.ts', './tools/*': './src/tools/*.ts', './tools/private': null },
  })
  workspace.manifest('ui', { dependencies: { '@any-music/core': 'workspace:*' } })
  workspace.write('packages/ui/src/index.ts', "import '@any-music/core/tools/visible'")
  assert.deepEqual(workspace.check(), [])
  workspace.write('packages/ui/src/index.ts', "import '@any-music/core/tools/private'")
  assert.ok(workspace.check().some((error) => error.includes('private or unknown export')))
})

test('source metadata cannot load protocols and source plugins cannot access the host', (context) => {
  const workspace = createWorkspace(context)
  workspace.write('packages/plugin-source-bilibili/src/index.ts', "export * from './bilibili-api'")
  workspace.write(
    'packages/plugin-source-bilibili/src/bilibili-api.ts',
    "import '@any-music/music-workbench'; import '@tauri-apps/api/core'",
  )
  const errors = workspace.check()
  assert.ok(errors.some((error) => error.includes('eagerly loads source implementation')))
  assert.ok(
    errors.some((error) => error.includes('disallowed internal import @any-music/music-workbench')),
  )
  assert.ok(errors.some((error) => error.includes('inject native runtime capabilities')))
})

test('independent themes accept only public metadata, Vue and style entries without eager presentation', (context) => {
  const workspace = createWorkspace(context)
  workspace.theme()
  workspace.theme('theme-studio')
  workspace.theme('theme-default', {
    dependencies: { '@any-music/ui': 'workspace:*', '@any-music/core': 'workspace:*' },
  })
  workspace.write(
    'packages/theme-default/src/index.ts',
    "import type { Track } from '@any-music/core'; import type { UiThemeDescriptor } from '@any-music/ui/theme'; export const descriptor = { id: 'default' }",
  )
  workspace.write(
    'apps/userscript/src/themes.ts',
    "import { descriptor } from '@any-music/theme-default'; export const load = () => import('@any-music/theme-studio/vue'); export const styles = () => import('@any-music/theme-studio/styles?inline')",
  )
  assert.deepEqual(workspace.check(), [])
  workspace.write('packages/theme-default/src/index.ts', "export * from './vue'")
  assert.ok(workspace.check().some((error) => error.includes('eagerly loads presentation')))
  workspace.write('packages/theme-default/src/index.ts', "const started = import('./vue')")
  assert.ok(workspace.check().some((error) => error.includes('eagerly loads presentation')))
})

test('theme dependency fixtures reject cross-theme, host, native, SDK, private and cyclic edges', (context) => {
  const workspace = createWorkspace(context)
  workspace.theme()
  workspace.theme('theme-studio')
  for (const specifier of [
    '@any-music/theme-studio/vue',
    '@any-music/music-workbench',
    '@any-music/plugin-sdk',
    '@any-music/core',
    '@any-music/plugin-tag-management/vue',
    '@tauri-apps/api/core',
    'node:fs',
    'electron',
    '@/platform/http',
    '../../../apps/tauri/src/private',
    '@any-music/ui/src/private',
  ]) {
    workspace.write('packages/theme-default/src/vue.ts', `import '${specifier}'`)
    assert.ok(workspace.check().length > 0, specifier)
  }
  workspace.theme('theme-default', { dependencies: { '@any-music/theme-studio': 'workspace:*' } })
  workspace.theme('theme-studio', { dependencies: { '@any-music/theme-default': 'workspace:*' } })
  assert.ok(workspace.check().some((error) => error.includes('package dependency cycle')))
})

test('theme metadata follows local barrels; private exports and cross-theme Sass cannot escape checks', (context) => {
  const workspace = createWorkspace(context)
  workspace.theme()
  workspace.theme('theme-studio')
  workspace.write('packages/theme-default/src/index.ts', "export * from './metadata'")
  workspace.write(
    'packages/theme-default/src/metadata.ts',
    "import { ref } from 'vue'; import '@any-music/core'; import './styles/index.scss'",
  )
  const errors = workspace.check()
  assert.ok(errors.some((error) => error.includes('eagerly loads vue')))
  assert.ok(errors.some((error) => error.includes('eagerly loads business or presentation')))
  workspace.write(
    'packages/theme-studio/src/styles/index.scss',
    "@use '@any-music/theme-default/styles';",
  )
  assert.ok(
    workspace
      .check()
      .some((error) =>
        error.includes('disallowed internal import @any-music/theme-default/styles'),
      ),
  )
  workspace.write('apps/tauri/src/themes.ts', "import '@any-music/theme-default/src/ThemeRoot.vue'")
  assert.ok(workspace.check().some((error) => error.includes('private or unknown theme export')))
  workspace.theme('theme-default', { exports: { '.': './src/index.ts', './private/*': './src/*' } })
  assert.ok(workspace.check().some((error) => error.includes('themes expose only metadata')))
})

test('third themes inherit metadata, dependency, selector and runtime boundaries', (context) => {
  const workspace = createWorkspace(context)
  workspace.theme()
  workspace.theme('theme-paper')
  workspace.write(
    'apps/tauri/src/themes.ts',
    "import { descriptor } from '@any-music/theme-paper'; export const load = () => import('@any-music/theme-paper/vue')",
  )
  assert.deepEqual(workspace.check(), [])
  workspace.write('packages/theme-paper/src/index.ts', "export * from './vue'")
  assert.ok(workspace.check().some((error) => error.includes('eagerly loads presentation')))
  workspace.write('packages/theme-paper/src/index.ts', 'export const descriptor = {}')
  workspace.write('packages/theme-paper/src/vue.ts', "import 'node:fs'")
  assert.ok(workspace.check().some((error) => error.includes('inject native runtime capabilities')))
  workspace.write('packages/theme-paper/src/vue.ts', "import '@any-music/theme-default/vue'")
  assert.ok(workspace.check().some((error) => error.includes('disallowed internal import')))
  workspace.write('packages/theme-paper/src/vue.ts', 'export {}')
  workspace.write('packages/theme-paper/src/styles/index.scss', '.am-theme-default .track {}')
  assert.ok(workspace.check().some((error) => error.includes('cross-theme style selector')))
})

test('neutral UI rejects hidden theme skins and retired dispatch imports', (context) => {
  const workspace = createWorkspace(context)
  workspace.write('packages/ui/src/styles/index.scss', '.track__actions { display: grid; }')
  assert.ok(workspace.check().some((error) => error.includes('neutral UI styles')))
  workspace.write('packages/ui/src/styles/index.scss', '.neutral-control { display: grid; }')
  workspace.manifest('ui', { exports: { '.': './src/index.ts', './theme': './src/theme.ts' } })
  workspace.write(
    'packages/ui/src/index.ts',
    "import '@any-music/ui/components/music-sources/TrackRow.vue'",
  )
  assert.ok(workspace.check().some((error) => error.includes('retired partial theme import')))
})
