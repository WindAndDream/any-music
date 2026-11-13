import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { inspectMobileBoundaries } from './check-mobile-boundaries.mjs'
import { inspectAndroidWorkbench } from './lib/android-webview.mjs'
import {
  androidBuildOptions,
  androidOutput,
  androidProject,
  gradle,
  prepareAndroidTestFixture,
  root,
  run,
} from './lib/mobile-android.mjs'

export function instrumentationCount(output) {
  assert(
    !/FAILURES!!!|INSTRUMENTATION_FAILED|Process crashed|INSTRUMENTATION_STATUS_CODE: -(?:1|2)\b/.test(
      output,
    ),
    'Android instrumentation failed',
  )
  const count = Number(output.match(/OK \((\d+) tests?\)/)?.[1])
  assert(
    count > 0 && /INSTRUMENTATION_CODE: -1\b/.test(output),
    'Missing successful JUnit completion; adb exit code alone is insufficient',
  )
  return count
}

/** Explicit live acceptance only. Never selects a default device, resets an AVD,
 * uninstalls the product or admits plugin execution. Build the debug app first. */
export async function acceptMobileAndroid(args) {
  assert(
    args.length === 2 && args[0] === '--serial' && /^emulator-\d+$/.test(args[1]),
    'Pass --serial emulator-N (an already running dedicated test emulator)',
  )
  inspectMobileBoundaries()
  const serial = args[1]
  const adbPath = join(
    process.env.ANDROID_HOME,
    `platform-tools/adb${process.platform === 'win32' ? '.exe' : ''}`,
  )
  const adb = (arguments_, options = {}) =>
    run(adbPath, ['-s', serial, ...arguments_], { capture: true, timeout: 120_000, ...options })
  assert.equal(
    adb(['shell', 'getprop', 'ro.kernel.qemu']).trim(),
    '1',
    'This harness only accepts an emulator',
  )
  assert.equal(
    adb(['shell', 'getprop', 'ro.product.cpu.abi']).trim(),
    'x86_64',
    'Expected x86_64 emulator',
  )
  assert(
    !adb(['shell', 'pm', 'list', 'packages', 'com.anymusic.app.test'])
      .split(/\r?\n/)
      .includes('package:com.anymusic.app.test'),
    'Remove the existing test APK explicitly before using this isolated harness',
  )
  const build = androidBuildOptions(['x86_64'])
  const { apk } = androidOutput(build)
  const library = join(root, 'target/x86_64-linux-android/debug/libany_music_tauri_lib.so')
  assert(existsSync(apk) && existsSync(library), 'Run pnpm build:mobile:android x86_64 first')
  const jni = join(androidProject, 'app/src/debug/jniLibs/x86_64')
  mkdirSync(jni, { recursive: true })
  copyFileSync(library, join(jni, 'libany_music_tauri_lib.so'))
  const fixtureHash = prepareAndroidTestFixture()
  gradle(
    [
      ':app:assembleX86_64Debug',
      ':app:assembleX86_64DebugAndroidTest',
      '-x',
      ':app:rustBuildX86_64Debug',
    ],
    {
      env: { ...process.env, AM_ANDROID_SIGNED_BUILD: '0', AM_ANDROID_ADAPTER_TEST: '0' },
    },
  )
  const testApk = join(
    androidProject,
    'app/build/outputs/apk/androidTest/x86_64/debug/app-x86_64-debug-androidTest.apk',
  )
  const output = join(root, '.codex-tmp/s16-accept', serial)
  mkdirSync(output, { recursive: true })
  const report = {
    runtimeScope: 'tauri',
    startedAtUtc: new Date().toISOString(),
    serial,
    passed: false,
    physicalDevice: false,
    externalPlugins: 'none',
    executionAdmitted: false,
    channelAccepted: false,
  }
  let testInstalled = false
  try {
    // An incompatible existing signer fails installation; the harness never removes user data.
    adb(['install', '-r', apk])
    adb(['install', '-t', testApk])
    testInstalled = true
    const log = adb([
      'shell',
      'am',
      'instrument',
      '-w',
      '-r',
      'com.anymusic.app.test/androidx.test.runner.AndroidJUnitRunner',
    ])
    writeFileSync(join(output, 'instrumentation.log'), log)
    report.instrumentationTests = instrumentationCount(log)
    report.keystoreHardwareBacked = /s16KeystoreHardwareBacked=true/.test(log)
    report.keystoreNonextractable = /s16KeystoreNonextractable=true/.test(log)
    report.skippedTests = [...log.matchAll(/INSTRUMENTATION_STATUS_CODE: -(?:3|4)\b/g)].length
    report.api = Number(adb(['shell', 'getprop', 'ro.build.version.sdk']).trim())
    report.fingerprint = adb(['shell', 'getprop', 'ro.build.fingerprint']).trim()
    // Older Android shells do not ship getconf. Read only this diagnostic cat
    // process's own mappings, rather than requiring access to product memory.
    const pageKiB = adb(['shell', 'cat', '/proc/self/smaps']).match(
      /^KernelPageSize:\s+(\d+) kB/m,
    )?.[1]
    assert(pageKiB, 'Kernel page-size diagnostic unavailable')
    report.pageSize = Number(pageKiB) * 1024
    const webview = adb(['shell', 'dumpsys', 'webviewupdate'])
    writeFileSync(join(output, 'webview.txt'), webview)
    const major = Number(webview.match(/Current WebView package[^\n]*?,\s*(\d+)\./)?.[1])
    report.workbenchChecked = major >= 111
    report.bootstrapOnly = !(major >= 111)
    adb(['shell', 'am', 'start', '-W', '-n', 'com.anymusic.app/.BootstrapActivity'])
    if (report.workbenchChecked) {
      report.workbench = await inspectAndroidWorkbench(adb, fixtureHash)
    } else {
      const layout = `/data/local/tmp/any-music-s16-${randomUUID()}.xml`
      try {
        adb(['shell', 'uiautomator', 'dump', layout])
        const xml = adb(['shell', 'cat', layout])
        assert(
          /Update Android System WebView|请将 Android System WebView/.test(xml),
          'Missing native engine update message',
        )
        report.nativeUpdateMessage = true
      } finally {
        adb(['shell', 'rm', '-f', layout])
      }
    }
    report.artifacts = [apk, testApk].map((path) => ({
      path: path.replaceAll('\\', '/').slice(root.replaceAll('\\', '/').length),
      sha256: createHash('sha256').update(readFileSync(path)).digest('hex'),
    }))
    report.passed = true
  } finally {
    try {
      if (testInstalled) adb(['uninstall', 'com.anymusic.app.test'])
      report.testApkRemoved = testInstalled
    } finally {
      report.finishedAtUtc = new Date().toISOString()
      writeFileSync(join(output, 'acceptance.json'), JSON.stringify(report, null, 2) + '\n')
    }
  }
  console.log(`Android emulator acceptance: ${join(output, 'acceptance.json')}`)
  return report
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  await acceptMobileAndroid(process.argv.slice(2))
