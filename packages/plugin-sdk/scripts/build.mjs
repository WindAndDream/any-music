import { execFileSync } from 'node:child_process'
import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
execFileSync(process.execPath, ['scripts/generate.mjs', '--check'], { stdio: 'inherit' })
execFileSync(
  process.execPath,
  [require.resolve('typescript/bin/tsc'), '-p', 'tsconfig.build.json'],
  { stdio: 'inherit' },
)
mkdirSync('dist/generated', { recursive: true })
cpSync('src/generated/validators.js', 'dist/generated/validators.js')
cpSync('src/generated/validators.d.ts', 'dist/generated/validators.d.ts')
mkdirSync('dist/node', { recursive: true })
writeFileSync(
  'dist/node/package-format.mjs',
  readFileSync('src/node/package-format.mjs', 'utf8').replace(
    '../schema/index.ts',
    '../schema/index.js',
  ),
)
