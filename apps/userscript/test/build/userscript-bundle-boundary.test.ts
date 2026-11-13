import { describe, expect, it } from 'vitest'

import { assertUserscriptBundleBoundary } from '../../scripts/userscript-bundle-boundary'

describe('production Userscript graph boundary', () => {
  it.each([
    'packages/plugin-vm/src/index.ts',
    'packages/plugin-testkit/src/index.ts',
    'node_modules/quickjs-emscripten/index.js',
    'packages/plugin-cli/src/index.mjs',
    'apps/tauri/src/platform/native-plugin-authority.ts',
    'apps/tauri/src/plugin-executor/index.ts',
  ])('rejects even lazy rendered external execution/installation code: %s', (id) => {
    expect(() => assertUserscriptBundleBoundary([id], [])).toThrow('external plugin')
  })
  it.each([
    'node_modules/.pnpm/vue@3/node_modules/vue/dist/vue.runtime.esm-bundler.js',
    'packages/ui/src/styles/index.scss',
    'packages/plugin-source-douyin/src/douyin-plugin.ts',
  ])('rejects eagerly loaded product code: %s', (id) => {
    expect(() => assertUserscriptBundleBoundary([], [id])).toThrow('document-start')
  })
  it('admits lazy built-in themes and feature/source implementations', () => {
    expect(() =>
      assertUserscriptBundleBoundary(
        [
          'packages/plugin-source-bilibili/src/bilibili-plugin.ts',
          'packages/plugin-ui-vue/src/trusted/themes/default.ts',
          'packages/plugin-tag-management/src/vue/index.ts',
          'packages/plugin-music-creation/src/vue/index.ts',
          'packages/music-workbench/src/features/plugins/use-native-plugin-authority.ts',
        ],
        ['apps/userscript/src/main.ts', 'packages/plugin-source-douyin/src/runtime-contracts.ts'],
      ),
    ).not.toThrow()
  })
})
