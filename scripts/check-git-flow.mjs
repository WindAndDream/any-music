import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

import { protectedBranches, validatePullRequest, validatePushUpdate } from './lib/git-flow.mjs'

const git = (args) => execFileSync('git', args, { encoding: 'utf8' }).trim()
const mode = process.argv[2]
if (mode === 'commit') {
  const branch = git(['branch', '--show-current'])
  assert(branch && !protectedBranches.has(branch), 'Commit on a topic branch, then open a PR')
  git(['diff', '--cached', '--check'])
} else if (mode === 'push') {
  for (const line of readFileSync(0, 'utf8').trim().split(/\r?\n/).filter(Boolean)) {
    const [localRef, localSha, remoteRef, remoteSha] = line.split(/\s+/)
    validatePushUpdate({ localRef, localSha, remoteRef, remoteSha }, git)
  }
} else if (mode === 'pr') {
  const { pull_request: pr } = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'))
  assert(pr, 'Expected a pull_request event')
  // GitHub security updates target the default branch. Use the PR author, even on reruns.
  const dependabot =
    pr.user?.login === 'dependabot[bot]' &&
    pr.user.id === 49699333 &&
    pr.user.type === 'Bot' &&
    Number.isSafeInteger(pr.base.repo?.id) &&
    pr.head.repo?.id === pr.base.repo.id
  validatePullRequest(pr.base.ref, pr.head.ref, { dependabot })
  // Pass metadata as stdin, never as executable shell text.
  const lint = (input) => {
    // PR titles and non-merge commits must not pass through commitlint's default merge/tag ignores.
    assert.match(
      input.split('\n', 1)[0],
      /^[a-z]+(?:\([^)]+\))?!?: [\x20-\x7e]+$/,
      'Use Conventional Commits: type(scope): English subject (scope and ! are optional)',
    )
    const result = execFileSync(process.execPath, ['node_modules/@commitlint/cli/cli.js'], {
      input,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'inherit'],
    })
    if (result.trim()) console.log(result.trim())
  }
  lint(pr.title)
  const commits = git(['rev-list', '--no-merges', `${pr.base.sha}..${pr.head.sha}`])
  for (const commit of commits.split('\n').filter(Boolean))
    lint(git(['show', '-s', '--format=%B', commit]))
  console.log(`Git Flow policy passed: ${pr.head.ref} -> ${pr.base.ref}`)
} else {
  assert.fail('Usage: node scripts/check-git-flow.mjs commit|push|pr')
}
