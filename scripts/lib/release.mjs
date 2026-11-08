import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const releaseRoot = fileURLToPath(new URL('../../', import.meta.url))
export const productManifests = [
  'package.json',
  'apps/userscript/package.json',
  'apps/tauri/package.json',
  'apps/tauri/src-tauri/tauri.conf.json',
]
const bundleExtensions = { nsis: 'exe', dmg: 'dmg', appimage: 'AppImage', deb: 'deb' }

export function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

/** One product SemVer is used by tags, userscript metadata and native installers. */
export function parseProductVersion(version) {
  assert.equal(typeof version, 'string', 'Expected a product version')
  const match =
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/.exec(
      version,
    )
  assert(match && match[0] === version, `Invalid product version: ${version}`)
  assert(
    match.slice(1, 4).every((part) => Number(part) <= 65535),
    'Installer version exceeds 16-bit components',
  )
  assert(
    !match[4]?.split('.').some((part) => /^0\d+$/.test(part)),
    'Numeric prerelease identifiers cannot have leading zeros',
  )
  return { version, tag: `v${version}`, prerelease: Boolean(match[4]) }
}

function nativeVersion(source, name) {
  const block = source.split(/\n\[\[?[^\n]+/).find((entry) => entry.includes(`name = "${name}"`))
  const version = block?.match(/^version = "([^"]+)"$/m)?.[1]
  assert(version, `Missing native version for ${name}`)
  return version
}

export function readReleaseConfig(directory = releaseRoot) {
  const config = readJson(resolve(directory, 'scripts/native-targets.json'))
  assert.equal(config.version, 1, 'Unknown native target configuration')
  assert(config.releases.length > 0, 'Missing desktop targets')
  for (const target of config.releases) {
    assert(/^[a-z]+-(?:x64|arm64)$/.test(target.id), 'Invalid desktop target ID')
    assert.equal(target.id, `${target.platform}-${target.arch}`)
    assert.equal(target.defaultFeatures, false)
    assert.deepEqual(target.features, ['tauri/custom-protocol'])
    assert.equal(target.package, 'any-music-tauri')
    assert(
      target.bundles.length > 0 &&
        target.bundles.every((bundle) => Object.hasOwn(bundleExtensions, bundle)),
    )
  }
  assert(
    Number.isInteger(config.android.versionCode) &&
      config.android.versionCode > 0 &&
      config.android.versionCode <= 2100000000,
    'Invalid Android versionCode',
  )
  const ids = [...config.releases, ...config.android.targets].map((target) => target.id)
  assert.equal(new Set(ids).size, ids.length, 'Duplicate release target')
  return config
}

export function productVersion(directory = releaseRoot) {
  const versions = productManifests.map((path) => ({
    path,
    version: readJson(resolve(directory, path)).version,
  }))
  for (const path of ['apps/tauri/src-tauri/Cargo.toml', 'Cargo.lock']) {
    versions.push({
      path,
      version: nativeVersion(readFileSync(resolve(directory, path), 'utf8'), 'any-music-tauri'),
    })
  }
  const parsed = parseProductVersion(versions[0].version)
  for (const entry of versions)
    assert.equal(entry.version, parsed.version, `Product version mismatch in ${entry.path}`)
  return parsed
}

export function gitOutput(args, directory = releaseRoot) {
  return execFileSync('git', args, { cwd: directory, encoding: 'utf8' }).trim()
}

export function releaseContext(directory = releaseRoot, env = process.env) {
  const version = productVersion(directory)
  if (env.AM_RELEASE_TAG)
    assert.equal(env.AM_RELEASE_TAG, version.tag, 'Tag must match the product version')
  const commit = gitOutput(['rev-parse', 'HEAD'], directory)
  assert(/^[0-9a-f]{40}$/.test(commit), 'Expected a Git commit SHA')
  if (env.AM_RELEASE_COMMIT)
    assert.equal(commit, env.AM_RELEASE_COMMIT, 'Checkout differs from the prepared release commit')
  const sourceDirty = Boolean(
    gitOutput(['status', '--porcelain', '--untracked-files=normal'], directory),
  )
  const androidSigning = env.AM_RELEASE_ANDROID_SIGNING || 'unsigned'
  assert(['unsigned', 'signed'].includes(androidSigning), 'Unknown Android signing mode')
  return { ...version, commit, sourceDirty, androidSigning }
}

/** Only annotated product tags on the exact checkout can authorize publication. */
export function verifyReleaseTag(context, git = gitOutput) {
  assert.equal(parseProductVersion(context.tag.slice(1)).tag, context.tag, 'Invalid release tag')
  assert.equal(
    git(['cat-file', '-t', `refs/tags/${context.tag}`]),
    'tag',
    'Use an annotated release tag',
  )
  const commit = git(['rev-parse', '--verify', `refs/tags/${context.tag}^{commit}`])
  assert.equal(commit, context.commit, 'Release tag differs from the checkout commit')
}

/** Published versions must already belong to the accepted main release history. */
export function verifyReleaseMain(context, git = gitOutput) {
  git(['merge-base', '--is-ancestor', context.commit, 'refs/remotes/origin/main'])
}

export function releaseTargets(config = readReleaseConfig(), androidSigning = 'unsigned') {
  assert(['unsigned', 'signed'].includes(androidSigning), 'Unknown Android signing mode')
  return [
    {
      id: 'userscript',
      kind: 'userscript',
      platform: 'userscript',
      arch: 'any',
      extensions: ['user.js'],
      signing: 'not-applicable',
    },
    ...config.releases.map((target) => ({
      ...target,
      kind: 'desktop',
      extensions: target.bundles.map((bundle) => bundleExtensions[bundle]),
      signing: target.platform === 'macos' ? 'ad-hoc' : 'unsigned',
    })),
    ...config.android.targets.map((target) => ({
      ...target,
      kind: 'android',
      platform: 'android',
      extensions: ['apk', 'aab'],
      signing: androidSigning,
    })),
  ]
}

export function assetName(target, version, extension) {
  assert(target.extensions.includes(extension), 'Unexpected artifact format')
  if (target.kind === 'userscript') return 'any-music.user.js'
  const suffix =
    target.kind === 'android' && target.signing === 'unsigned'
      ? '-unsigned'
      : extension === 'exe'
        ? '-setup'
        : ''
  return `any-music_${version}_${target.platform}_${target.arch}${suffix}.${extension}`
}

/** Gradle's maintained project consumes this file instead of Tauri CLI's generated version. */
export function androidVersionProperties(directory = releaseRoot) {
  const { version } = productVersion(directory)
  const { android } = readReleaseConfig(directory)
  return `# Generated from the product release version and toolchain; do not edit.\ntauri.android.versionCode=${android.versionCode}\ntauri.android.versionName=${version}\ntauri.android.ndkVersion=${android.ndk}\ntauri.android.buildToolsVersion=${android.buildTools}\n`
}
