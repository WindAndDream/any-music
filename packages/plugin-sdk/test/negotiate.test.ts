import { readFileSync } from 'node:fs'

import { expect, it } from 'vitest'

import { negotiatePluginContract } from '../src/index.ts'
import { decodeProtocolJson } from '../src/schema/index.ts'
const read = (name: string) =>
  readFileSync(new URL(`./fixtures/corpus/${name}`, import.meta.url), 'utf8')
const manifest = decodeProtocolJson('PluginManifest', read('manifest-valid.txt'))
const host = decodeProtocolJson('HostCapabilities', read('host.json'))

it('negotiates optional omissions separately from required capabilities', () => {
  const optional = decodeProtocolJson('PluginManifest', read('unknown-optional-capability.txt'))
  expect(negotiatePluginContract(optional, host)).toMatchObject({
    wireVersion: 1,
    skippedCapabilities: ['unregistered'],
  })
  expect(() => negotiatePluginContract(manifest, { ...host, capabilities: [] })).not.toThrow()
  expect(negotiatePluginContract(manifest, { ...host, capabilities: [] })).toMatchObject({
    skippedCapabilities: ['state.write'],
  })
})
it('refuses disabled execution and unavailable sandboxes', () => {
  for (const state of [
    { ...host, externalPlugins: 'none' as const },
    { ...host, sandboxAvailable: false },
    { ...host, externalPlugins: 'declarative' as const },
  ])
    expect(() => negotiatePluginContract(manifest, state)).toThrow()
})
it('rejects unsupported required extensions and records optional ones', () => {
  expect(() => negotiatePluginContract(manifest, { ...host, extensionPoints: [] })).toThrow()
  const optional = {
    ...manifest,
    contributions: manifest.contributions.map((item) => ({ ...item, required: false })),
  }
  expect(negotiatePluginContract(optional, { ...host, extensionPoints: [] })).toMatchObject({
    skippedContributions: ['summary'],
  })
})
it('does not mistake a host claim for SDK support of an unknown Profile', () => {
  expect(() =>
    negotiatePluginContract(
      { ...manifest, runtimeProfileVersion: 2 },
      { ...host, runtimeProfileVersions: [2] },
    ),
  ).toThrow()
})
