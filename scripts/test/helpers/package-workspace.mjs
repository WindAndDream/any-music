import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, relative, resolve } from 'node:path'

import {
  checkPackageBoundaries,
  checkThemePackageBoundaries,
} from '../../check-package-boundaries.mjs'

/** Shared isolated fixture for package, plugin and mobile theme dependency checks. */
export function createWorkspace(context) {
  const parent = resolve(tmpdir())
  const root = mkdtempSync(resolve(parent, 'any-music-boundary-'))
  function write(path, content) {
    const target = resolve(root, path)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, content)
  }
  function manifest(name, options = {}) {
    write(
      `packages/${name}/package.json`,
      JSON.stringify({
        name: `@any-music/${name}`,
        exports: { '.': './src/index.ts' },
        ...options,
      }),
    )
  }
  for (const name of [
    'audio-composition',
    'core',
    'ui',
    'card-styles',
    'plugin-source-bilibili',
    'plugin-source-douyin',
    'plugin-source-netease',
    'plugin-center',
    'plugin-sdk',
    'plugin-vm',
    'plugin-sandbox-browser',
    'plugin-testkit',
    'plugin-cli',
    'plugin-ui-vue',
    'plugin-tag-management',
    'plugin-music-creation',
    'network-routing',
    'account-pool',
    'music-workbench',
  ]) {
    manifest(name)
    write(`packages/${name}/src/index.ts`, 'export {}')
  }
  for (const file of [
    'plugin-sdk/src/music.ts',
    'plugin-sdk/src/schema/index.ts',
    'plugin-ui-vue/src/trusted/theme-directory.ts',
    'plugin-vm/src/profile.ts',
    'plugin-vm/src/control.ts',
    'ui/src/theme.ts',
  ])
    write(`packages/${file}`, 'export {}')
  manifest('ui', {
    exports: {
      '.': './src/index.ts',
      './theme': './src/theme.ts',
      './styles': './src/styles/index.scss',
    },
  })
  function theme(name = 'theme-default', options = {}) {
    manifest(name, {
      exports: {
        '.': './src/index.ts',
        './vue': './src/vue.ts',
        './styles': './src/styles/index.scss',
      },
      dependencies: { '@any-music/ui': 'workspace:*' },
      ...options,
    })
    write(
      `packages/${name}/src/index.ts`,
      "import type { UiThemeDescriptor } from '@any-music/ui/theme'; export const descriptor = { id: 'default' }",
    )
    write(`packages/${name}/src/vue.ts`, "export { default as Root } from './ThemeRoot.vue'")
    write(
      `packages/${name}/src/ThemeRoot.vue`,
      '<script setup lang="ts">import { computed } from "vue"</script><template><main /></template>',
    )
    write(`packages/${name}/src/styles/index.scss`, '.theme-root { display: grid; }')
  }
  context.after(() => {
    assert.equal(relative(parent, root), basename(root))
    assert.ok(basename(root).startsWith('any-music-boundary-'))
    rmSync(root, { recursive: true, force: true })
  })
  return {
    root,
    write,
    manifest,
    theme,
    check: () => checkPackageBoundaries(root),
    checkThemes: () => checkThemePackageBoundaries(root),
  }
}
