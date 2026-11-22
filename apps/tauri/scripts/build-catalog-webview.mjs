import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'

import vue from '@vitejs/plugin-vue'
import { build } from 'vite'

import {
  themeComponentId,
  themeStyleResources,
} from '../../../scripts/vite/theme-style-resources.ts'

const root = fileURLToPath(new URL('../../../', import.meta.url))
const app = resolve(root, 'apps/tauri')
const file = resolve(process.argv[2], 'catalog-webview.js')
const result = await build({
  configFile: false,
  envDir: false,
  root: app,
  publicDir: false,
  logLevel: 'silent',
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  plugins: [
    vue({
      features: {
        componentIdGenerator: (name) => themeComponentId(root, name, 'tauri'),
      },
    }),
    themeStyleResources(root, 'tauri'),
  ],
  build: {
    write: false,
    target: 'es2022',
    minify: true,
    lib: {
      entry: resolve(app, 'src/catalog-webview/entry.ts'),
      name: 'AnyMusicCatalogBundle',
      formats: ['iife'],
    },
    rolldownOptions: { output: { codeSplitting: false } },
  },
})
const output = (Array.isArray(result) ? result[0] : result).output
if (output.length !== 1 || output[0].type !== 'chunk')
  throw new Error('The catalog WebView requires one self-contained compiled script')
// Evaluate the compiled script with browser globals and no Node runtime. An
// account-page main world must be rejected before the bundle creates a surface.
const window = { __TAURI_INTERNALS__: {} }
window.top = window
let installed
try {
  installed = runInNewContext(
    output[0].code +
      '\nAnyMusicCatalogBundle.install("https://example.test", "fixture", "private")',
    {
      window,
      location: { origin: 'https://example.test' },
      document: { createElement: () => ({}), body: {} },
      URL,
      setTimeout,
      clearTimeout,
    },
    { timeout: 2000 },
  )
} catch (error) {
  throw new Error(`Catalog renderer must run with browser globals only: ${error.message}`)
}
if (installed !== false) throw new Error('Catalog renderer did not reject the website main world')
if (!existsSync(file) || readFileSync(file, 'utf8') !== output[0].code)
  writeFileSync(file, output[0].code)
