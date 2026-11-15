import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { test } from 'node:test'

import { instrumentationCount } from '../accept-mobile-android.mjs'
import { checkReleaseManifest, checkReleaseSigner } from '../check-mobile-release.mjs'
import {
  androidBuildOptions,
  androidOutput,
  prepareAndroidCodegen,
  runPnpm,
} from '../lib/mobile-android.mjs'

test('a migrated Android project recreates its bridge directory and preserves maintained Kotlin', (context) => {
  const directory = mkdtempSync(join(tmpdir(), 'any-music android '))
  context.after(() => rmSync(directory, { recursive: true, force: true }))
  const project = join(directory, 'gen/android')
  const activity = join(project, 'app/src/main/java/org/example/music/MainActivity.kt')
  mkdirSync(join(project, 'app/src/main/java/org/example/music'), { recursive: true })
  writeFileSync(activity, 'maintained activity')
  writeFileSync(join(directory, 'tauri.android.conf.json'), '{"identifier":"org.example.music"}')
  const env = prepareAndroidCodegen(project)
  assert.equal(env.WRY_ANDROID_PACKAGE, 'org.example.music')
  assert.equal(env.WRY_ANDROID_LIBRARY, 'any_music_tauri_lib')
  assert.equal(
    env.WRY_ANDROID_KOTLIN_FILES_OUT_DIR,
    join(project, 'app/src/main/java/org/example/music/generated'),
  )
  assert(existsSync(env.WRY_ANDROID_KOTLIN_FILES_OUT_DIR))
  assert.equal(readFileSync(activity, 'utf8'), 'maintained activity')
})

test('Android frontend builds accept a pnpm Node script with spaces in its path', (context) => {
  const directory = mkdtempSync(join(tmpdir(), 'any-music pnpm '))
  context.after(() => rmSync(directory, { recursive: true, force: true }))
  const entry = join(directory, 'pnpm.cjs')
  writeFileSync(entry, 'console.log(JSON.stringify(process.argv.slice(2)))')
  const args = ['--filter', '@any-music/tauri', 'build:frontend', 'literal & argument']
  assert.deepEqual(JSON.parse(runPnpm(args, { capture: true }, { npm_execpath: entry })), args)
  assert.throws(() => runPnpm([], {}, {}), /Run from the repository root using pnpm/)
})

test(
  'Android frontend builds launch a standalone Windows executable without passing it to Node',
  { skip: process.platform !== 'win32' },
  () => {
    const output = runPnpm(
      ['--eval', 'console.log("standalone entry started")'],
      { capture: true },
      { npm_execpath: process.execPath },
    )
    assert.equal(output.trim(), 'standalone entry started')
  },
)

test('Android signing needs an explicit release and complete credentials before any build', () => {
  const env = {
    AM_ANDROID_KEYSTORE: resolve('private.jks'),
    AM_ANDROID_STORE_PASSWORD: 'secret',
    AM_ANDROID_KEY_PASSWORD: 'secret',
    AM_ANDROID_KEY_ALIAS: 'local-release',
  }
  assert.equal(androidBuildOptions([]).profile, 'debug')
  assert.equal(androidBuildOptions(['x86_64', '--release']).signed, false)
  const release = androidBuildOptions(['aarch64', '--release', '--signed'], env)
  assert.equal(release.signed, true)
  assert.match(androidOutput(release).apk, /app-arm64-release\.apk$/)
  for (const args of [
    ['x86'],
    ['aarch64', '--signed'],
    ['x86_64', '--all-features'],
    ['x86_64', '--release', '--release'],
  ])
    assert.throws(() => androidBuildOptions(args, env))
  for (const key of Object.keys(env)) {
    assert.throws(() =>
      androidBuildOptions(['aarch64', '--release', '--signed'], { ...env, [key]: '' }),
    )
  }
  for (const change of [
    { AM_ANDROID_KEYSTORE: 'relative.jks' },
    { AM_ANDROID_KEY_ALIAS: 'AndroidDebugKey' },
  ])
    assert.throws(() =>
      androidBuildOptions(['aarch64', '--release', '--signed'], { ...env, ...change }),
    )
})

test('release verification requires one non-debug APK signer and its certificate digest', () => {
  const digest = 'AB'.repeat(32)
  const signature = `Number of signers: 1\r\nSigner #1 certificate DN: CN=Fixture\r\nSigner #1 certificate SHA-256 digest: ${digest}\r\n`
  assert.equal(checkReleaseSigner(signature), digest.toLowerCase())
  assert.throws(
    () => checkReleaseSigner(signature.replace('signers: 1', 'signers: 2')),
    /one APK signer/,
  )
  assert.throws(
    () => checkReleaseSigner(signature.replace('certificate SHA-256', 'public key SHA-256')),
    /missing the release certificate/,
  )
  assert.throws(
    () => checkReleaseSigner(signature.replace('CN=Fixture', 'CN=Android Debug')),
    /debug certificate/,
  )
})

const manifest = `A: package="com.anymusic.app"
  A: android:minSdkVersion(0x1)=(type 0x10)0x1a
  A: android:targetSdkVersion(0x2)=(type 0x10)0x25
  E: application
    A: android:allowBackup(0x3)=(type 0x12)0x0
    A: android:usesCleartextTraffic(0x4)=(type 0x12)0x0
    E: activity (line=1)
      A: android:name(0x1)="com.anymusic.app.MainActivity"
      A: android:exported(0x2)=(type 0x12)0x0
    E: activity (line=2)
      A: android:name(0x1)="com.anymusic.app.BootstrapActivity"
      A: android:exported(0x2)=(type 0x12)0xffffffff`
test('release verification rejects compiled debug, backup, cleartext and test-harness variants', () => {
  checkReleaseManifest(manifest)
  for (const extra of ['debuggable', 'testOnly'])
    assert.throws(() =>
      checkReleaseManifest(manifest + `\nA: android:${extra}(0x1)=(type 0x12)0xffffffff`),
    )
  for (const name of ['allowBackup', 'usesCleartextTraffic'])
    assert.throws(() =>
      checkReleaseManifest(
        manifest.replace(
          `${name}(0x${name === 'allowBackup' ? '3' : '4'})=(type 0x12)0x0`,
          `${name}(0x1)=(type 0x12)0xffffffff`,
        ),
      ),
    )
  for (const extra of [
    'E: instrumentation',
    'com.anymusic.app.S16DocumentProvider',
    'com.anymusic.app.AudioFocusProbeActivity',
    'com.anymusic.app.AudioFocusProbeReceiver',
  ])
    assert.throws(() => checkReleaseManifest(manifest + '\n' + extra))
  assert.throws(() => checkReleaseManifest(manifest.replace('0x1a', '0x18')))
  assert.throws(() => checkReleaseManifest(manifest.replace('MainActivity', 'UnprotectedActivity')))
})

test('instrumentation requires completed tests and rejects adb success with failed JUnit', () => {
  assert.equal(instrumentationCount('OK (13 tests)\nINSTRUMENTATION_CODE: -1'), 13)
  for (const output of [
    'Success',
    'OK (0 tests)\nINSTRUMENTATION_CODE: -1',
    'OK (13 tests)',
    'FAILURES!!!\nINSTRUMENTATION_CODE: -1',
    'OK (13 tests)\nINSTRUMENTATION_STATUS_CODE: -2\nINSTRUMENTATION_CODE: -1',
  ])
    assert.throws(() => instrumentationCount(output))
})
