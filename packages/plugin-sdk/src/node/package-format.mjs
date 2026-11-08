/** Node-side S14 format checker, shared with future CLI packaging. Never imports guest code. */
import { createHash, createPublicKey, verify } from 'node:crypto'
import { inflateRawSync } from 'node:zlib'

import { decodeProtocolJson, parseBoundedJson } from '../schema/index.ts'

export const INTEGRITY_DOMAIN = Buffer.from('AnyMusic.amplugin.integrity.v1\0')
export const REVOCATION_DOMAIN = Buffer.from('AnyMusic.amplugin.revocations.v1\0')
export const hash = (bytes) => createHash('sha256').update(bytes).digest('hex')
const fail = (code) => {
  throw new Error(code)
}
const text = (bytes, code = 'Resource') => {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return fail(code)
  }
}
const decode = (name, bytes, code) => {
  try {
    return decodeProtocolJson(name, text(bytes, code))
  } catch {
    return fail(code)
  }
}
const json = (bytes) => {
  try {
    return parseBoundedJson(text(bytes))
  } catch {
    return fail('Resource')
  }
}
export function pathKey(path) {
  if (
    !path ||
    Buffer.byteLength(path) > 240 ||
    path.split('/').length > 8 ||
    path.normalize('NFC') !== path ||
    /[\\:<>"|?*]/u.test(path) ||
    Array.from(path).some((char) => {
      const code = char.codePointAt(0)
      return code < 32 || (code >= 127 && code <= 159)
    })
  )
    fail('Path')
  const key = Array.from(path.normalize('NFKC').toUpperCase(), (char) => char.toLowerCase()).join(
    '',
  )
  for (const part of key.split('/')) {
    if (
      !part ||
      part === '.' ||
      part === '..' ||
      /[. ]$/.test(part) ||
      /^(con|prn|aux|nul|clock\$|com[1-9]|lpt[1-9])(?:\.|$)/.test(part)
    )
      fail('Path')
  }
  return key
}
const allowed = (path) =>
  [
    'manifest.json',
    'integrity.json',
    'signature.json',
    'dist/main.js',
    'dist/main.js.map',
    'sbom.json',
  ].includes(path) ||
  (path.startsWith('assets/') && /\.(json|png|jpe?g|webp)$/.test(path)) ||
  (path.startsWith('LICENSES/') && /\.(txt|json)$/.test(path))
export function crc32(bytes) {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
  }
  return (crc ^ 0xffffffff) >>> 0
}
export function verifySignature(domain, raw, envelope) {
  for (const [key, size] of [
    ['publicKey', 64],
    ['fingerprint', 64],
    ['signature', 128],
  ])
    if (envelope[key].length !== size || !/^[0-9a-f]+$/.test(envelope[key])) fail('Signature')
  const publicKey = Buffer.from(envelope.publicKey, 'hex')
  // Align OpenSSL with dalek verify_strict: reject all small-order encodings for A and R.
  // Data values from libsodium 1.0.18's ge25519_has_small_order (ISC), sign bit ignored:
  // https://github.com/jedisct1/libsodium/blob/1.0.18/src/libsodium/crypto_core/ed25519/ref10/ed25519_ref10.c
  const weak = new Set([
    '00'.repeat(32),
    '01' + '00'.repeat(31),
    '26e8958fc2b227b045c3f489f2ef98f0d5dfac05d3c63339b13802886d53fc05',
    'c7176a703d4dd84fba3c0b760d10670f2a2053fa2c39ccc64ec7fd7792ac037a',
    ...['ec', 'ed', 'ee'].map((prefix) => prefix + 'ff'.repeat(30) + '7f'),
  ])
  for (const encoded of [publicKey, Buffer.from(envelope.signature.slice(0, 64), 'hex')]) {
    const point = Buffer.from(encoded)
    point[31] &= 0x7f
    if (weak.has(point.toString('hex'))) fail('Signature')
  }
  if (hash(publicKey) !== envelope.fingerprint) fail('Signature')
  // SPKI's fixed Ed25519 algorithm prefix, not a custom signature algorithm.
  const key = createPublicKey({
    key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), publicKey]),
    format: 'der',
    type: 'spki',
  })
  if (!verify(null, Buffer.concat([domain, raw]), key, Buffer.from(envelope.signature, 'hex')))
    fail('Signature')
  return envelope.fingerprint
}
export function verifyPackage(input) {
  if (!(input instanceof Uint8Array) || input.byteLength > 16 * 1024 * 1024) fail('Budget')
  const bytes = Buffer.from(input)
  if (bytes.length > 16 * 1024 * 1024) fail('Budget')
  const n = (offset, count = 2) => {
    if (offset < 0 || offset + count > bytes.length) fail('Archive')
    return bytes.readUIntLE(offset, count)
  }
  const sig = (offset, value) =>
    offset >= 0 && bytes.subarray(offset, offset + 4).equals(Buffer.from(value, 'binary'))
  const end = bytes.length - 22
  if (!sig(end, 'PK\x05\x06') || n(end + 4, 4) !== 0 || n(end + 20) !== 0) fail('Archive')
  const count = n(end + 10)
  if (!count || count > 1024) fail('Budget')
  if (n(end + 8) !== count) fail('Archive')
  let offset = n(end + 16, 4),
    localEnd = 0,
    total = 0
  const central = offset,
    seen = new Set(),
    files = new Map()
  if (offset + n(end + 12, 4) !== end) fail('Archive')
  for (let i = 0; i < count; i++) {
    if (!sig(offset, 'PK\x01\x02')) fail('Archive')
    const flags = n(offset + 8),
      method = n(offset + 10),
      compressed = n(offset + 20, 4),
      size = n(offset + 24, 4),
      nameLength = n(offset + 28),
      mode = n(offset + 38, 4),
      local = n(offset + 42, 4)
    if (
      flags & ~0x800 ||
      ![0, 8].includes(method) ||
      n(offset + 30, 6) !== 0 ||
      mode & 0x10 ||
      (mode >>> 16) & 0o111 ||
      ![0, 0o100000].includes((mode >>> 16) & 0o170000) ||
      local !== localEnd
    )
      fail('Archive')
    if (nameLength > 240) fail('Path')
    const name = bytes.subarray(offset + 46, offset + 46 + nameLength),
      path = text(name, 'Path'),
      key = pathKey(path)
    if (seen.has(key)) fail('Path')
    seen.add(key)
    if (!allowed(path)) fail('Resource')
    total += size
    if (size > 8 * 1024 * 1024 || size > compressed * 100 || total > 64 * 1024 * 1024)
      fail('Budget')
    if (
      !sig(local, 'PK\x03\x04') ||
      !bytes.subarray(local + 6, local + 10).equals(bytes.subarray(offset + 8, offset + 12)) ||
      !bytes.subarray(local + 14, local + 26).equals(bytes.subarray(offset + 16, offset + 28)) ||
      n(local + 26) !== nameLength ||
      n(local + 28) !== 0 ||
      !bytes.subarray(local + 30, local + 30 + nameLength).equals(name)
    )
      fail('Archive')
    const start = local + 30 + nameLength
    localEnd = start + compressed
    if (localEnd > central) fail('Archive')
    let output
    try {
      output =
        method === 0
          ? bytes.subarray(start, localEnd)
          : inflateRawSync(bytes.subarray(start, localEnd), {
              maxOutputLength: Math.min(8 * 1024 * 1024, compressed * 100) + 1,
            })
    } catch {
      fail('Archive')
    }
    if (output.length > 8 * 1024 * 1024 || output.length > compressed * 100) fail('Budget')
    if (output.length !== size || crc32(output) !== n(offset + 16, 4)) fail('Archive')
    files.set(path, output)
    offset += 46 + nameLength
  }
  if (offset !== end || localEnd !== central) fail('Archive')
  if (!files.has('integrity.json')) fail('Integrity')
  const raw = files.get('integrity.json'),
    integrity = decode('PackageIntegrity', raw, 'Integrity'),
    expected = new Set()
  for (const entry of integrity.files) {
    pathKey(entry.path)
    if (['integrity.json', 'signature.json'].includes(entry.path) || expected.has(entry.path))
      fail('Integrity')
    expected.add(entry.path)
    const data = files.get(entry.path)
    if (!data || data.length !== entry.size || hash(data) !== entry.sha256) fail('Integrity')
  }
  for (const path of files.keys())
    if (!['integrity.json', 'signature.json'].includes(path) && !expected.has(path))
      fail('Integrity')
  const signer = files.has('signature.json')
    ? verifySignature(
        INTEGRITY_DOMAIN,
        raw,
        decode('PackageSignature', files.get('signature.json'), 'Signature'),
      )
    : undefined
  if (!files.has('manifest.json')) fail('Manifest')
  let manifestValue
  try {
    manifestValue = parseBoundedJson(text(files.get('manifest.json')))
  } catch {
    fail('Manifest')
  }
  if (!manifestValue || typeof manifestValue !== 'object' || Array.isArray(manifestValue))
    fail('Manifest')
  if (
    [
      'manifestVersion',
      'packageFormatVersion',
      'runtimeProfileVersion',
      'contributionVersion',
      'dataSchemaVersion',
    ].some((key) => key in manifestValue && manifestValue[key] !== 1)
  )
    fail('Unsupported')
  const manifest = decode('PluginManifest', files.get('manifest.json'), 'Manifest'),
    code = manifest.execution === 'sandbox-code'
  if (code !== files.has('dist/main.js') || (!code && files.has('dist/main.js.map')))
    fail('Manifest')
  for (const [path, value] of files) {
    if (path === 'dist/main.js') {
      const marker = 'sourceMappingURL='
      if (
        text(value)
          .split(/\r?\n/)
          .some((line) => {
            const start = line.indexOf(marker)
            // A matching suffix inside a remote URL's query/fragment is not a local reference.
            return start !== -1 && line.slice(start + marker.length).trimEnd() !== 'main.js.map'
          })
      )
        fail('Resource')
    } else if (path.endsWith('.map')) {
      const map = json(value)
      if ((map.sourceRoot !== undefined && map.sourceRoot !== '') || !Array.isArray(map.sources))
        fail('Resource')
      for (const source of map.sources) {
        if (typeof source !== 'string') fail('Resource')
        try {
          pathKey(source)
        } catch {
          fail('Resource')
        }
      }
    } else if (path.endsWith('.json')) json(value)
    else if (path.endsWith('.png')) {
      if (
        value.length < 24 ||
        !value.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')) ||
        value.subarray(12, 16).toString() !== 'IHDR' ||
        [16, 20].some((i) => !value.readUInt32BE(i) || value.readUInt32BE(i) > 8192)
      )
        fail('Resource')
    } else if (/\.jpe?g$/.test(path)) {
      if (
        !value.subarray(0, 3).equals(Buffer.from('ffd8ff', 'hex')) ||
        !value.subarray(-2).equals(Buffer.from('ffd9', 'hex'))
      )
        fail('Resource')
    } else if (
      path.endsWith('.webp') &&
      (value.length < 16 ||
        value.subarray(0, 4).toString() !== 'RIFF' ||
        value.subarray(8, 12).toString() !== 'WEBP')
    )
      fail('Resource')
  }
  return { contentHash: hash(bytes), manifest, signer, files }
}
