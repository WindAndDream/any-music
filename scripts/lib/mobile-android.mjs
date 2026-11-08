import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const root = fileURLToPath(new URL('../../', import.meta.url))
export const androidProject = join(root, 'apps/tauri/src-tauri/gen/android')
export const androidMinimumApi = 26
const targets = {
  aarch64: { triple: 'aarch64-linux-android', abi: 'arm64-v8a', flavor: 'Arm64' },
  x86_64: { triple: 'x86_64-linux-android', abi: 'x86_64', flavor: 'X86_64' },
}

/** Release signing is opt-in and never falls back to a debug key or saved Gradle state. */
export function androidBuildOptions(args, env = process.env) {
  const [target = 'aarch64', ...flags] = args
  assert(Object.hasOwn(targets, target), 'Expected aarch64 or x86_64')
  assert(
    flags.every((flag) => ['--release', '--signed'].includes(flag)),
    'Unknown Android build option',
  )
  assert(new Set(flags).size === flags.length, 'Duplicate Android build option')
  const release = flags.includes('--release')
  const signed = flags.includes('--signed')
  assert(!signed || release, '--signed requires --release')
  if (signed) {
    for (const key of ['KEYSTORE', 'STORE_PASSWORD', 'KEY_ALIAS', 'KEY_PASSWORD'])
      assert(env[`AM_ANDROID_${key}`]?.trim(), `AM_ANDROID_${key} is required for signing`)
    assert(isAbsolute(env.AM_ANDROID_KEYSTORE), 'AM_ANDROID_KEYSTORE must be an absolute path')
    assert(
      env.AM_ANDROID_KEY_ALIAS.toLowerCase() !== 'androiddebugkey',
      'A release cannot use the debug key alias',
    )
  }
  return { ...targets[target], target, release, signed, profile: release ? 'release' : 'debug' }
}

export function androidToolchain(env = process.env, platform = process.platform) {
  const host = { win32: 'windows-x86_64', linux: 'linux-x86_64', darwin: 'darwin-x86_64' }[platform]
  assert(
    host && env.NDK_HOME && env.JAVA_HOME && env.ANDROID_HOME,
    'NDK_HOME, JAVA_HOME and ANDROID_HOME are required',
  )
  const bin = join(env.NDK_HOME, 'toolchains/llvm/prebuilt', host, 'bin')
  return {
    java: join(env.JAVA_HOME, `bin/java${platform === 'win32' ? '.exe' : ''}`),
    ar: join(bin, `llvm-ar${platform === 'win32' ? '.exe' : ''}`),
    compiler: (triple) =>
      join(bin, `${triple}${androidMinimumApi}-clang${platform === 'win32' ? '.cmd' : ''}`),
  }
}

/** Recreate ignored JNI bridge sources without regenerating the maintained Android project. */
export function prepareAndroidCodegen(project = androidProject) {
  const { identifier } = JSON.parse(
    readFileSync(join(project, '../../tauri.android.conf.json'), 'utf8'),
  )
  const output = join(project, 'app/src/main/java', ...identifier.split('.'), 'generated')
  mkdirSync(output, { recursive: true })
  return {
    WRY_ANDROID_PACKAGE: identifier,
    WRY_ANDROID_LIBRARY: 'any_music_tauri_lib',
    WRY_ANDROID_KOTLIN_FILES_OUT_DIR: output,
  }
}

export function run(command, args, { capture = false, ...options } = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: capture ? 'pipe' : 'inherit',
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    ...options,
  })
  if (result.error) throw result.error
  assert.equal(
    result.status,
    0,
    `${command} failed (${result.status})${capture ? `\n${result.stderr}\n${result.stdout}` : ''}`,
  )
  return result.stdout
}

/** pnpm may expose a standalone executable instead of a Node script on Windows. */
export function runPnpm(args, options = {}, env = process.env) {
  const entry = env.npm_execpath
  assert(entry, 'Run from the repository root using pnpm build:mobile:android')
  return /\.exe$/i.test(entry)
    ? run(entry, args, options)
    : run(process.execPath, [entry, ...args], options)
}

export function gradle(args, options) {
  const { java } = androidToolchain()
  assert(existsSync(java), 'JAVA_HOME does not contain Java')
  return run(
    java,
    [
      '-classpath',
      join(androidProject, 'gradle/wrapper/gradle-wrapper.jar'),
      'org.gradle.wrapper.GradleWrapperMain',
      '--project-dir',
      androidProject,
      '--no-daemon',
      '--console',
      'plain',
      ...args,
    ],
    options,
  )
}

export function androidOutput({ flavor, profile, signed }) {
  const variant = `${flavor.toLowerCase()}${profile === 'release' ? 'Release' : 'Debug'}`
  return {
    apk: join(
      androidProject,
      `app/build/outputs/apk/${flavor.toLowerCase()}/${profile}/app-${flavor.toLowerCase()}-${profile}${profile === 'release' && !signed ? '-unsigned' : ''}.apk`,
    ),
    aab: join(
      androidProject,
      `app/build/outputs/bundle/${variant}/app-${flavor.toLowerCase()}-${profile}.aab`,
    ),
  }
}

/** SDK-owned bytes go only into the instrumentation APK, never the product. */
export function prepareAndroidTestFixture() {
  const corpus = JSON.parse(
    readFileSync(join(root, 'packages/plugin-sdk/test/fixtures/packages/corpus.json'), 'utf8'),
  )
  const fixture = corpus.find((entry) => entry.name === 'signed-golden' && entry.ok)
  assert(fixture, 'SDK package preview fixture missing')
  const bytes = Buffer.from(fixture.base64, 'base64')
  const assets = join(androidProject, 'app/build/generated/s16-assets')
  mkdirSync(assets, { recursive: true })
  writeFileSync(join(assets, 'fixture.amplugin'), bytes)
  return createHash('sha256').update(bytes).digest('hex')
}
