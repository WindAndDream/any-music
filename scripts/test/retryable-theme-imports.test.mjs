import assert from 'node:assert/strict'
import { join } from 'node:path'
import { test } from 'node:test'

import { retryableThemeImports } from '../vite/retryable-theme-imports.ts'
import { createWorkspace } from './helpers/package-workspace.mjs'

const chunk = (fileName, module, code = '') => ({
  type: 'chunk',
  fileName,
  modules: { [module]: {} },
  code,
})

test('retries only build-owned optional theme entries and retains successful module identities', async (context) => {
  const { root } = createWorkspace(context)
  const bundle = {
    main: chunk(
      'assets/main.js',
      join(root, 'apps/tauri/src/main.ts'),
      `import('./paper.js');import('./styles.js');import('./default.js');import('./source.js')`,
    ),
    theme: chunk('assets/paper.js', join(root, 'packages/theme-paper/src/vue.ts')),
    styles: chunk('assets/styles.js', '\0virtual:any-music-theme-styles/paper'),
    classic: chunk('assets/default.js', join(root, 'packages/theme-default/src/vue.ts')),
    source: chunk('assets/source.js', join(root, 'packages/plugin-source-bilibili/src/runtime.ts')),
  }
  bundle.main.code = retryableThemeImports(root).renderChunk(
    bundle.main.code,
    bundle.main,
    {},
    { chunks: bundle },
  ).code
  assert.match(bundle.main.code, /__amImportTheme\(new URL\("\.\/paper.js"/)
  assert.match(bundle.main.code, /__amImportTheme\(new URL\("\.\/styles.js"/)
  assert.match(bundle.main.code, /import\('\.\/default.js'\)/)
  assert.match(bundle.main.code, /import\('\.\/source.js'\)/)
  const helper = bundle.main.code.split('\n')[0]
  let attempts = 0
  const urls = []
  const load = Function(
    'load',
    helper.replace('import(url+', 'load(url+') + ';return __amImportTheme',
  )(async (url) => {
    urls.push(url)
    if (++attempts === 1) throw new Error('temporary unavailable')
    return { definition: 'paper' }
  })
  const url = 'https://tauri.localhost/assets/paper.js'
  const first = load(url)
  assert.equal(load(url), first)
  await assert.rejects(first, /temporary unavailable/)
  const retried = load(url)
  assert.deepEqual(await retried, { definition: 'paper' })
  assert.equal(load(url), retried)
  assert.equal(urls.length, 2)
  assert.notEqual(urls[0], urls[1])
})
