import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { validatePullRequest, validatePushUpdate } from '../lib/git-flow.mjs'

test('PR policy validates event metadata and does not ignore merge-like titles', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'any-music-pr-policy-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  const eventPath = join(directory, 'event.json')
  const root = fileURLToPath(new URL('../../', import.meta.url))
  const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
  for (const [title, base, expected] of [
    ['fix: preserve literal $(text) in titles', 'develop', 0],
    ['feat(music-workbench): add collection browsing', 'develop', 0],
    ['refactor(core)!: require stable source identities', 'develop', 0],
    ['feat!: require stable source identities', 'develop', 0],
    ['Merge unreviewed changes', 'develop', 1],
    ["Merge branch 'develop' into feature/policy-fixture", 'develop', 1],
    ['v0.2.0', 'develop', 1],
    ['[fix]: reject legacy brackets', 'develop', 1],
    ['fix: 中文说明', 'develop', 1],
    ['fix(资料库): reject non-ASCII scope', 'develop', 1],
    ['unknown: invalid type', 'develop', 1],
    ['dev: use a specific change type', 'develop', 1],
    ['fix(UI): reject uppercase scope', 'develop', 1],
    ['fix: reject final period.', 'develop', 1],
    [`fix: ${'a'.repeat(96)}`, 'develop', 1],
    ['fix: skip release review', 'main', 1],
  ]) {
    writeFileSync(
      eventPath,
      JSON.stringify({
        pull_request: {
          title,
          base: { ref: base, sha },
          head: { ref: 'feature/policy-fixture', sha },
        },
      }),
    )
    const result = spawnSync(process.execPath, ['scripts/check-git-flow.mjs', 'pr'], {
      cwd: root,
      env: { ...process.env, GITHUB_EVENT_PATH: eventPath },
      encoding: 'utf8',
    })
    assert.equal(result.status, expected, `${title}: ${result.stdout}\n${result.stderr}`)
  }
})

test('only same-repository Dependabot PRs get the dependency update route to main', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'any-music-dependabot-policy-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  const eventPath = join(directory, 'event.json')
  const root = fileURLToPath(new URL('../../', import.meta.url))
  const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
  const bot = { login: 'dependabot[bot]', id: 49699333, type: 'Bot' }
  const pr = {
    title: 'build(deps): bump a workspace dependency',
    user: bot,
    base: { ref: 'main', sha, repo: { id: 1 } },
    head: { ref: 'dependabot/npm_and_yarn/workspace-1.2.3', sha, repo: { id: 1 } },
  }
  for (const [label, overrides, expected] of [
    ['bot', {}, 0],
    ['different user', { user: { ...bot, id: 2 } }, 1],
    ['different repo', { head: { ...pr.head, repo: { id: 2 } } }, 1],
    ['missing repo', { head: { ...pr.head, repo: null } }, 1],
    ['different base', { base: { ...pr.base, ref: 'develop' } }, 1],
    ['ordinary branch', { head: { ...pr.head, ref: 'fix/ordinary' } }, 1],
    ['invalid title', { title: 'Unformatted title' }, 1],
  ]) {
    writeFileSync(eventPath, JSON.stringify({ pull_request: { ...pr, ...overrides } }))
    const result = spawnSync(process.execPath, ['scripts/check-git-flow.mjs', 'pr'], {
      cwd: root,
      env: { ...process.env, GITHUB_EVENT_PATH: eventPath },
      encoding: 'utf8',
    })
    assert.equal(result.status, expected, `${label}: ${result.stdout}\n${result.stderr}`)
  }
})

test('Git Flow accepts development, release, emergency and back-merge routes', () => {
  for (const [base, head] of [
    ['develop', 'feature/42-virtual-lists'],
    ['develop', 'fix/cache'],
    ['main', 'release/0.2.0'],
    ['main', 'hotfix/43-playback'],
    ['develop', 'release/0.2.0'],
    ['develop', 'hotfix/43-playback'],
    ['develop', 'main'],
    ['release/0.2.0', 'fix/44-installer'],
    ['release/0.2.0', 'hotfix/43-playback'],
    ['release/0.2.0', 'main'],
  ])
    validatePullRequest(base, head)
})

test('Git Flow rejects shortcuts into production and feature changes during freeze', () => {
  for (const [base, head] of [
    ['main', 'develop'],
    ['main', 'feature/new-ui'],
    ['main', 'fix/ordinary'],
    ['release/0.2.0', 'feature/new-ui'],
    ['feature/a', 'feature/b'],
    ['develop', 'dev'],
    ['develop', 'feature/Bad_Name'],
    ['main', 'main'],
    ['main', 'release/latest'],
    ['develop', 'release/01.2.0'],
  ])
    assert.throws(() => validatePullRequest(base, head))
})

test('push guards reject protected updates/deletion, shared-history rewrites and tag moves', () => {
  const update = {
    localRef: 'refs/heads/feature/a',
    remoteRef: 'refs/heads/feature/a',
    localSha: 'a'.repeat(40),
    remoteSha: '0'.repeat(40),
  }
  const unexpectedGit = () => assert.fail('A rejected ref must not invoke git')
  for (const branch of ['main', 'develop']) {
    assert.throws(() =>
      validatePushUpdate({ ...update, remoteRef: `refs/heads/${branch}` }, unexpectedGit),
    )
    assert.throws(() =>
      validatePushUpdate(
        { ...update, remoteRef: `refs/heads/${branch}`, localSha: '0'.repeat(40) },
        unexpectedGit,
      ),
    )
  }
  validatePushUpdate(update, unexpectedGit)
  assert.throws(() =>
    validatePushUpdate({ ...update, remoteSha: 'b'.repeat(40) }, () => {
      throw new Error('not an ancestor')
    }),
  )
  assert.throws(() =>
    validatePushUpdate(
      { ...update, remoteRef: 'refs/tags/v0.2.0', remoteSha: 'b'.repeat(40) },
      unexpectedGit,
    ),
  )
  assert.throws(() =>
    validatePushUpdate(
      { ...update, remoteRef: 'refs/tags/v0.2.0', localSha: '0'.repeat(40) },
      unexpectedGit,
    ),
  )
})

test('tag pushes require annotated tags whose peeled commit belongs to main', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'any-music-git-flow-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  const git = (args) =>
    execFileSync('git', args, {
      cwd: directory,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim()
  git(['init', '--initial-branch=main'])
  git(['config', 'user.name', 'Workflow fixture'])
  git(['config', 'user.email', 'fixture@example.invalid'])
  writeFileSync(join(directory, 'fixture'), 'main')
  git(['add', '.'])
  git(['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', 'commit', '-m', 'fixture'])
  git(['update-ref', 'refs/remotes/origin/main', 'HEAD'])
  git(['-c', 'tag.gpgsign=false', 'tag', '-a', 'v0.2.0', '-m', 'fixture'])
  const update = {
    localRef: 'refs/tags/v0.2.0',
    localSha: git(['rev-parse', 'v0.2.0']),
    remoteRef: 'refs/tags/v0.2.0',
    remoteSha: '0'.repeat(40),
  }
  validatePushUpdate(update, git)
  assert.throws(
    () => validatePushUpdate({ ...update, localSha: git(['rev-parse', 'HEAD']) }, git),
    /annotated/,
  )
  git(['switch', '-c', 'feature/unreleased'])
  git([
    '-c',
    'core.hooksPath=/dev/null',
    '-c',
    'commit.gpgsign=false',
    'commit',
    '--allow-empty',
    '-m',
    'unreleased',
  ])
  git(['-c', 'tag.gpgsign=false', 'tag', '-a', 'v0.3.0', '-m', 'unreleased'])
  assert.throws(() =>
    validatePushUpdate(
      {
        ...update,
        localRef: 'refs/tags/v0.3.0',
        localSha: git(['rev-parse', 'v0.3.0']),
        remoteRef: 'refs/tags/v0.3.0',
      },
      git,
    ),
  )
})
