import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { cpus, release, totalmem } from 'node:os'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const normalize = (path) => relative(repository, path).replaceAll('\\', '/')
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')

function files(directory) {
  return readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      if (['node_modules', 'target', 'dist', 'logs', '.git'].includes(entry.name)) return []
      const path = resolve(directory, entry.name)
      return entry.isDirectory() ? files(path) : [path]
    })
    .toSorted()
}

// Hash the dirty workspace inputs as well as HEAD: HEAD alone cannot identify a local build.
const inputPaths = execFileSync(
  'git',
  [
    'ls-files',
    '--cached',
    '--others',
    '--exclude-standard',
    '-z',
    '--',
    'apps',
    'packages',
    'scripts',
    'package.json',
    'pnpm-lock.yaml',
    'pnpm-workspace.yaml',
    'tsconfig.base.json',
  ],
  { cwd: repository, encoding: 'utf8' },
)
  .split('\0')
  .filter(Boolean)
const inputs = [...new Set(inputPaths)]
  .toSorted()
  .filter((path) => !path.includes('/test/'))
  .map((path) => resolve(repository, path))
  .filter(existsSync)
const sourceFiles = inputs.map((path) => ({
  path: normalize(path),
  sha256: sha256(readFileSync(path)),
}))

const builds = ['userscript', 'tauri'].map((runtime) => {
  const directory = resolve(repository, 'apps', runtime, 'dist')
  const artifacts = files(directory).map((path) => {
    const bytes = readFileSync(path)
    return {
      path: normalize(path),
      bytes: bytes.length,
      gzipBytes: gzipSync(bytes, { level: 9 }).length,
      sha256: sha256(bytes),
    }
  })
  // Report executable/style payload separately from assets/audit JSON and total output.
  const payload = artifacts.filter((artifact) => /\.(?:js|css|wasm)$/.test(artifact.path))
  return {
    runtime,
    build: 'production frontend (not native installer)',
    payloadBytes: payload.reduce((sum, artifact) => sum + artifact.bytes, 0),
    payloadGzipBytes: payload.reduce((sum, artifact) => sum + artifact.gzipBytes, 0),
    artifacts,
  }
})

process.stdout.write(
  `${JSON.stringify(
    {
      schemaVersion: 1,
      capturedAt: new Date().toISOString(),
      head: execFileSync('git', ['rev-parse', 'HEAD'], {
        cwd: repository,
        encoding: 'utf8',
      }).trim(),
      environment: {
        node: process.version,
        pnpm: JSON.parse(readFileSync(resolve(repository, 'package.json'), 'utf8')).packageManager,
        platform: process.platform,
        osRelease: release(),
        architecture: process.arch,
        cpu: cpus()[0]?.model,
        logicalCpus: cpus().length,
        memoryBytes: totalmem(),
        gzipLevel: 9,
      },
      sourceDigest: sha256(JSON.stringify(sourceFiles)),
      sourceFiles,
      lockfileSha256: sha256(readFileSync(resolve(repository, 'pnpm-lock.yaml'))),
      builds,
      limits:
        'Artifact sizes and hashes only. Per-file gzip sums are not transferred bundle size. No browser, CSS layout, image decode, native runtime or frame timings.',
    },
    null,
    2,
  )}\n`,
)
