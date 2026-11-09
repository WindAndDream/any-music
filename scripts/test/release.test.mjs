import assert from 'node:assert/strict'
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { test } from 'node:test'

import {
  collectReleaseArtifacts,
  stageReleaseArtifacts,
  verifyCollectedRelease,
} from '../lib/release-artifacts.mjs'
import {
  androidVersionProperties,
  assetName,
  parseProductVersion,
  productManifests,
  productVersion,
  readJson,
  readReleaseConfig,
  releaseRoot,
  releaseTargets,
  verifyReleaseMain,
  verifyReleaseTag,
} from '../lib/release.mjs'
import { prepareRelease } from '../prepare-release.mjs'
import { publishRelease } from '../publish-release.mjs'

const context = {
  ...parseProductVersion('0.1.0'),
  commit: 'a'.repeat(40),
  sourceDirty: false,
  androidSigning: 'signed',
}

function fixture(t) {
  const directory = mkdtempSync(resolve(tmpdir(), 'any-music-release-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  const paths = [
    ...productManifests,
    'apps/tauri/src-tauri/Cargo.toml',
    'Cargo.lock',
    'scripts/native-targets.json',
    '.node-version',
  ]
  for (const path of paths) {
    mkdirSync(dirname(resolve(directory, path)), { recursive: true })
    cpSync(resolve(releaseRoot, path), resolve(directory, path))
  }
  // Fixtures keep their own baseline when the real product version/code advances.
  for (const path of productManifests) {
    const json = readJson(resolve(directory, path))
    json.version = '0.1.0'
    writeFileSync(resolve(directory, path), JSON.stringify(json, null, 2) + '\n')
  }
  writeFileSync(
    resolve(directory, 'apps/tauri/src-tauri/Cargo.toml'),
    '[package]\nname = "any-music-tauri"\nversion = "0.1.0"\n\n[dependencies]\n',
  )
  writeFileSync(
    resolve(directory, 'Cargo.lock'),
    'version = 4\n\n[[package]]\nname = "any-music-tauri"\nversion = "0.1.0"\n\n[[package]]\nname = "am-plugin-protocol"\nversion = "0.1.0"\n',
  )
  const config = readReleaseConfig(directory)
  config.android.versionCode = 1
  writeFileSync(resolve(directory, 'scripts/native-targets.json'), JSON.stringify(config))
  return directory
}

function buildFixtures(directory, release = context) {
  const targets = releaseTargets(readReleaseConfig(directory), release.androidSigning)
  for (const target of targets) {
    const sources = {}
    const sourceDir = resolve(directory, 'build', target.id)
    mkdirSync(sourceDir, { recursive: true })
    for (const extension of target.extensions) {
      const path = resolve(sourceDir, `build.${extension}`)
      writeFileSync(
        path,
        target.kind === 'userscript'
          ? `// ==UserScript==\n// @version ${release.version}\n// ==/UserScript==\nconsole.log('release');\n`
          : `${target.id} ${extension} fixture`,
      )
      sources[extension] = path
    }
    const { output } = stageReleaseArtifacts(target, release, sources, directory)
    const incoming = resolve(directory, 'dist/release/incoming', `release-${target.id}`)
    cpSync(output, incoming, { recursive: true })
  }
  return targets
}

test('product versions reject unsafe tags and incompatible installer components', () => {
  assert.equal(parseProductVersion('1.2.3-beta.1').prerelease, true)
  assert.equal(parseProductVersion('1.2.3').prerelease, false)
  for (const version of [
    'v1.2.3',
    '01.2.3',
    '1.2.3-beta.01',
    '1.2.3+build',
    '1.2.3/../../file',
    '65536.0.0',
    '1.2.3\n',
    '1.2.3\noutput=value',
  ]) {
    assert.throws(() => parseProductVersion(version))
  }
})

test('release preparation synchronizes product versions without rewriting independent crates', (t) => {
  const directory = fixture(t)
  prepareRelease('0.2.0-beta.1', '2', directory)
  assert.deepEqual(productVersion(directory), parseProductVersion('0.2.0-beta.1'))
  assert.match(
    androidVersionProperties(directory),
    /versionCode=2\ntauri.android.versionName=0\.2\.0-beta\.1\n/,
  )
  const lock = readFileSync(resolve(directory, 'Cargo.lock'), 'utf8')
  assert.match(lock, /name = "any-music-tauri"\nversion = "0\.2\.0-beta\.1"/)
  assert.match(lock, /name = "am-plugin-protocol"\nversion = "0\.1\.0"/)
  prepareRelease('0.2.0-beta.1', '2', directory)
})

test('invalid Android version codes and malformed native manifests leave all versions unchanged', (t) => {
  const directory = fixture(t)
  const path = resolve(directory, 'package.json')
  const initial = readFileSync(path, 'utf8')
  for (const code of ['0', '1', '1.5', '2100000001', 'invalid']) {
    assert.throws(() => prepareRelease('0.2.0', code, directory))
    assert.equal(readFileSync(path, 'utf8'), initial)
  }
  writeFileSync(
    resolve(directory, 'apps/tauri/src-tauri/Cargo.toml'),
    '[package]\nname = "renamed-app"\nversion = "0.1.0"\n',
  )
  assert.throws(() => prepareRelease('0.2.0', '2', directory))
  assert.equal(readFileSync(path, 'utf8'), initial)
})

test('a mismatched application manifest is rejected before a release build', (t) => {
  const directory = fixture(t)
  const path = resolve(directory, 'apps/userscript/package.json')
  const json = readJson(path)
  json.version = '0.0.0'
  writeFileSync(path, JSON.stringify(json))
  assert.throws(() => productVersion(directory), /Product version mismatch/)
})

test('version preparation handles native manifests checked out with Windows line endings', (t) => {
  const directory = fixture(t)
  for (const path of ['apps/tauri/src-tauri/Cargo.toml', 'Cargo.lock']) {
    const native = resolve(directory, path)
    writeFileSync(native, readFileSync(native, 'utf8').replaceAll('\n', '\r\n'))
  }
  prepareRelease('0.1.1', '2', directory)
  assert.equal(productVersion(directory).version, '0.1.1')
  assert.match(
    readFileSync(resolve(directory, 'apps/tauri/src-tauri/Cargo.toml'), 'utf8'),
    /version = "0\.1\.1"\r\n/,
  )
})

test('tag verification peels exact tag refs and rejects a moved tag', () => {
  verifyReleaseTag(context, (args) => {
    if (args[0] === 'cat-file') {
      assert.deepEqual(args, ['cat-file', '-t', 'refs/tags/v0.1.0'])
      return 'tag'
    }
    assert.deepEqual(args, ['rev-parse', '--verify', 'refs/tags/v0.1.0^{commit}'])
    return context.commit
  })
  assert.throws(
    () => verifyReleaseTag(context, (args) => (args[0] === 'cat-file' ? 'tag' : 'b'.repeat(40))),
    /differs from the checkout/,
  )
  assert.throws(() => verifyReleaseTag(context, () => 'commit'), /annotated release tag/)
})

test('publication source must belong to main release history', () => {
  verifyReleaseMain(context, (args) => {
    assert.deepEqual(args, [
      'merge-base',
      '--is-ancestor',
      context.commit,
      'refs/remotes/origin/main',
    ])
    return ''
  })
  assert.throws(() =>
    verifyReleaseMain(context, () => {
      throw new Error('not an ancestor')
    }),
  )
})

test('Android artifact names disclose unsigned status for both architectures and formats', () => {
  const targets = releaseTargets().filter((target) => target.kind === 'android')
  assert.equal(targets.length, 2)
  for (const target of targets) {
    assert.equal(target.signing, 'unsigned')
    for (const extension of target.extensions)
      assert.match(assetName(target, '0.1.0', extension), /-unsigned\.(?:apk|aab)$/)
  }
})

test('signed Android assets have distinct names and collection rejects the wrong signing mode', (t) => {
  const directory = fixture(t)
  const targets = buildFixtures(directory)
  for (const target of targets.filter((entry) => entry.kind === 'android')) {
    assert.equal(target.signing, 'signed')
    for (const extension of target.extensions)
      assert.doesNotMatch(assetName(target, context.version, extension), /-unsigned/)
  }
  assert.throws(
    () => collectReleaseArtifacts({ ...context, androidSigning: 'unsigned' }, directory),
    /different androidSigning/,
  )
  collectReleaseArtifacts(context, directory)
  assert.match(
    readFileSync(resolve(directory, 'dist/release/publish/release-notes.md'), 'utf8'),
    /release signing key/,
  )
})

test('unsigned candidate artifacts cannot be published', (t) => {
  const directory = fixture(t)
  const candidate = { ...context, androidSigning: 'unsigned' }
  buildFixtures(directory, candidate)
  collectReleaseArtifacts(candidate, directory)
  assert.throws(() => publishRelease(candidate, { directory }), /requires signed Android artifacts/)
})

test('userscript staging rejects stale generated metadata even when the source manifests agree', (t) => {
  const directory = fixture(t)
  const path = resolve(directory, 'stale.user.js')
  writeFileSync(path, '// ==UserScript==\n// @version 0.0.0\n// ==/UserScript==\n')
  assert.throws(
    () => stageReleaseArtifacts(releaseTargets()[0], context, { 'user.js': path }, directory),
    /Built userscript version differs/,
  )
})

test('complete collection records all targets and checksums and is repeatable', (t) => {
  const directory = fixture(t)
  const targets = buildFixtures(directory)
  const first = collectReleaseArtifacts(context, directory)
  assert.equal(first.manifest.targets.length, targets.length)
  const checksum = readFileSync(resolve(first.output, 'SHA256SUMS'), 'utf8')
  const notes = readFileSync(resolve(first.output, 'release-notes.md'), 'utf8')
  for (const target of targets) {
    for (const extension of target.extensions) {
      const filename = assetName(target, context.version, extension)
      assert(notes.includes(`| \`${filename}\` |`), `Missing release note asset: ${filename}`)
    }
  }
  assert.doesNotMatch(notes, /\\| ios \\|/i)
  assert.match(checksum, /  any-music\.user\.js\n/)
  assert.match(checksum, /  release-manifest\.json\n/)
  collectReleaseArtifacts(context, directory)
  assert.equal(readFileSync(resolve(first.output, 'SHA256SUMS'), 'utf8'), checksum)
  assert.equal(
    verifyCollectedRelease(context, directory).files.length,
    targets.reduce((count, target) => count + target.extensions.length, 3),
  )
})

for (const change of [
  'missing-target',
  'changed-bytes',
  'wrong-commit',
  'wrong-version',
  'extra-file',
]) {
  test(`release collection refuses ${change} before assembling publishable assets`, (t) => {
    const directory = fixture(t)
    buildFixtures(directory)
    const folder = resolve(directory, 'dist/release/incoming/release-windows-x64')
    const manifestPath = resolve(folder, 'artifact.json')
    const manifest = readJson(manifestPath)
    if (change === 'missing-target') rmSync(folder, { recursive: true })
    else if (change === 'changed-bytes')
      writeFileSync(resolve(folder, manifest.files[0].name), 'tampered')
    else if (change === 'extra-file') writeFileSync(resolve(folder, 'private.jks'), 'unexpected')
    else {
      if (change === 'wrong-commit') manifest.commit = 'b'.repeat(40)
      if (change === 'wrong-version') manifest.version = '9.9.9'
      writeFileSync(manifestPath, JSON.stringify(manifest))
    }
    assert.throws(() => collectReleaseArtifacts(context, directory))
  })
}

test('publishing refuses locally changed assets before any GitHub call', (t) => {
  const directory = fixture(t)
  buildFixtures(directory)
  const { output } = collectReleaseArtifacts(context, directory)
  writeFileSync(resolve(output, 'any-music.user.js'), 'modified after collection')
  assert.throws(
    () =>
      publishRelease(context, {
        directory,
        repository: 'example/any-music',
        execute: () => assert.fail('Unexpected GitHub call'),
      }),
    /Artifact was changed/,
  )
})

test('publishing refuses artifacts from an uncommitted source checkout', () => {
  assert.throws(() => publishRelease({ ...context, sourceDirty: true }), /clean source checkout/)
})

function publishingFixture(t, previous = null, release = context) {
  const directory = fixture(t)
  buildFixtures(directory, release)
  const { output } = collectReleaseArtifacts(release, directory)
  const calls = []
  const execute = (args) => {
    calls.push(args)
    if (args[0] === 'api') return args[1].includes('/compare/') ? 'ahead' : release.commit
    if (args[1] === 'view')
      return JSON.stringify({
        assets: readdirSync(output).map((name) => ({
          name,
          size: statSync(resolve(output, name)).size,
        })),
      })
    return ''
  }
  return {
    calls,
    options: { directory, repository: 'example/any-music', execute, existing: () => previous },
  }
}

test('publication creates a draft, uploads the full matrix, then exposes a stable release', (t) => {
  const { calls, options } = publishingFixture(t)
  publishRelease(context, options)
  assert(calls.find((args) => args[1] === 'create').includes('--draft'))
  assert(calls.find((args) => args[1] === 'create').includes('--notes-file'))
  assert.equal(calls.at(-1)[1], 'edit')
  assert(calls.at(-1).includes('--draft=false'))
  assert(calls.at(-1).includes('--latest=true'))
})

test('prereleases never replace the latest stable release', (t) => {
  const release = { ...context, ...parseProductVersion('0.1.1-beta.1') }
  const { calls, options } = publishingFixture(t, null, release)
  publishRelease(release, options)
  assert(calls.find((args) => args[1] === 'create').includes('--prerelease'))
  assert(calls.at(-1).includes('--latest=false'))
})

test('a draft for the same commit can resume after failure', (t) => {
  const { calls, options } = publishingFixture(t, {
    isDraft: true,
    targetCommitish: context.commit,
  })
  publishRelease(context, options)
  assert(!calls.some((args) => args[1] === 'create'))
  assert(calls.some((args) => args[1] === 'upload'))
})

for (const previous of [
  { isDraft: false, targetCommitish: context.commit },
  { isDraft: true, targetCommitish: 'b'.repeat(40) },
]) {
  test(`publication rejects ${previous.isDraft ? 'a draft for another commit' : 'overwriting a public release'}`, (t) => {
    const { calls, options } = publishingFixture(t, previous)
    assert.throws(() => publishRelease(context, options))
    assert(!calls.some((args) => ['upload', 'edit'].includes(args[1])))
  })
}

test('an incomplete remote upload leaves the release as a draft', (t) => {
  const { calls, options } = publishingFixture(t)
  const normal = options.execute
  options.execute = (args) => (args[1] === 'view' ? '{"assets":[]}' : normal(args))
  assert.throws(() => publishRelease(context, options), /Uploaded release assets/)
  assert(!calls.some((args) => args[1] === 'edit'))
})

test('moving the remote tag during upload prevents publication', (t) => {
  const { calls, options } = publishingFixture(t)
  const normal = options.execute
  let tagReads = 0
  options.execute = (args) =>
    args[0] === 'api' && args[1].includes('/commits/') && ++tagReads === 2
      ? 'b'.repeat(40)
      : normal(args)
  assert.throws(() => publishRelease(context, options), /tag moved during upload/)
  assert(!calls.some((args) => args[1] === 'edit'))
})

for (const status of ['behind', 'diverged']) {
  test(`publication rejects release history ${status} remote main before creating a draft`, (t) => {
    const { calls, options } = publishingFixture(t)
    const normal = options.execute
    options.execute = (args) => (args[1]?.includes('/compare/') ? status : normal(args))
    assert.throws(() => publishRelease(context, options), /remote main history/)
    assert(!calls.some((args) => ['create', 'upload', 'edit'].includes(args[1])))
  })
}

test('main history is checked again before publication', (t) => {
  const { calls, options } = publishingFixture(t)
  const normal = options.execute
  let reads = 0
  options.execute = (args) =>
    args[1]?.includes('/compare/') && ++reads === 2 ? 'diverged' : normal(args)
  assert.throws(() => publishRelease(context, options), /remote main history/)
  assert(!calls.some((args) => args[1] === 'edit'))
})
