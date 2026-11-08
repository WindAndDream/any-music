// Rebuilding signed vectors generates an ephemeral key in memory; private material is never saved.
import { generateKeyPairSync, sign } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { deflateRawSync } from 'node:zlib'

import {
  crc32,
  hash,
  INTEGRITY_DOMAIN,
  REVOCATION_DOMAIN,
  verifyPackage,
} from '../scripts/package-format.mjs'
const root = new URL('./fixtures/packages/', import.meta.url)
mkdirSync(root, { recursive: true })
const manifest = JSON.parse(
  readFileSync(new URL('./fixtures/corpus/manifest-valid.txt', import.meta.url), 'utf8'),
)
manifest.commands = []
manifest.contributions = []
manifest.activationEvents = []
manifest.capabilities = [
  {
    id: 'state.write',
    version: 1,
    required: false,
    reason: { 'zh-CN': '自身存储', en: 'Own state' },
  },
]
const bytes = (value) => Buffer.from(typeof value === 'string' ? value : JSON.stringify(value))
const base = () =>
  new Map([
    ['manifest.json', bytes(manifest)],
    ['dist/main.js', bytes('export default { activate() {} }')],
  ])
export function zip(files, options = {}) {
  const local = [],
    central = []
  let offset = 0
  for (const [path, value] of files) {
    const name = Buffer.from(path),
      compressed = options.deflate ? deflateRawSync(value) : value
    const header = Buffer.alloc(30)
    header.writeUInt32LE(0x04034b50)
    header.writeUInt16LE(20, 4)
    header.writeUInt16LE(0x800, 6)
    header.writeUInt16LE(options.deflate ? 8 : 0, 8)
    header.writeUInt32LE(crc32(value), 14)
    header.writeUInt32LE(compressed.length, 18)
    header.writeUInt32LE(value.length, 22)
    header.writeUInt16LE(name.length, 26)
    local.push(header, name, compressed)
    const directory = Buffer.alloc(46)
    directory.writeUInt32LE(0x02014b50)
    directory.writeUInt16LE(0x314, 4)
    directory.writeUInt16LE(20, 6)
    header.copy(directory, 8, 6, 26)
    directory.writeUInt16LE(name.length, 28)
    directory.writeUInt32LE((0o100644 << 16) >>> 0, 38)
    directory.writeUInt32LE(offset, 42)
    central.push(directory, name)
    offset += header.length + name.length + compressed.length
  }
  const dir = Buffer.concat(central),
    end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50)
  end.writeUInt16LE(files.size, 8)
  end.writeUInt16LE(files.size, 10)
  end.writeUInt32LE(dir.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...local, dir, end])
}
const seal = (files) => {
  files.set(
    'integrity.json',
    bytes({
      version: 1,
      files: [...files].map(([path, data]) => ({ path, size: data.length, sha256: hash(data) })),
    }),
  )
  return files
}
// Deterministic unsigned gateway fixture is also consumed by native host/Gate tests.
const gatewayManifest = readFileSync(
  new URL('./fixtures/corpus/source-auth-valid.txt', import.meta.url),
)
const gateway = zip(seal(new Map([['manifest.json', gatewayManifest]])))
verifyPackage(gateway)
writeFileSync(
  new URL('source-gateway.json', root),
  JSON.stringify({ base64: gateway.toString('base64') }, null, 2) + '\n',
)
const { publicKey, privateKey } = generateKeyPairSync('ed25519')
const publicHex = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('hex')
const signed = seal(base()),
  raw = signed.get('integrity.json')
const envelope = {
  version: 1,
  algorithm: 'Ed25519',
  keyId: 'ephemeral-test-publisher',
  publicKey: publicHex,
  fingerprint: hash(Buffer.from(publicHex, 'hex')),
  signature: sign(null, Buffer.concat([INTEGRITY_DOMAIN, raw]), privateKey).toString('hex'),
}
signed.set('signature.json', bytes(envelope))
const cases = []
const add = (name, input, expectedOk = false) => {
  let error
  try {
    verifyPackage(input)
  } catch (e) {
    error = e.message
  }
  if (!error !== expectedOk) throw new Error(`Unexpected corpus outcome: ${name}: ${error}`)
  cases.push({ name, ok: !error, ...(error ? { error } : {}), base64: input.toString('base64') })
}
add('unsigned-store', zip(seal(base())), true)
add('unsigned-deflate', zip(seal(base()), { deflate: true }), true)
add('signed-golden', zip(signed), true)
const signedUpdate = base()
signedUpdate.set('manifest.json', bytes({ ...manifest, version: '0.1.1' }))
signedUpdate.set('dist/main.js', bytes('export default { activate() { return 2 } }'))
seal(signedUpdate)
signedUpdate.set(
  'signature.json',
  bytes({
    ...envelope,
    signature: sign(
      null,
      Buffer.concat([INTEGRITY_DOMAIN, signedUpdate.get('integrity.json')]),
      privateKey,
    ).toString('hex'),
  }),
)
add('signed-update', zip(signedUpdate), true)
const weak = seal(base()),
  weakKey = '01' + '00'.repeat(31)
weak.set(
  'signature.json',
  bytes({
    ...envelope,
    publicKey: weakKey,
    fingerprint: hash(Buffer.from(weakKey, 'hex')),
    signature: weakKey + '00'.repeat(32),
  }),
)
add('weak-public-key', zip(weak))
const declarative = base()
declarative.delete('dist/main.js')
const dm = { ...manifest, execution: 'declarative' }
delete dm.entry
declarative.set('manifest.json', bytes(dm))
add('declarative', zip(seal(declarative)), true)
for (const path of [
  '../manifest.json',
  '/assets/a.json',
  'C:/assets/a.json',
  'assets/a:b.json',
  'assets/CON.json',
  'assets/com¹.json',
  'assets/a./b.json',
  'assets/a\\b.json',
  'assets/e\u0301.json',
  'assets/a.svg',
  'assets/a.html',
  'assets/a.wasm',
  'assets/a.js',
  'assets/a.zip',
  ...Array.from({ length: 1 }, () => `assets/${'a/'.repeat(8)}x.json`),
]) {
  const files = base()
  files.set(path, bytes('{}'))
  add(`path-${path}`, zip(seal(files)))
}
for (const [a, b] of [
  ['assets/A.json', 'assets/a.json'],
  ['assets/K.json', 'assets/K.json'],
]) {
  const files = base()
  files.set(a, bytes('{}'))
  files.set(b, bytes('{}'))
  add(`collision-${a}`, zip(seal(files)))
}
for (const [name, change] of [
  ['hash-mismatch', (f) => f.set('dist/main.js', bytes('changed'))],
  ['missing-entry', (f) => f.delete('dist/main.js')],
  ['unlisted-payload', (f) => f.set('assets/unlisted.json', bytes('{}'))],
  ['duplicate-json', (f) => f.set('integrity.json', bytes('{"version":1,"version":1,"files":[]}'))],
  [
    'wrong-signature',
    (f) => f.set('signature.json', bytes({ ...envelope, signature: '00'.repeat(64) })),
  ],
  [
    'signature-reserialize',
    (f) => f.set('integrity.json', bytes(JSON.stringify(JSON.parse(raw), null, 2))),
  ],
]) {
  const files = new Map(signed)
  change(files)
  add(name, zip(files))
}
for (const [name, path, data] of [
  ['remote-map', 'dist/main.js', '//# sourceMappingURL=https://evil.invalid/a.map'],
  ['map-sources', 'dist/main.js.map', '{"sources":["https://evil.invalid/a.js"]}'],
  ['fake-image', 'assets/a.png', 'not an image'],
]) {
  const files = base()
  files.set(path, bytes(data))
  add(name, zip(seal(files)))
}
// Exercise complete directive values in both verifiers, including suffix-masked remote URLs.
for (const [name, code, expectedOk] of [
  ['source-map-local', '//# sourceMappingURL=main.js.map', true],
  ['source-map-local-crlf', 'export default {}\r\n//# sourceMappingURL=main.js.map \t\r\n', true],
  ['source-map-local-legacy', '//@ sourceMappingURL=main.js.map\n', true],
  [
    'source-map-local-lines',
    '//# sourceMappingURL=main.js.map\n//# sourceMappingURL=main.js.map',
    true,
  ],
  [
    'source-map-remote-query-mask',
    '//# sourceMappingURL=https://evil.invalid/a.map?sourceMappingURL=main.js.map',
    false,
  ],
  [
    'source-map-remote-fragment-mask',
    '//# sourceMappingURL=https://evil.invalid/a.map#sourceMappingURL=main.js.map',
    false,
  ],
  [
    'source-map-remote-repeated-mask',
    '//# sourceMappingURL=https://evil.invalid/a.map?sourceMappingURL=main.js.map&sourceMappingURL=main.js.map',
    false,
  ],
  [
    'source-map-protocol-relative-mask',
    '//# sourceMappingURL=//evil.invalid/sourceMappingURL=main.js.map',
    false,
  ],
  [
    'source-map-data-mask',
    '//# sourceMappingURL=data:application/json,sourceMappingURL=main.js.map',
    false,
  ],
  ['source-map-traversal-mask', '//# sourceMappingURL=../sourceMappingURL=main.js.map', false],
  [
    'source-map-extra-directive',
    '//# sourceMappingURL=main.js.mapsourceMappingURL=main.js.map',
    false,
  ],
  ['source-map-local-query', '//# sourceMappingURL=main.js.map?x=1', false],
  [
    'source-map-remote-then-local',
    '//# sourceMappingURL=https://evil.invalid/a.map\n//# sourceMappingURL=main.js.map',
    false,
  ],
]) {
  const files = base()
  files.set('dist/main.js', bytes(code))
  files.set(
    'dist/main.js.map',
    bytes({ version: 3, sources: ['main.ts'], names: [], mappings: '' }),
  )
  add(name, zip(seal(files)), expectedOk)
}
const valid = zip(seal(base())),
  cd = valid.readUInt32LE(valid.length - 6)
for (const [name, change] of [
  [
    'encrypted',
    (b) => {
      b.writeUInt16LE(1, 6)
      b.writeUInt16LE(1, cd + 8)
    },
  ],
  [
    'method',
    (b) => {
      b.writeUInt16LE(12, 8)
      b.writeUInt16LE(12, cd + 10)
    },
  ],
  ['symlink', (b) => b.writeUInt32LE((0o120777 << 16) >>> 0, cd + 38)],
  ['executable', (b) => b.writeUInt32LE((0o100755 << 16) >>> 0, cd + 38)],
  ['local-mismatch', (b) => b.writeUInt32LE(9, 22)],
  ['overlap', (b) => b.writeUInt32LE(1, cd + 42)],
  ['file-budget', (b) => b.writeUInt32LE(8388609, cd + 24)],
  ['count-budget', (b) => b.writeUInt16LE(1025, b.length - 12)],
]) {
  const input = Buffer.from(valid)
  change(input)
  add(name, input)
}
add('truncated', valid.subarray(0, -1))
add('trailing', Buffer.concat([valid, Buffer.from('x')]))
const bomb = base()
bomb.set('assets/bomb.json', bytes(' '.repeat(65536)))
add('compression-bomb', zip(seal(bomb), { deflate: true }))
writeFileSync(new URL('corpus.json', root), JSON.stringify(cases, null, 2) + '\n')
writeFileSync(
  new URL('golden.json', root),
  JSON.stringify(
    { domain: INTEGRITY_DOMAIN.toString('hex'), raw: raw.toString('base64'), envelope },
    null,
    2,
  ) + '\n',
)
const revocations = bytes({
  version: 1,
  sequence: 42,
  issuedAtMs: 0,
  expiresAtMs: 9007199254740991,
  pluginIds: [],
  packageHashes: [hash(zip(seal(base())))],
  publisherKeys: [],
})
writeFileSync(
  new URL('revocations.json', root),
  JSON.stringify(
    {
      raw: revocations.toString('base64'),
      envelope: {
        ...envelope,
        signature: sign(null, Buffer.concat([REVOCATION_DOMAIN, revocations]), privateKey).toString(
          'hex',
        ),
      },
    },
    null,
    2,
  ) + '\n',
)
console.log(`Saved ${cases.length} package cases; private key discarded.`)
