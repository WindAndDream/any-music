import assert from 'node:assert/strict'
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { inspectMobileBoundaries } from './check-mobile-boundaries.mjs'
import {
  androidBuildOptions,
  androidOutput,
  androidProject,
  androidToolchain,
  gradle,
  prepareAndroidCodegen,
  root,
  run,
  runPnpm,
} from './lib/mobile-android.mjs'
import { androidVersionProperties } from './lib/release.mjs'

// Build the existing application without Windows symlink privileges or IDE automation.
// Gradle's duplicate Rust task alone is skipped after the locked Cargo build succeeds.
const build = androidBuildOptions(process.argv.slice(2))
const { triple, abi, flavor, profile, release, signed } = build
inspectMobileBoundaries()
const tools = androidToolchain()
const cc = tools.compiler(triple)
const ar = tools.ar
assert(existsSync(cc) && existsSync(ar), 'Android API 26 compiler tools unavailable')
if (signed) assert(existsSync(process.env.AM_ANDROID_KEYSTORE), 'Signing keystore unavailable')
runPnpm(['--filter', '@any-music/tauri', 'build:frontend'])
const suffix = triple.replaceAll('-', '_')
const codegen = prepareAndroidCodegen()
run(
  'cargo',
  [
    'build',
    '-p',
    'any-music-tauri',
    '--lib',
    '--target',
    triple,
    '--locked',
    '--no-default-features',
    '--features',
    'tauri/custom-protocol',
    ...(release ? ['--release'] : []),
  ],
  {
    env: {
      ...process.env,
      ...codegen,
      [`CC_${suffix}`]: cc,
      [`AR_${suffix}`]: ar,
      [`CARGO_TARGET_${suffix.toUpperCase()}_LINKER`]: cc,
    },
  },
)
const project = androidProject
writeFileSync(join(project, 'app/tauri.properties'), androidVersionProperties())
// Recreate only machine-local Gradle wiring from the locked Cargo graph. A clean checkout
// must not depend on a previous `tauri android init` or overwrite maintained Kotlin/XML.
const metadata = run(
  'cargo',
  ['metadata', '--locked', '--format-version', '1', '--filter-platform', triple],
  {
    capture: true,
  },
)
const packages = JSON.parse(metadata).packages
const plugins = ['tauri', 'tauri-plugin-deep-link', 'tauri-plugin-dialog', 'tauri-plugin-opener']
const modules = plugins.map((name) => {
  const candidates = packages.filter((p) => p.name === name)
  assert.equal(candidates.length, 1, `Expected one locked ${name}`)
  const path = join(
    dirname(candidates[0].manifest_path),
    name === 'tauri' ? 'mobile/android' : 'android',
  )
  assert(existsSync(path), `Missing Android sources: ${name}`)
  return { name: name === 'tauri' ? 'tauri-android' : name, path }
})
const tauriMobile = modules.find((module) => module.name === 'tauri-android').path
// Tauri does not track the Wry codegen environment as a Cargo rerun trigger. Refresh its
// fixed templates even when a previous Cargo check cached a build without Android codegen.
writeFileSync(
  join(codegen.WRY_ANDROID_KOTLIN_FILES_OUT_DIR, 'TauriActivity.kt'),
  readFileSync(join(tauriMobile, '../android-codegen/TauriActivity.kt'), 'utf8')
    .replaceAll('{{package}}', codegen.WRY_ANDROID_PACKAGE)
    .replaceAll('{{library}}', codegen.WRY_ANDROID_LIBRARY),
)
writeFileSync(
  join(project, 'app/proguard-tauri.pro'),
  readFileSync(join(tauriMobile, '../proguard-tauri.pro'), 'utf8').replaceAll(
    '$PACKAGE',
    codegen.WRY_ANDROID_PACKAGE,
  ),
)
const groovy = (value) => value.replaceAll('\\', '/').replaceAll("'", "\\'")
writeFileSync(
  join(project, 'tauri.settings.gradle'),
  '// Generated machine-local paths from Cargo.lock.\n' +
    modules
      .map(
        (m) =>
          `include ':${m.name}'\nproject(':${m.name}').projectDir = new File('${groovy(m.path)}')\n`,
      )
      .join(''),
)
writeFileSync(
  join(project, 'app/tauri.build.gradle.kts'),
  '// Generated from the fixed native plugin directory.\nval implementation = configurations.getByName("implementation")\ndependencies {\n' +
    modules.map((m) => `  implementation(project(":${m.name}"))\n`).join('') +
    '}\n',
)
// Separate profiles prevent a debug/test build from packaging stale release JNI bytes.
const jni = join(project, `app/src/${profile}/jniLibs`, abi)
mkdirSync(jni, { recursive: true })
copyFileSync(
  join(root, 'target', triple, `${profile}/libany_music_tauri_lib.so`),
  join(jni, 'libany_music_tauri_lib.so'),
)
const { apk, aab } = androidOutput(build)
// Repack a generated output rather than accumulating obsolete ZIP entries on incremental builds.
rmSync(apk, { force: true })
if (release) {
  rmSync(aab, { force: true })
  rmSync(androidOutput({ ...build, signed: !signed }).apk, { force: true })
  rmSync(join(dirname(apk), 'release-verification.json'), { force: true })
}
const variant = `${flavor}${release ? 'Release' : 'Debug'}`
gradle(
  [
    `:app:assemble${variant}`,
    ...(release ? [`:app:bundle${variant}`] : []),
    ...(signed ? ['--no-configuration-cache'] : []),
    '-x',
    `:app:rustBuild${variant}`,
  ],
  {
    env: {
      ...process.env,
      AM_ANDROID_SIGNED_BUILD: signed ? '1' : '0',
      AM_ANDROID_ADAPTER_TEST: '0',
    },
  },
)
assert(existsSync(apk) && (!release || existsSync(aab)), 'Expected Android artifact missing')
console.log(`Android ${profile} APK: ${apk}`)
if (release) {
  console.log(`Android release AAB: ${aab}`)
  if (signed) run(process.execPath, [join(root, 'scripts/check-mobile-release.mjs'), build.target])
}
