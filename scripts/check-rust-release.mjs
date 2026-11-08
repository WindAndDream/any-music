import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const matrix = JSON.parse(readFileSync(new URL('./native-targets.json', import.meta.url), 'utf8'))
const host = execFileSync('rustc', ['-vV'], { encoding: 'utf8' })
  .match(/^host: (.+)$/m)?.[1]
  .trim()
const releases = matrix.releases.filter((release) => release.target === host)
assert(
  releases.length,
  `No declared native release configuration for ${host}; add and verify its target/features explicitly`,
)
for (const release of releases) {
  const args = ['check', '--release', '--locked', '-p', release.package, '--target', release.target]
  if (!release.defaultFeatures) args.push('--no-default-features')
  if (release.features.length) args.push('--features', release.features.join(','))
  execFileSync('cargo', args, {
    cwd: fileURLToPath(new URL('../', import.meta.url)),
    stdio: 'inherit',
  })
}
