import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// Both guards need the same Git pre-push input; do not let the first consume it.
const input = readFileSync(0)
const root = fileURLToPath(new URL('../', import.meta.url))
for (const args of [
  ['scripts/check-git-flow.mjs', 'push'],
  ['scripts/check-privacy.mjs', 'push', process.argv[2] ?? 'origin'],
]) {
  const result = spawnSync(process.execPath, args, {
    cwd: root,
    input,
    stdio: ['pipe', 'inherit', 'inherit'],
  })
  if (result.error || result.status !== 0) {
    process.exitCode = result.status || 1
    break
  }
}
