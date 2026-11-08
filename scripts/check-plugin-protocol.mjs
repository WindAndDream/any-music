import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { negotiatePluginContract } from '../packages/plugin-sdk/src/index.ts'
import { decodeProtocolJson } from '../packages/plugin-sdk/src/schema/index.ts'

const root = fileURLToPath(new URL('../', import.meta.url))
const directory = new URL('../packages/plugin-sdk/test/fixtures/corpus/', import.meta.url)
const fixtures = JSON.parse(readFileSync(new URL('index.json', directory), 'utf8'))
const host = decodeProtocolJson(
  'HostCapabilities',
  readFileSync(new URL('host.json', directory), 'utf8'),
)
const cases = fixtures.map((item) => ({
  id: item.id,
  schema: item.schema,
  source: readFileSync(new URL(item.file, directory), 'utf8'),
  ...(item.stage === 'negotiate' ? { host } : {}),
  expected: item.accepted,
}))
const manifest = JSON.parse(cases.find((item) => item.id === 'manifest-valid').source)
const add = (id, schema, source, options = {}) => cases.push({ id, schema, source, ...options })
// Boundary mutations use the same bytes in both languages, beyond the fixed S01 corpus.
for (const [id, suffix] of [
  ['astral-limit', '🎵'.repeat(128)],
  ['astral-over-limit', '🎵'.repeat(129)],
])
  add(id, 'MusicListingInput', JSON.stringify({ listingRef: suffix }))
for (const token of [
  '0',
  '-0',
  '1.0',
  '1e0',
  '01',
  '+1',
  '9007199254740991',
  '9007199254740992',
  '-9007199254740991',
  '-9007199254740992',
])
  add(
    `integer:${token}`,
    'PluginTask',
    `{"taskId":"t","contextRef":"c","deadlineMs":${token},"state":"running","completed":0}`,
  )
for (const source of [
  '{}{}',
  '\ufeff{}',
  '{"listingRef":"\\uD800"}',
  '{"listingRef":"\\uDC00"}',
  '{"listingRef":"\\uD83C\\uDFB5"}',
  '{"listingRef":"one","listing\\u0052ef":"two"}',
  '{"listingRef":null}',
  '{"listingRef":"ok",}',
  '{"listingRef":"ok"} trailing',
])
  add(`json:${source}`, 'MusicListingInput', source)
for (const externalPlugins of ['none', 'declarative', 'sandbox-code'])
  for (const sandboxAvailable of [false, true])
    for (const form of ['desktop', 'mobile'])
      add(
        `host:${externalPlugins}/${sandboxAvailable}/${form}`,
        'PluginManifest',
        JSON.stringify(manifest),
        { host: { ...host, externalPlugins, sandboxAvailable, form } },
      )
for (const minimum of ['0.0.0', '0.1.0', '0.2.0', '00.1.0', '1.0', '1.0.0-beta', '9999999.0.0'])
  add(
    `sdk:${minimum}`,
    'PluginManifest',
    JSON.stringify({ ...manifest, sdk: { minimum, maximumExclusive: '1.0.0' } }),
    { host },
  )
for (const required of [false, true])
  add(
    `contribution:${required}`,
    'PluginManifest',
    JSON.stringify({ ...manifest, contributions: [{ ...manifest.contributions[0], required }] }),
    { host: { ...host, extensionPoints: [] } },
  )

// Generate structural valid/invalid pairs for every published definition. This catches DTO
// generation drift outside the initial manifest/request slice without another Schema source.
const schema = JSON.parse(
  readFileSync(
    new URL('../packages/plugin-sdk/schema/v1/protocol.schema.json', import.meta.url),
    'utf8',
  ),
)
function sample(node) {
  if (node.$ref) return sample(schema.$defs[node.$ref.slice(8)])
  if ('const' in node) return node.const
  if (node.enum) return node.enum[0]
  if (node.oneOf) return sample(node.oneOf[0])
  if (node.type === 'object')
    return Object.fromEntries(
      (node.required ?? []).map((key) => [key, sample(node.properties[key])]),
    )
  if (node.type === 'array')
    return Array.from({ length: node.minItems ?? 0 }, () => sample(node.items))
  if (node.type === 'string') return 'a'.repeat(node.minLength ?? 1)
  if (node.type === 'number' || node.type === 'integer') return node.minimum ?? 0
  if (node.type === 'boolean') return false
  if (node.type === 'null') return null
  throw new Error('Unsupported corpus sampler')
}
for (const [name, definition] of Object.entries(schema.$defs)) {
  const value = sample(definition)
  add(`generated:${name}`, name, JSON.stringify(value))
  add(`unknown-field:${name}`, name, JSON.stringify({ ...value, forgedAuthority: true }))
}

const expected = cases.map((item) => {
  try {
    const value = decodeProtocolJson(item.schema, item.source)
    const result = item.host
      ? { accepted: true, contract: negotiatePluginContract(value, item.host) }
      : { accepted: true, value }
    if ('expected' in item) assert.equal(true, item.expected, item.id)
    return result
  } catch (error) {
    if (error instanceof assert.AssertionError) throw error
    if ('expected' in item) assert.equal(false, item.expected, item.id)
    return { accepted: false }
  }
})
execFileSync('cargo', ['build', '-p', 'am-plugin-policy', '--example', 'corpus', '--locked'], {
  cwd: root,
  stdio: ['ignore', 'ignore', 'inherit'],
})
const metadata = JSON.parse(
  execFileSync('cargo', ['metadata', '--no-deps', '--format-version', '1', '--locked'], {
    cwd: root,
    encoding: 'utf8',
  }),
)
const binary = `${metadata.target_directory}/debug/examples/corpus${process.platform === 'win32' ? '.exe' : ''}`
const result = spawnSync(binary, [], {
  cwd: root,
  input: JSON.stringify(
    cases.map((item) => ({ schema: item.schema, source: item.source, host: item.host })),
  ),
  encoding: 'utf8',
  maxBuffer: 32 * 1024 * 1024,
})
assert.equal(result.status, 0, result.stderr)
const actual = JSON.parse(result.stdout)
assert.equal(actual.length, expected.length)
cases.forEach((item, index) => assert.deepEqual(actual[index], expected[index], item.id))
console.log(
  `TS/Rust protocol differential passed: ${fixtures.length} shared raw fixtures + ${cases.length - fixtures.length} boundary/schema/negotiation cases (${cases.length} total).`,
)
