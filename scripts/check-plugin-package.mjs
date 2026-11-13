import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

import {
  INTEGRITY_DOMAIN,
  verifySignature,
  verifyPackage,
} from '../packages/plugin-sdk/scripts/package-format.mjs'

const corpus = JSON.parse(
  readFileSync(
    new URL('../packages/plugin-sdk/test/fixtures/packages/corpus.json', import.meta.url),
    'utf8',
  ),
)
for (const entry of corpus) {
  const bytes = Buffer.from(entry.base64, 'base64')
  if (entry.ok) assert(verifyPackage(bytes).contentHash)
  else
    assert.throws(
      () => verifyPackage(bytes),
      (error) => error.message === entry.error,
      entry.name,
    )
}
const vector = JSON.parse(
  execFileSync(
    'cargo',
    ['run', '--quiet', '-p', 'am-plugin-package', '--example', 'signing-vector', '--locked'],
    { encoding: 'utf8' },
  ),
)
assert.equal(
  verifySignature(INTEGRITY_DOMAIN, Buffer.from(vector.raw), vector.envelope),
  vector.envelope.fingerprint,
)
console.log(
  `Node/Rust package format: ${corpus.length} shared cases; Rust→Node ephemeral Ed25519 vector verified.`,
)
