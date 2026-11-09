import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import {
  closeSync,
  copyFileSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { resolve } from 'node:path'

import { assetName, readJson, readReleaseConfig, releaseRoot, releaseTargets } from './release.mjs'

/** Hash large installers with bounded memory; never follow staged artifact symlinks. */
export function artifactRecord(path, name) {
  const stat = lstatSync(path)
  assert(stat.isFile() && stat.size > 0, `Expected a nonempty artifact: ${name}`)
  const hash = createHash('sha256')
  const buffer = Buffer.alloc(1024 * 1024)
  const descriptor = openSync(path, 'r')
  try {
    let length
    while ((length = readSync(descriptor, buffer, 0, buffer.length, null)) > 0)
      hash.update(buffer.subarray(0, length))
  } finally {
    closeSync(descriptor)
  }
  return { name, bytes: stat.size, sha256: hash.digest('hex') }
}

function targetMetadata(target) {
  return {
    id: target.id,
    platform: target.platform,
    arch: target.arch,
    nativeTarget:
      target.kind === 'android' ? `${target.target}-linux-android` : (target.target ?? null),
    signing: target.signing,
  }
}

export function stageReleaseArtifacts(target, context, sources, directory = releaseRoot) {
  assert.deepEqual(
    Object.keys(sources).toSorted(),
    target.extensions.toSorted(),
    'Missing or unexpected build formats',
  )
  const output = resolve(directory, 'dist/release', target.id)
  rmSync(output, { recursive: true, force: true })
  mkdirSync(output, { recursive: true })
  const files = target.extensions.map((extension) => {
    const name = assetName(target, context.version, extension)
    const record = artifactRecord(sources[extension], name)
    if (target.kind === 'userscript') {
      const metadata = readFileSync(sources[extension], 'utf8').split('// ==/UserScript==')[0]
      assert.equal(
        metadata.match(/^\/\/\s*@version\s+(\S+)\s*$/m)?.[1],
        context.version,
        'Built userscript version differs from the release',
      )
    }
    copyFileSync(sources[extension], resolve(output, name))
    return record
  })
  const manifest = { schemaVersion: 1, ...context, ...targetMetadata(target), files }
  writeFileSync(resolve(output, 'artifact.json'), JSON.stringify(manifest, null, 2) + '\n')
  return { output, manifest }
}

function verifyTargetManifest(manifest, target, context, directory) {
  assert.equal(manifest.schemaVersion, 1, 'Unknown artifact manifest')
  for (const [key, value] of Object.entries({ ...context, ...targetMetadata(target) })) {
    assert.equal(manifest[key], value, `Artifact ${target.id} has a different ${key}`)
  }
  const expected = target.extensions
    .map((extension) => assetName(target, context.version, extension))
    .toSorted()
  assert.deepEqual(
    manifest.files.map((file) => file.name).toSorted(),
    expected,
    `Incomplete formats for ${target.id}`,
  )
  for (const file of manifest.files) {
    assert.deepEqual(
      artifactRecord(resolve(directory, file.name), file.name),
      file,
      `Artifact was changed: ${file.name}`,
    )
  }
}

/** Require the complete declared matrix and byte identity before creating publishable output. */
export function collectReleaseArtifacts(context, directory = releaseRoot) {
  const config = readReleaseConfig(directory)
  const targets = releaseTargets(config, context.androidSigning)
  const incoming = resolve(directory, 'dist/release/incoming')
  assert.deepEqual(
    readdirSync(incoming).toSorted(),
    targets.map((target) => `release-${target.id}`).toSorted(),
    'Downloaded release target matrix is incomplete or unexpected',
  )
  const manifests = targets.map((target) => {
    const folder = resolve(incoming, `release-${target.id}`)
    const manifest = readJson(resolve(folder, 'artifact.json'))
    verifyTargetManifest(manifest, target, context, folder)
    assert.deepEqual(
      readdirSync(folder).toSorted(),
      ['artifact.json', ...manifest.files.map((file) => file.name)].toSorted(),
      'Unexpected files in build artifact',
    )
    return manifest
  })
  const output = resolve(directory, 'dist/release/publish')
  rmSync(output, { recursive: true, force: true })
  mkdirSync(output, { recursive: true })
  for (const manifest of manifests) {
    for (const file of manifest.files) {
      copyFileSync(
        resolve(incoming, `release-${manifest.id}`, file.name),
        resolve(output, file.name),
      )
    }
  }
  const manifest = {
    schemaVersion: 1,
    ...context,
    toolchain: {
      node: readFileSync(resolve(directory, '.node-version'), 'utf8').trim(),
      pnpm: readJson(resolve(directory, 'package.json')).packageManager,
      rust: config.releaseToolchain,
      android: {
        java: config.android.javaVersion,
        sdk: config.android.sdk,
        buildTools: config.android.buildTools,
        ndk: config.android.ndk,
        versionCode: config.android.versionCode,
      },
    },
    targets: manifests,
  }
  writeFileSync(resolve(output, 'release-manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
  const notes = [
    `Product version: ${context.version}. Commit: ${context.commit}.`,
    '',
    '## Downloads',
    '',
    '| Platform | Architecture | Package | Signing |',
    '| --- | --- | --- | --- |',
    ...manifests.flatMap((entry) =>
      entry.files.map(
        (file) => `| ${entry.platform} | ${entry.arch} | \`${file.name}\` | ${entry.signing} |`,
      ),
    ),
    '',
    context.androidSigning === 'signed'
      ? 'Android APK/AAB files use the release signing key. Per-ABI AABs still require distribution-channel acceptance. iOS is excluded.'
      : 'Android APK/AAB files are unsigned candidate artifacts. APKs require signing before installation; AABs require signing and a distribution channel. iOS is excluded.',
    '',
    'Windows installers are unsigned. macOS bundles use ad-hoc signing without Apple notarization. OS security prompts may apply.',
    '',
    'Build results do not establish device, playback, installer-association or external-plugin execution acceptance.',
    '',
    'Verify downloads with SHA256SUMS. Toolchains, architectures, sizes and SHA-256 hashes are recorded in release-manifest.json.',
    '',
  ].join('\n')
  writeFileSync(resolve(output, 'release-notes.md'), notes)
  const names = readdirSync(output).toSorted()
  const checksums = names
    .map((name) => `${artifactRecord(resolve(output, name), name).sha256}  ${name}\n`)
    .join('')
  writeFileSync(resolve(output, 'SHA256SUMS'), checksums)
  return { output, manifest }
}

/** Recheck local bytes immediately before the publishing job gives them to GitHub. */
export function verifyCollectedRelease(context, directory = releaseRoot) {
  const output = resolve(directory, 'dist/release/publish')
  const manifest = readJson(resolve(output, 'release-manifest.json'))
  assert.equal(manifest.schemaVersion, 1)
  for (const [key, value] of Object.entries(context))
    assert.equal(manifest[key], value, `Release manifest has a different ${key}`)
  const targets = releaseTargets(readReleaseConfig(directory), context.androidSigning)
  assert.deepEqual(
    manifest.targets.map((entry) => entry.id).toSorted(),
    targets.map((entry) => entry.id).toSorted(),
    'Release manifest target matrix is incomplete',
  )
  for (const target of targets)
    verifyTargetManifest(
      manifest.targets.find((entry) => entry.id === target.id),
      target,
      context,
      output,
    )
  const names = [
    'release-manifest.json',
    'release-notes.md',
    ...manifest.targets.flatMap((entry) => entry.files.map((file) => file.name)),
  ].toSorted()
  assert.deepEqual(
    readdirSync(output).toSorted(),
    [...names, 'SHA256SUMS'].toSorted(),
    'Unexpected release assets',
  )
  const checksums = names
    .map((name) => `${artifactRecord(resolve(output, name), name).sha256}  ${name}\n`)
    .join('')
  assert.equal(
    readFileSync(resolve(output, 'SHA256SUMS'), 'utf8'),
    checksums,
    'Release checksums differ',
  )
  return { output, files: [...names, 'SHA256SUMS'].toSorted() }
}
