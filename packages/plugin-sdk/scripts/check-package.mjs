import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
  readdirSync,
} from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { basename, dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)
const packageDirectory = resolve(root, '../../.codex-tmp/s01/package')
mkdirSync(packageDirectory, { recursive: true })
const pnpm = process.env.npm_execpath
if (!pnpm) throw new Error('Run this check with pnpm')
execFileSync(process.execPath, [pnpm, 'pack', '--pack-destination', packageDirectory], {
  cwd: root,
  stdio: 'pipe',
})
const tarball = resolve(packageDirectory, 'any-music-plugin-sdk-0.1.0.tgz')
const parent = resolve(tmpdir()),
  consumer = mkdtempSync(resolve(parent, 'any-music-sdk-s01-'))
try {
  writeFileSync(
    resolve(consumer, 'package.json'),
    JSON.stringify({
      private: true,
      type: 'module',
      dependencies: { '@any-music/plugin-sdk': `file:${tarball.replaceAll('\\', '/')}` },
    }),
  )
  execFileSync(process.execPath, [pnpm, 'install', '--ignore-scripts', '--offline'], {
    cwd: consumer,
    stdio: 'pipe',
  })
  writeFileSync(
    resolve(consumer, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: {
        strict: true,
        noEmit: true,
        module: 'NodeNext',
        moduleResolution: 'NodeNext',
        lib: ['ES2023'],
        types: [],
      },
      include: ['consumer.ts'],
    }),
  )
  writeFileSync(
    resolve(consumer, 'consumer.ts'),
    `import type { HostPort, PluginManifest, ExecutorPort } from '@any-music/plugin-sdk'
import type { MusicSourceProvider, WireTrack } from '@any-music/plugin-sdk/music'
import { decodeProtocolJson } from '@any-music/plugin-sdk/schema'
const manifest: PluginManifest = decodeProtocolJson('PluginManifest', '{}')
export type Contracts = [HostPort, ExecutorPort, MusicSourceProvider, WireTrack, typeof manifest]
`,
  )
  execFileSync(process.execPath, [require.resolve('typescript/bin/tsc'), '-p', 'tsconfig.json'], {
    cwd: consumer,
    stdio: 'pipe',
  })
  const installed = resolve(consumer, 'node_modules/@any-music/plugin-sdk')
  writeFileSync(
    resolve(consumer, 'light.mjs'),
    `import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
const seen=[]
registerHooks({resolve(specifier,context,next){seen.push(specifier);return next(specifier,context)}})
await import('@any-music/plugin-sdk')
await import('@any-music/plugin-sdk/music')
assert.ok(!seen.some(value=>/ajv|vue|quickjs|schema\\/index|validators/.test(value)))
console.log('Lightweight installed entries load metadata only.')
`,
  )
  execFileSync(process.execPath, ['--disallow-code-generation-from-strings', 'light.mjs'], {
    cwd: consumer,
    stdio: 'inherit',
  })
  copyFileSync(resolve(root, 'test/fixtures/sdk-only-host.ts'), resolve(consumer, 'host.ts'))
  // Compile only the independent fixture and shipped author example, using installed exports.
  copyFileSync(resolve(installed, 'examples/public-page.ts'), resolve(consumer, 'public-page.ts'))
  writeFileSync(
    resolve(consumer, 'tsconfig.emit.json'),
    JSON.stringify({
      compilerOptions: {
        module: 'NodeNext',
        moduleResolution: 'NodeNext',
        target: 'ES2023',
        lib: ['ES2023'],
        types: [],
        strict: true,
        skipLibCheck: true,
        outDir: 'out',
      },
      include: ['host.ts', 'public-page.ts'],
    }),
  )
  execFileSync(
    process.execPath,
    [require.resolve('typescript/bin/tsc'), '-p', 'tsconfig.emit.json'],
    { cwd: consumer, stdio: 'inherit' },
  )
  writeFileSync(
    resolve(consumer, 'check.mjs'),
    `import assert from 'node:assert/strict'
import { negotiatePluginContract } from '@any-music/plugin-sdk'
import { decodeProtocolJson } from '@any-music/plugin-sdk/schema'
import { createSdkOnlyHost } from './out/host.js'
import { readPublicTrackPage } from './out/public-page.js'
const host=createSdkOnlyHost('{"items":[],"pageNumber":1,"pageSize":1,"hasMore":false}')
assert.equal((await readPublicTrackPage(host.host,'https://example.com/page')).items.length,0)
assert.equal(host.released(),1)
assert.equal(typeof negotiatePluginContract,'function')
assert.throws(()=>decodeProtocolJson('MusicListingInput','{"listingRef":"a","listingRef":"b"}'))
console.log('Installed ESM/type exports and SDK-only host passed with dynamic code generation disabled.')
`,
  )
  const output = execFileSync(
    process.execPath,
    ['--disallow-code-generation-from-strings', 'check.mjs'],
    { cwd: consumer, encoding: 'utf8' },
  )
  const files = readdirSync(resolve(installed, 'dist/generated'))
  assert.ok(files.includes('validators.js'))
  const bytes = readFileSync(tarball)
  console.log(output.trim())
  console.log(
    JSON.stringify({
      tarball,
      bytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    }),
  )
} finally {
  // Check the exact resolved temporary path before recursive removal on Windows.
  assert.equal(relative(parent, consumer), basename(consumer))
  assert.ok(basename(consumer).startsWith('any-music-sdk-s01-'))
  rmSync(consumer, { recursive: true, force: true })
}
