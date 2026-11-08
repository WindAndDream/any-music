import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { statSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { verifyCollectedRelease } from './lib/release-artifacts.mjs'
import { gitOutput, releaseContext, releaseRoot } from './lib/release.mjs'

function gh(args) {
  return execFileSync('gh', args, {
    cwd: releaseRoot,
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
  }).trim()
}

export function existingRelease(tag, repository) {
  const result = spawnSync(
    'gh',
    ['release', 'view', tag, '--repo', repository, '--json', 'isDraft,targetCommitish'],
    { encoding: 'utf8' },
  )
  if (result.error) throw result.error
  if (result.status === 0) return JSON.parse(result.stdout)
  // Authentication, rate limiting and network failures must never be treated as absence.
  assert(
    /release not found/i.test(result.stderr),
    `Cannot inspect existing release: ${result.stderr}`,
  )
  return null
}

/** Only drafts for this exact commit can be resumed; published releases are immutable here. */
export function publishRelease(
  context,
  {
    directory = releaseRoot,
    repository = process.env.GITHUB_REPOSITORY,
    execute = gh,
    existing = existingRelease,
  } = {},
) {
  assert.equal(context.sourceDirty, false, 'Publishing requires a clean source checkout')
  assert.equal(context.androidSigning, 'signed', 'Publishing requires signed Android artifacts')
  assert(/^[\w.-]+\/[\w.-]+$/.test(repository ?? ''), 'Expected GITHUB_REPOSITORY owner/name')
  const { output, files } = verifyCollectedRelease(context, directory)
  const tagRef = encodeURIComponent(`refs/tags/${context.tag}`)
  const tagCommit = execute(['api', `repos/${repository}/commits/${tagRef}`, '--jq', '.sha'])
  assert.equal(tagCommit, context.commit, 'Remote release tag moved after the build')
  const verifyMain = () => {
    const status = execute([
      'api',
      `repos/${repository}/compare/${context.commit}...main`,
      '--jq',
      '.status',
    ]).trim()
    assert(
      ['ahead', 'identical'].includes(status),
      'Release commit must belong to remote main history',
    )
  }
  verifyMain()
  const previous = existing(context.tag, repository)
  if (previous) {
    assert.equal(
      previous.isDraft,
      true,
      'A published release cannot be overwritten; use a new version',
    )
    assert.equal(
      previous.targetCommitish,
      context.commit,
      'Draft release belongs to a different commit',
    )
  } else {
    execute([
      'release',
      'create',
      context.tag,
      '--repo',
      repository,
      '--verify-tag',
      '--draft',
      '--target',
      context.commit,
      '--title',
      `Any Music ${context.tag}`,
      '--notes-file',
      resolve(output, 'release-notes.md'),
      '--generate-notes',
      ...(context.prerelease ? ['--prerelease'] : []),
    ])
  }
  execute([
    'release',
    'upload',
    context.tag,
    '--repo',
    repository,
    '--clobber',
    ...files.map((name) => resolve(output, name)),
  ])
  const assets = JSON.parse(
    execute(['release', 'view', context.tag, '--repo', repository, '--json', 'assets']),
  )
  assert.deepEqual(
    assets.assets.map((entry) => entry.name).toSorted(),
    files,
    'Uploaded release assets are incomplete or unexpected',
  )
  for (const asset of assets.assets)
    assert.equal(
      asset.size,
      statSync(resolve(output, asset.name)).size,
      `Uploaded asset size differs: ${asset.name}`,
    )
  // Recheck the remote tag at the commit point; failed uploads/checks leave a draft.
  assert.equal(
    execute(['api', `repos/${repository}/commits/${tagRef}`, '--jq', '.sha']),
    context.commit,
    'Remote release tag moved during upload',
  )
  verifyMain()
  execute([
    'release',
    'edit',
    context.tag,
    '--repo',
    repository,
    '--draft=false',
    `--prerelease=${context.prerelease}`,
    `--latest=${!context.prerelease}`,
  ])
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  assert.equal(process.argv.length, 2, 'Publishing uses the prepared release environment')
  assert(process.env.GH_TOKEN, 'The publishing job must provide GH_TOKEN')
  assert.equal(
    gitOutput(['status', '--porcelain', '--untracked-files=no']),
    '',
    'Release checkout has tracked changes',
  )
  publishRelease(releaseContext())
}
