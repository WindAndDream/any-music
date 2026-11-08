import assert from 'node:assert/strict'

import { collectReleaseArtifacts } from './lib/release-artifacts.mjs'
import { releaseContext } from './lib/release.mjs'

assert.equal(process.argv.length, 2, 'Usage: pnpm release:collect')
const { output, manifest } = collectReleaseArtifacts(releaseContext())
console.log(`Verified all ${manifest.targets.length} release targets: ${output}`)
