import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { inspectMobileBoundaries } from './check-mobile-boundaries.mjs'
import {
  androidBuildOptions,
  androidOutput,
  androidToolchain,
  root,
  run,
} from './lib/mobile-android.mjs'

/** Verify compiled manifest values, including absent attributes' Android defaults. */
export function checkReleaseManifest(manifest) {
  assert.match(manifest, /A: package="com\.anymusic\.app"/)
  for (const name of ['debuggable', 'testOnly', 'usesCleartextTraffic', 'allowBackup']) {
    const value = manifest.match(
      new RegExp(`A: android:${name}\\([^)]*\\)=\\(type 0x12\\)(0x[0-9a-f]+)`),
    )?.[1]
    assert(
      value === '0x0' || (value === undefined && ['debuggable', 'testOnly'].includes(name)),
      `Release ${name} must be false`,
    )
  }
  assert.match(manifest, /android:minSdkVersion\([^)]*\)=\(type 0x10\)0x1a\b/)
  assert.match(manifest, /android:targetSdkVersion\([^)]*\)=\(type 0x10\)0x25\b/)
  assert(
    !/E: instrumentation\b|S16DocumentProvider|AudioFocusProbe|androidx\.test\./.test(manifest),
    'Test harness entered release manifest',
  )
  const activities = [
    ...manifest.matchAll(/E: activity[^\n]*\n((?:[ \t]*A:[^\n]*(?:\n|$))*)/g),
  ].map((match) => match[1])
  const main = activities.filter((attributes) =>
    attributes.includes('"com.anymusic.app.MainActivity"'),
  )
  const bootstrap = activities.filter((attributes) =>
    attributes.includes('"com.anymusic.app.BootstrapActivity"'),
  )
  assert.equal(main.length, 1, 'Missing unique main Activity')
  assert.equal(bootstrap.length, 1, 'Missing unique bootstrap Activity')
  assert.match(main[0], /android:exported\([^)]*\)=\(type 0x12\)0x0\b/)
  assert.match(bootstrap[0], /android:exported\([^)]*\)=\(type 0x12\)0xffffffff\b/)
}

export function verifyAndroidRelease(target) {
  inspectMobileBoundaries()
  const build = { ...androidBuildOptions([target]), profile: 'release', signed: true }
  const { apk, aab } = androidOutput(build)
  const { java } = androidToolchain()
  const versions = readdirSync(join(process.env.ANDROID_HOME, 'build-tools'))
    .filter((v) => /^\d+\.\d+\.\d+$/.test(v))
    .toSorted((a, b) => a.localeCompare(b, undefined, { numeric: true }))
  assert(versions.length, 'Android build-tools unavailable')
  const version = versions.at(-1)
  const tools = join(process.env.ANDROID_HOME, 'build-tools', version)
  const exe = process.platform === 'win32' ? '.exe' : ''
  assert(existsSync(apk) && existsSync(aab), 'Signed release APK and AAB are required')
  const signature = run(
    java,
    ['-jar', join(tools, 'lib/apksigner.jar'), 'verify', '--verbose', '--print-certs', apk],
    { capture: true },
  )
  const signer = signature
    .match(/Signer #1 certificate SHA-256 digest: ([0-9a-f]{64})/i)?.[1]
    .toLowerCase()
  assert(
    signer && !/CN=Android Debug|Signer #2 certificate/.test(signature),
    'Expected a single non-debug release signer',
  )
  checkReleaseManifest(
    run(join(tools, `aapt${exe}`), ['dump', 'xmltree', apk, 'AndroidManifest.xml'], {
      capture: true,
    }),
  )
  run(join(tools, `zipalign${exe}`), ['-c', '-P', '16', '4', apk], { capture: true })
  const archive = JSON.parse(
    run(
      java,
      [join(root, 'scripts/android/VerifyAndroidRelease.java'), apk, aab, build.abi, signer],
      { capture: true },
    ),
  )
  const artifacts = [apk, aab].map((path) => {
    const bytes = readFileSync(path)
    return {
      path: path.replaceAll('\\', '/').slice(root.replaceAll('\\', '/').length),
      bytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    }
  })
  const report = {
    runtimeScope: 'tauri',
    recordedAtUtc: new Date().toISOString(),
    target,
    buildTools: version,
    signerSha256: signer,
    signed: true,
    debuggable: false,
    backup: false,
    cleartext: false,
    apk16KiBAlignment: true,
    ...archive,
    externalPlugins: 'none',
    executionAdmitted: false,
    storeChannelAccepted: false,
    artifacts,
  }
  const path = join(apk, '../release-verification.json')
  writeFileSync(path, JSON.stringify(report, null, 2) + '\n')
  console.log(`Android release artifacts verified: ${resolve(path)}`)
  return report
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  assert(process.argv.length <= 3, 'Expected aarch64 or x86_64')
  verifyAndroidRelease(process.argv[2] ?? 'aarch64')
}
