import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

import { instrumentationCount } from './accept-mobile-android.mjs'
import { verifyAndroidRelease } from './check-mobile-release.mjs'
import {
  androidBuildOptions,
  androidOutput,
  androidProject,
  gradle,
  prepareAndroidTestFixture,
  root,
  run,
} from './lib/mobile-android.mjs'

// Explicit physical-device inspection. Native tests use the same adapter sources
// in an independent debug host/UID; the installed optimized release is untouched.
// R8 release instrumentation can lose test-runner-only AndroidX dependencies.
const args = process.argv.slice(2)
assert(
  (args.length === 2 || (args.length === 3 && args[2] === '--prepared')) &&
    args[0] === '--serial' &&
    /^[a-z\d._:-]+$/i.test(args[1]),
  'Pass --serial DEVICE [--prepared] (an explicitly authorized physical arm64 device)',
)
const serial = args[1]
assert(!serial.startsWith('emulator-'), 'Use accept:mobile:android for emulators')
const adbPath = join(
  process.env.ANDROID_HOME,
  `platform-tools/adb${process.platform === 'win32' ? '.exe' : ''}`,
)
const adb = (arguments_) =>
  run(adbPath, ['-s', serial, ...arguments_], { capture: true, timeout: 120_000 })
assert.notEqual(adb(['shell', 'getprop', 'ro.kernel.qemu']).trim(), '1', 'Physical device required')
assert.equal(adb(['shell', 'getprop', 'ro.product.cpu.abi']).trim(), 'arm64-v8a')
const testHost = 'com.anymusic.adaptertest'
const testPackage = `${testHost}.test`
assert(
  !adb(['shell', 'pm', 'list', 'packages', testHost]).trim(),
  'An existing isolated adapter test host must be removed explicitly first',
)
const build = { ...androidBuildOptions(['aarch64', '--release']), signed: true }
const release = verifyAndroidRelease('aarch64')
const { apk } = androidOutput(build)
const deviceId = createHash('sha256').update(serial).digest('hex').slice(0, 16)
const output = join(root, '.codex-tmp/s16-accept', `physical-${deviceId}`)
mkdirSync(output, { recursive: true })
const installed = adb(['shell', 'pm', 'path', 'com.anymusic.app']).trim()
assert.match(
  installed,
  /^package:[^\r\n]+\/base\.apk$/,
  'Expected an installed, unsplit local release',
)
const pulled = join(output, 'installed-release.apk')
adb(['pull', installed.slice('package:'.length), pulled])
const sha256 = (path) => createHash('sha256').update(readFileSync(path)).digest('hex')
assert.equal(
  sha256(pulled),
  sha256(apk),
  'Installed app must exactly match the verified release; never replace it here',
)
const hostApk = join(androidProject, 'app/build/outputs/apk/arm64/debug/app-arm64-debug.apk')
const testApk = join(
  androidProject,
  'app/build/outputs/apk/androidTest/arm64/debug/app-arm64-debug-androidTest.apk',
)
// Recreate generated APKs: incremental ZIP writers can retain removed JNI bytes
// outside the central directory when switching from product to adapter-only mode.
const prepared = args[2] === '--prepared'
if (!prepared) {
  rmSync(hostApk, { force: true })
  rmSync(testApk, { force: true })
  prepareAndroidTestFixture()
  gradle(
    [
      ':app:assembleArm64Debug',
      ':app:assembleArm64DebugAndroidTest',
      '-x',
      ':app:rustBuildArm64Debug',
    ],
    { env: { ...process.env, AM_ANDROID_SIGNED_BUILD: '0', AM_ANDROID_ADAPTER_TEST: '1' } },
  )
}
const buildTools = readdirSync(join(process.env.ANDROID_HOME, 'build-tools'))
  .filter((v) => /^\d+\.\d+\.\d+$/.test(v))
  .toSorted((a, b) => a.localeCompare(b, undefined, { numeric: true }))
const aapt = join(
  process.env.ANDROID_HOME,
  'build-tools',
  buildTools.at(-1),
  `aapt${process.platform === 'win32' ? '.exe' : ''}`,
)
for (const [path, expected] of [
  [hostApk, testHost],
  [testApk, testPackage],
]) {
  const manifest = run(aapt, ['dump', 'badging', path], { capture: true })
  assert.equal(
    manifest.match(/^package: name='([^']+)'/m)?.[1],
    expected,
    'Unexpected test APK identity; refusing installation',
  )
  if (path === hostApk) {
    assert(
      !/uses-permission: name='android.permission.INTERNET'|launchable-activity:|native-code:/.test(
        manifest,
      ),
      'Adapter host must have no network, launcher or native runtime',
    )
  }
}
const report = {
  runtimeScope: 'tauri',
  startedAtUtc: new Date().toISOString(),
  deviceIdSha256Prefix: deviceId,
  passed: false,
  physicalDevice: true,
  releaseApkSha256: sha256(apk),
  signerSha256: release.signerSha256,
  externalPlugins: 'none',
  executionAdmitted: false,
  channelAccepted: false,
  adapterTestsIsolatedFromProduct: true,
  preparedArtifacts: prepared,
  releaseInstrumentation: false,
  forcedActivityRecreationAccepted: false,
  workbenchIpcChecked: false,
}
let hostInstalled = false
let testInstalled = false
try {
  adb(['install', hostApk])
  hostInstalled = true
  adb(['install', '-t', testApk])
  testInstalled = true
  const testPackageState = adb(['shell', 'dumpsys', 'package', testPackage])
  writeFileSync(join(output, 'test-package.txt'), testPackageState)
  report.fixtureProviderStoppedBeforeProbe = /User 0:[^\n]*stopped=true/.test(testPackageState)
  writeFileSync(join(output, 'host-package.txt'), adb(['shell', 'dumpsys', 'package', testHost]))
  // A freshly installed fixture APK may still be stopped by the device's package
  // manager. Initialize only this test-owned provider, never a product provider.
  const fixtureProbe = adb([
    'shell',
    'content',
    'query',
    '--uri',
    `content://${testPackage}.documents/small`,
  ])
  writeFileSync(join(output, 'fixture-probe.log'), fixtureProbe)
  assert.match(fixtureProbe, /small\.amplugin/, 'Test fixture provider did not register/start')
  report.fixtureProviderInitializedByShell = true
  const log = adb([
    'shell',
    'am',
    'instrument',
    '-w',
    '-r',
    `${testPackage}/androidx.test.runner.AndroidJUnitRunner`,
  ])
  writeFileSync(join(output, 'instrumentation.log'), log)
  report.instrumentationTests = instrumentationCount(log)
  report.skippedTests = [...log.matchAll(/INSTRUMENTATION_STATUS_CODE: -(?:3|4)\b/g)].length
  assert.match(log, /s16KeystoreNonextractable=true/, 'Keystore nonextractability was not verified')
  report.keystoreNonextractable = true
  report.keystoreHardwareBacked = /s16KeystoreHardwareBacked=true/.test(log)
  for (const [name, prop] of Object.entries({
    manufacturer: 'ro.product.manufacturer',
    model: 'ro.product.model',
    api: 'ro.build.version.sdk',
    android: 'ro.build.version.release',
  }))
    report[name] = adb(['shell', 'getprop', prop]).trim()
  const pageKiB = adb(['shell', 'cat', '/proc/self/smaps']).match(
    /^KernelPageSize:\s+(\d+) kB/m,
  )?.[1]
  assert(pageKiB, 'Kernel page-size diagnostic unavailable')
  report.pageSize = Number(pageKiB) * 1024
  const webview = adb(['shell', 'dumpsys', 'webviewupdate'])
  writeFileSync(join(output, 'webview.txt'), webview)
  report.webview = webview.match(/Current WebView package[^\n]*/)?.[0]?.trim()
  const launch = adb(['shell', 'am', 'start', '-W', '-n', 'com.anymusic.app/.BootstrapActivity'])
  writeFileSync(join(output, 'launch.log'), launch)
  assert.match(launch, /Status: ok/)
  assert(
    /^\d+$/.test(adb(['shell', 'pidof', 'com.anymusic.app']).trim()),
    'Release process missing after launch',
  )
  await delay(2000)
  assert(
    /^\d+$/.test(adb(['shell', 'pidof', 'com.anymusic.app']).trim()),
    'Release process exited during startup',
  )
  adb(['shell', 'input', 'keyevent', 'KEYCODE_HOME'])
  adb(['shell', 'am', 'start', '-W', '-n', 'com.anymusic.app/.BootstrapActivity'])
  adb(['shell', 'am', 'force-stop', 'com.anymusic.app'])
  adb(['shell', 'am', 'start', '-W', '-n', 'com.anymusic.app/.BootstrapActivity'])
  await delay(2000)
  assert(
    /^\d+$/.test(adb(['shell', 'pidof', 'com.anymusic.app']).trim()),
    'Release process exited after restart',
  )
  report.releaseProcessLifecycleSmoke = true
  report.releaseProcessStarted = true
  report.testArtifacts = [hostApk, testApk].map((path) => ({
    sha256: sha256(path),
    path: path.replaceAll('\\', '/').slice(root.replaceAll('\\', '/').length),
  }))
  report.passed = true
} catch (error) {
  if (testInstalled) {
    try {
      const uid = adb(['shell', 'cmd', 'package', 'list', 'packages', '-U', testPackage]).match(
        /uid:(\d+)/,
      )?.[1]
      if (uid)
        writeFileSync(
          join(output, 'fixture-process.log'),
          adb(['logcat', '-d', '-t', '300', `--uid=${uid}`, '-v', 'brief']),
        )
    } catch {
      report.fixtureDiagnosticsUnavailable = true
    }
  }
  report.failure = /INSTALL_FAILED_USER_RESTRICTED/.test(String(error))
    ? 'Device rejected USB installation (INSTALL_FAILED_USER_RESTRICTED)'
    : String(error).slice(0, 4096)
  throw error
} finally {
  try {
    const cleanupErrors = []
    for (const [installedByHarness, name] of [
      [testInstalled, testPackage],
      [hostInstalled, testHost],
    ]) {
      if (!installedByHarness) continue
      try {
        adb(['uninstall', name])
      } catch {
        cleanupErrors.push(`Could not remove ${name}`)
      }
    }
    report.testApksRemoved = cleanupErrors.length === 0
    if (cleanupErrors.length) {
      report.passed = false
      report.cleanupErrors = cleanupErrors
    }
  } finally {
    report.finishedAtUtc = new Date().toISOString()
    writeFileSync(join(output, 'acceptance.json'), JSON.stringify(report, null, 2) + '\n')
  }
}
assert(report.passed, report.cleanupErrors?.join('; ') ?? 'Physical acceptance incomplete')
console.log(`Android physical native-adapter acceptance: ${join(output, 'acceptance.json')}`)
