import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { pnpmInvocation } from './lib/pnpm.mjs'
import { readReleaseConfig, releaseRoot, releaseTargets } from './lib/release.mjs'

/** Keep the decoded key outside the checkout and remove it even after a failed build. */
export function withAndroidSigning(env, build, root = releaseRoot) {
  for (const name of ['KEYSTORE_BASE64', 'STORE_PASSWORD', 'KEY_ALIAS', 'KEY_PASSWORD'])
    assert(env[`AM_ANDROID_${name}`]?.trim(), `Missing Android signing secret: ${name}`)
  assert(env.RUNNER_TEMP && isAbsolute(env.RUNNER_TEMP), 'An absolute RUNNER_TEMP is required')
  const location = relative(resolve(root), resolve(env.RUNNER_TEMP))
  assert(
    location === '..' ||
      location.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) ||
      isAbsolute(location),
    'Signing keys must stay outside the source checkout',
  )
  assert.notEqual(
    env.AM_ANDROID_KEY_ALIAS.toLowerCase(),
    'androiddebugkey',
    'Use a release key alias',
  )
  const encoded = env.AM_ANDROID_KEYSTORE_BASE64.replace(/\s/g, '')
  assert(
    encoded.length <= 49152 && /^[A-Za-z0-9+/]+={0,2}$/.test(encoded),
    'Invalid signing keystore encoding',
  )
  const bytes = Buffer.from(encoded, 'base64')
  assert(
    bytes.length > 0 && bytes.toString('base64') === encoded,
    'Invalid signing keystore encoding',
  )
  mkdirSync(env.RUNNER_TEMP, { recursive: true })
  const directory = mkdtempSync(join(env.RUNNER_TEMP, 'any-music-signing-'))
  try {
    const keystore = join(directory, 'release.jks')
    writeFileSync(keystore, bytes, { mode: 0o600, flag: 'wx' })
    const signingEnv = { ...env, AM_ANDROID_KEYSTORE: keystore }
    delete signingEnv.AM_ANDROID_KEYSTORE_BASE64
    return build(signingEnv)
  } finally {
    bytes.fill(0)
    rmSync(directory, { recursive: true, force: true })
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  assert.equal(process.argv.length, 3, 'Usage: pnpm release:build:android-signed TARGET_ID')
  assert.equal(process.env.AM_RELEASE_ANDROID_SIGNING, 'signed', 'Signed release mode is required')
  const target = releaseTargets(readReleaseConfig(), 'signed').find(
    (entry) => entry.id === process.argv[2],
  )
  assert.equal(target?.kind, 'android', 'Expected an Android distribution target')
  withAndroidSigning(process.env, (env) => {
    const invocation = pnpmInvocation(['release:build', target.id])
    execFileSync(invocation.command, invocation.args, { cwd: releaseRoot, stdio: 'inherit', env })
  })
}
