// Offline resource build only. Native launch/admission is deliberately absent in S11.
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

import { build } from 'vite'
const require = createRequire(import.meta.url)
await build({
  configFile: false,
  publicDir: false,
  plugins: [
    {
      name: 'bundled-vm-engine',
      resolveId(id) {
        if (id === 'virtual:am-vm-wasm') return '\0am-vm-wasm'
      },
      load(id) {
        if (id === '\0am-vm-wasm')
          return `export default ${JSON.stringify(readFileSync(require.resolve('@any-music/plugin-vm/engine.wasm')).toString('base64'))}`
      },
    },
  ],
  build: {
    target: 'es2022',
    outDir: 'dist',
    minify: true,
    lib: {
      entry: fileURLToPath(new URL('../src/worker.ts', import.meta.url)),
      formats: ['es'],
      fileName: () => 'worker.js',
    },
    rolldownOptions: { output: { codeSplitting: false } },
  },
})
const bytes = readFileSync('dist/worker.js')
writeFileSync(
  'dist/resources.json',
  JSON.stringify(
    {
      worker: { bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') },
      workerCsp:
        "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'none'; worker-src 'none'",
      productionAdmission: false,
      requires: 'Native isolated resource serving and accepted target; S12+ authority',
    },
    null,
    2,
  ) + '\n',
)
