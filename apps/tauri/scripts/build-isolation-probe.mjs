// Build-only S03 resources. This script never starts Vite, an app or a browser.
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

import { build } from 'vite'

const require = createRequire(import.meta.url)
const outDir = fileURLToPath(new URL('../../../target/s03-probe', import.meta.url))
await Promise.all(
  ['worker', 'launcher', 'network-worker'].map((entry) =>
    build({
      configFile: false,
      publicDir: false,
      plugins: [
        {
          name: 's03-bundled-wasm',
          resolveId(id) {
            if (id === 'virtual:s03-wasm') return '\0s03-wasm'
          },
          load(id) {
            if (id === '\0s03-wasm')
              return `export default ${JSON.stringify(readFileSync(require.resolve('@jitl/quickjs-wasmfile-release-sync/wasm')).toString('base64'))}`
          },
        },
      ],
      build: {
        target: 'es2022',
        outDir,
        emptyOutDir: false,
        minify: true,
        lib: {
          entry: fileURLToPath(new URL(`../src/isolation-probe/${entry}.ts`, import.meta.url)),
          formats: ['es'],
          fileName: () => `${entry}.js`,
        },
        rolldownOptions: { output: { codeSplitting: false } },
      },
    }),
  ),
)
const hash = (data) => createHash('sha256').update(data).digest('hex')
const artifacts = Object.fromEntries(
  ['worker', 'launcher', 'network-worker'].map((name) => {
    const bytes = readFileSync(`${outDir}/${name}.js`)
    return [name, { bytes: bytes.length, sha256: hash(bytes) }]
  }),
)
writeFileSync(
  `${outDir}/engine.json`,
  JSON.stringify(
    {
      purpose: 'S03 fixed probe only; not an accepted production Profile',
      package: '@jitl/quickjs-wasmfile-release-sync',
      version: '0.31.0',
      wasmSha256: hash(readFileSync(require.resolve('@jitl/quickjs-wasmfile-release-sync/wasm'))),
      artifacts,
    },
    null,
    2,
  ) + '\n',
)
