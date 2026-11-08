import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../../', import.meta.url))
const lint = (input) =>
  spawnSync(process.execPath, ['node_modules/@commitlint/cli/cli.js'], {
    cwd: root,
    input,
    encoding: 'utf8',
  })

test('commit-msg configuration accepts conventional types, scopes and breaking changes', () => {
  const types = [
    'feat',
    'fix',
    'docs',
    'style',
    'refactor',
    'perf',
    'test',
    'build',
    'ci',
    'chore',
    'revert',
  ]
  const messages = [
    ...types.map((type) => `${type}: describe a coherent change`),
    'fix(music-workbench): preserve IPC and AppErrorState details',
    'feat!: require stable source identities',
    'refactor(core)!: require stable source identities',
    'refactor(core): require stable source identities\n\nBREAKING CHANGE: callers must supply source IDs',
    'refactor(core)!: require stable source identities\n\nBREAKING CHANGE: callers must supply source IDs',
    'fix(tauri): cancel stale reads\n\nAbort the previous request before switching tracks.\n\nCloses #42',
    `fix: ${'a'.repeat(95)}`,
  ]
  for (const input of messages) {
    const result = lint(input)
    assert.equal(result.status, 0, `${input}: ${result.stdout}\n${result.stderr}`)
  }
})

test('commit-msg configuration rejects legacy headers and invalid conventional messages', () => {
  for (const input of [
    '[feat]: reject legacy brackets',
    '[fix] reject legacy brackets',
    'dev: use a specific change type',
    'unknown: reject unknown types',
    'Feat: reject uppercase type',
    'fix(UI): reject uppercase scope',
    'fix(musicWorkbench): reject camelCase scope',
    'fix(资料库): reject non-ASCII scope',
    'fix: 中文说明',
    'fix: ',
    'fix: reject final period.',
    'fix:reject missing separator space',
    `fix: ${'a'.repeat(96)}`,
  ]) {
    const result = lint(input)
    assert.notEqual(result.status, 0, `${input}: ${result.stdout}\n${result.stderr}`)
  }
})

test('commit-msg configuration preserves generated Git merge messages', () => {
  const result = lint("Merge branch 'develop' into feature/policy-fixture")
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
})
