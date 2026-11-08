import assert from 'node:assert/strict'
import { appendFileSync } from 'node:fs'

import {
  readReleaseConfig,
  releaseContext,
  verifyReleaseMain,
  verifyReleaseTag,
} from './lib/release.mjs'

assert.equal(process.argv.length, 2, 'Use AM_RELEASE_TAG to check an existing version tag')
const context = releaseContext()
const config = readReleaseConfig()
if (process.env.AM_RELEASE_REQUIRE_TAG === 'true')
  assert(process.env.AM_RELEASE_TAG, 'Publishing requires an explicit vVERSION tag')
if (process.env.AM_RELEASE_WORKFLOW_TAG)
  assert.equal(
    process.env.AM_RELEASE_WORKFLOW_TAG,
    context.tag,
    'Run publishing from the matching version tag',
  )
if (process.env.AM_RELEASE_TAG) {
  verifyReleaseTag(context)
  verifyReleaseMain(context)
}
const outputs = {
  ...context,
  publish: process.env.AM_RELEASE_REQUIRE_TAG === 'true',
  desktop: JSON.stringify({ include: config.releases }),
  android: JSON.stringify({
    include: config.android.targets.map((target) => ({ ...target, runner: config.android.runner })),
  }),
  rust: config.releaseToolchain,
  msrv: config.msrv,
  java: config.android.javaVersion,
  sdk: config.android.sdk,
  'build-tools': config.android.buildTools,
  ndk: config.android.ndk,
}
if (process.env.GITHUB_OUTPUT) {
  for (const [key, value] of Object.entries(outputs))
    appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`)
}
console.log(`Release versions agree: ${context.tag}, commit ${context.commit}`)
