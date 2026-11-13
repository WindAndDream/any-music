import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { resolve } from 'node:path'

import { androidBuildOptions, androidOutput } from './lib/mobile-android.mjs'
import { pnpmInvocation } from './lib/pnpm.mjs'
import { stageReleaseArtifacts } from './lib/release-artifacts.mjs'
import {
  gitOutput,
  readReleaseConfig,
  releaseContext,
  releaseRoot,
  releaseTargets,
} from './lib/release.mjs'

assert.equal(process.argv.length, 3, 'Usage: pnpm release:build <TARGET_ID | --list>')
const targetId = process.argv[2]
const config = readReleaseConfig()
if (targetId === '--list') {
  for (const target of releaseTargets(config))
    console.log(`${target.id}: ${target.extensions.join(', ')}`)
  process.exit(0)
}
const context = releaseContext()
const target = releaseTargets(config, context.androidSigning).find((entry) => entry.id === targetId)
assert(target, 'Unknown release target. Run pnpm release:build --list to see supported targets.')
if (process.env.AM_RELEASE_COMMIT)
  assert.equal(context.sourceDirty, false, 'Release build checkout has uncommitted source changes')
assert(process.env.npm_execpath, 'Run through pnpm release:build from the repository root')
const run = (command, args, env = process.env) =>
  execFileSync(command, args, { cwd: releaseRoot, stdio: 'inherit', env })
const pnpm = (args, env) => {
  const invocation = pnpmInvocation(args)
  run(invocation.command, invocation.args, env)
}
const sources = {}

if (target.kind === 'userscript') {
  pnpm(['build:userscript'])
  sources['user.js'] = resolve(releaseRoot, 'apps/userscript/dist/any-music.user.js')
} else if (target.kind === 'android') {
  const options = [target.target, '--release', ...(target.signing === 'signed' ? ['--signed'] : [])]
  pnpm(['build:mobile:android', ...options])
  Object.assign(sources, androidOutput(androidBuildOptions(options)))
} else {
  const host = execFileSync('rustc', ['-vV'], { cwd: releaseRoot, encoding: 'utf8' })
    .match(/^host: (.+)$/m)?.[1]
    .trim()
  assert.equal(host, target.target, 'Desktop release must run on its declared native runner')
  // All build combinations exclude diagnostic examples/features and preserve the locked graph.
  pnpm(
    [
      '--filter',
      '@any-music/tauri',
      'exec',
      'tauri',
      'build',
      '--target',
      target.target,
      '--bundles',
      target.bundles.join(','),
      '--',
      '--locked',
      '--no-default-features',
    ],
    { ...process.env, ...(target.platform === 'macos' ? { APPLE_SIGNING_IDENTITY: '-' } : {}) },
  )
  for (const [index, bundle] of target.bundles.entries()) {
    const extension = target.extensions[index]
    const folder = resolve(releaseRoot, 'target', target.target, 'release/bundle', bundle)
    const names = readdirSync(folder).filter(
      (name) => name.endsWith(`.${extension}`) && name.includes(`_${context.version}_`),
    )
    assert.equal(names.length, 1, `Expected exactly one ${extension} bundle, found ${names.length}`)
    sources[extension] = resolve(folder, names[0])
  }
}
assert.equal(
  gitOutput(['rev-parse', 'HEAD']),
  context.commit,
  'Release checkout changed during the build',
)
const { output } = stageReleaseArtifacts(target, context, sources)
console.log(`Staged ${target.id}: ${output}`)
