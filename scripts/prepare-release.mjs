import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { pnpmInvocation } from './lib/pnpm.mjs'
import {
  parseProductVersion,
  productManifests,
  productVersion,
  readJson,
  readReleaseConfig,
  releaseRoot,
} from './lib/release.mjs'

/** Update only application versions; SDK/crate protocol versions have independent lifecycles. */
export function prepareRelease(version, androidVersionCode, directory = releaseRoot) {
  parseProductVersion(version)
  const current = productVersion(directory)
  const config = readReleaseConfig(directory)
  const code = Number(androidVersionCode)
  assert(
    Number.isInteger(code) && code > 0 && code <= 2100000000,
    'Supply an Android versionCode between 1 and 2100000000',
  )
  assert(code >= config.android.versionCode, 'Android versionCode cannot decrease')
  if (version !== current.version)
    assert(
      code > config.android.versionCode,
      'A new product version requires a higher Android versionCode',
    )
  const updates = new Map()
  for (const path of productManifests) {
    const json = readJson(resolve(directory, path))
    json.version = version
    updates.set(path, JSON.stringify(json, null, 2) + '\n')
  }
  for (const path of ['apps/tauri/src-tauri/Cargo.toml', 'Cargo.lock']) {
    const source = readFileSync(resolve(directory, path), 'utf8')
    const pattern = /(\[\[?package\]?\]\r?\nname = "any-music-tauri"\r?\nversion = ")[^"]+("\r?\n)/g
    assert.equal([...source.matchAll(pattern)].length, 1, `Missing unique app version in ${path}`)
    updates.set(
      path,
      source.replace(pattern, (_, before, after) => before + version + after),
    )
  }
  config.android.versionCode = code
  updates.set('scripts/native-targets.json', JSON.stringify(config, null, 2) + '\n')
  // Validate every input before writing so argument mistakes leave the checkout unchanged.
  for (const [path, content] of updates) writeFileSync(resolve(directory, path), content)
  console.log(
    `Prepared v${version} (Android versionCode ${code}). Review and commit before tagging.`,
  )
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  assert.equal(process.argv.length, 4, 'Usage: pnpm release:prepare VERSION ANDROID_VERSION_CODE')
  prepareRelease(process.argv[2], process.argv[3])
  const format = pnpmInvocation([
    'exec',
    'oxfmt',
    ...productManifests,
    'scripts/native-targets.json',
  ])
  execFileSync(format.command, format.args, { cwd: releaseRoot, stdio: 'inherit' })
}
