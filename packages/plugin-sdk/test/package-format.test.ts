import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

// @ts-expect-error Node tooling entry is deliberately outside the browser SDK type graph.
import { verifyPackage, verifySignature, INTEGRITY_DOMAIN } from '../scripts/package-format.mjs'

const corpus: { name: string; ok: boolean; error?: string; base64: string }[] = JSON.parse(
  readFileSync(new URL('./fixtures/packages/corpus.json', import.meta.url), 'utf8'),
)
describe('shared package corpus', () => {
  for (const entry of corpus)
    it(entry.name, () => {
      const bytes = Buffer.from(entry.base64, 'base64')
      if (entry.ok) expect(verifyPackage(bytes).contentHash).toMatch(/^[a-f0-9]{64}$/)
      else expect(() => verifyPackage(bytes)).toThrow(entry.error)
    })
  it('signs exact raw integrity bytes and a fixed domain', () => {
    const golden = JSON.parse(
      readFileSync(new URL('./fixtures/packages/golden.json', import.meta.url), 'utf8'),
    )
    const raw = Buffer.from(golden.raw, 'base64')
    expect(verifySignature(INTEGRITY_DOMAIN, raw, golden.envelope)).toBe(
      golden.envelope.fingerprint,
    )
    expect(() => verifySignature(Buffer.from('wrong'), raw, golden.envelope)).toThrow()
    expect(() =>
      verifySignature(INTEGRITY_DOMAIN, Buffer.concat([raw, Buffer.from(' ')]), golden.envelope),
    ).toThrow()
  })
})
