import assert from 'node:assert/strict'

import { parseProductVersion } from './release.mjs'

const topic = /^(?:feature|fix|hotfix)\/[a-z0-9]+(?:[/-][a-z0-9]+)*$/
const release =
  /^release\/(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[a-z0-9]+(?:[.-][a-z0-9]+)*)?$/
export const protectedBranches = new Set(['main', 'develop'])

export function isTopicBranch(branch) {
  return topic.test(branch) || release.test(branch)
}

/** Validate PR direction independently of GitHub credentials or native/product runtimes. */
export function validatePullRequest(base, head, { dependabot = false } = {}) {
  assert(base !== head, 'A pull request must connect different branches')
  if (dependabot && base === 'main' && /^dependabot\/.+/u.test(head)) return
  assert(isTopicBranch(head) || head === 'main', 'Use feature/*, fix/*, release/* or hotfix/*')
  const kind = head.split('/')[0]
  const allowed =
    base === 'main'
      ? kind === 'release' || kind === 'hotfix'
      : base === 'develop'
        ? ['feature', 'fix', 'release', 'hotfix', 'main'].includes(kind)
        : release.test(base) && ['fix', 'hotfix', 'main'].includes(kind)
  assert(allowed, `Disallowed Git Flow route: ${head} -> ${base}`)
}

/** Git passes complete ref updates to pre-push; reject every protected ref in a multi-ref push. */
export function validatePushUpdate({ localRef, localSha, remoteRef, remoteSha }, git) {
  const deleting = /^0+$/.test(localSha)
  const existing = !/^0+$/.test(remoteSha)
  if (remoteRef.startsWith('refs/heads/')) {
    const branch = remoteRef.slice('refs/heads/'.length)
    assert(!protectedBranches.has(branch), `Push ${branch} through an approved pull request`)
    assert(isTopicBranch(branch), `Unsupported topic branch: ${branch}`)
    if (existing && !deleting) git(['merge-base', '--is-ancestor', remoteSha, localSha])
  } else if (remoteRef.startsWith('refs/tags/')) {
    assert(!deleting && !existing, 'Published tags cannot be deleted or moved')
    assert(remoteRef.startsWith('refs/tags/v'), 'Release tags use vVERSION')
    parseProductVersion(remoteRef.slice('refs/tags/v'.length))
    assert.equal(git(['cat-file', '-t', localSha]).trim(), 'tag', 'Use an annotated release tag')
    const commit = git(['rev-parse', `${localRef}^{commit}`]).trim()
    git(['merge-base', '--is-ancestor', commit, 'refs/remotes/origin/main'])
  } else {
    assert.fail(`Unsupported push ref: ${remoteRef}`)
  }
}
