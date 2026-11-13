import { createHash } from 'node:crypto'
// Fixed trusted resource build; it never consumes plugin project configuration or code.
import { readFileSync, mkdirSync, writeFileSync, existsSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { build } from 'vite'
const root = fileURLToPath(new URL('../../../', import.meta.url)),
  require = createRequire(import.meta.url)
const out = resolve(root, 'target/s15-executor')
mkdirSync(out, { recursive: true })
const write = (name, bytes) => {
  const path = resolve(out, name)
  if (!existsSync(path) || !readFileSync(path).equals(Buffer.from(bytes)))
    writeFileSync(path, bytes)
}
const result = await build({
  configFile: false,
  envDir: false,
  root: resolve(root, 'apps/tauri'),
  publicDir: false,
  logLevel: 'silent',
  build: {
    write: false,
    target: 'es2022',
    minify: true,
    lib: { entry: resolve(root, 'apps/tauri/src/plugin-executor/launcher.ts'), formats: ['es'] },
    rolldownOptions: { output: { codeSplitting: false } },
  },
})
write('launcher.js', (Array.isArray(result) ? result[0] : result).output[0].code)
const worker = await build({
  configFile: false,
  envDir: false,
  root: resolve(root, 'packages/plugin-sandbox-browser'),
  publicDir: false,
  logLevel: 'silent',
  plugins: [
    {
      name: 'fixed-engine',
      resolveId(id) {
        if (id === 'virtual:am-vm-wasm') return '\0wasm'
      },
      load(id) {
        if (id === '\0wasm')
          return `export default ${JSON.stringify(readFileSync(require.resolve('@any-music/plugin-vm/engine.wasm')).toString('base64'))}`
      },
    },
  ],
  build: {
    write: false,
    target: 'es2022',
    minify: true,
    lib: { entry: resolve(root, 'packages/plugin-sandbox-browser/src/worker.ts'), formats: ['es'] },
    rolldownOptions: { output: { codeSplitting: false } },
  },
})
write('worker.js', (Array.isArray(worker) ? worker[0] : worker).output[0].code)
// Target admission also covers the broker/persistence/protocol authority and dependency lock.
// Standalone acceptance observers are excluded; product/runtime source changes invalidate it.
function sources(directory) {
  return readdirSync(resolve(root, directory), { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? sources(directory + '/' + entry.name)
      : entry.name.endsWith('.rs')
        ? [directory + '/' + entry.name]
        : [],
  )
}
const hostSources = [
  ...sources('apps/tauri/src-tauri/src/plugins'),
  ...sources('crates/am-plugin-runtime/src'),
  ...sources('crates/am-plugin-net/src'),
  ...sources('crates/am-plugin-package/src'),
  ...sources('crates/am-plugin-policy/src'),
  ...sources('crates/am-plugin-protocol/src'),
  'apps/tauri/src-tauri/src/plugins.rs',
  'apps/tauri/src-tauri/src/lib.rs',
  'apps/tauri/src-tauri/src/storage/plugins.rs',
  'apps/tauri/src-tauri/src/ipc.rs',
  'apps/tauri/src-tauri/permissions/product.toml',
  'apps/tauri/src-tauri/capabilities/main.json',
  'apps/tauri/src-tauri/tauri.conf.json',
  'Cargo.lock',
].toSorted()
const hostHash = createHash('sha256')
  .update(
    JSON.stringify(
      hostSources.map((path) => [
        path,
        createHash('sha256')
          .update(readFileSync(resolve(root, path)))
          .digest('hex'),
      ]),
    ),
  )
  .digest('hex')
write(
  'resources.json',
  JSON.stringify({
    ...Object.fromEntries(
      ['launcher.js', 'worker.js'].map((name) => [
        name,
        createHash('sha256')
          .update(readFileSync(resolve(out, name)))
          .digest('hex'),
      ]),
    ),
    nativeHost: hostHash,
  }),
)
