import { createPrivateKey, createPublicKey, sign } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'

import { hash, INTEGRITY_DOMAIN, pathKey, verifyPackage } from '@any-music/plugin-sdk/node'
import { parseBoundedJson, decodeProtocolJson } from '@any-music/plugin-sdk/schema'
import { zipSync } from 'fflate'

import { buildGuest, runModule } from './build.mjs'
import { refuse } from './diagnostic.mjs'
import { checkCompatibility, TOOL_VERSION } from './project.mjs'

const bytes = (value) => Buffer.from(JSON.stringify(value))
export function sealPackage(payload) {
  const files = new Map([...payload].toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
  files.set(
    'integrity.json',
    bytes({
      version: 1,
      files: [...files].map(([path, value]) => ({ path, size: value.length, sha256: hash(value) })),
    }),
  )
  return writeArchive(files)
}
export function writeArchive(files) {
  const input = Object.create(null)
  for (const [name, value] of [...files].toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    pathKey(name)
    input[name] = [value, { level: 0, mtime: new Date(1980, 0, 1) }]
  }
  const archive = Buffer.from(zipSync(input))
  verifyPackage(archive)
  return archive
}
export async function packProject(snapshot) {
  const files = new Map(snapshot.assets)
  files.set('manifest.json', bytes(snapshot.manifest))
  if (snapshot.manifest.execution === 'sandbox-code') {
    const source = await buildGuest(snapshot)
    // Fixed smoke only; never load a project-defined pack hook or Node-side test.
    const smoke = decodeProtocolJson(
      'GuestStep',
      JSON.stringify(
        await runModule(source, {
          operation: 'command.run',
          commandId: snapshot.manifest.commands[0]?.id,
          inputJson: '{"query":"smoke","items":[]}',
          contextRef: 'tool-smoke',
          sequence: 0,
          deadlineMs: 30000,
        }),
      ),
    )
    if (smoke.kind === 'complete') parseBoundedJson(smoke.outputJson)
    files.set('dist/main.js', Buffer.from(source))
  }
  files.set('LICENSES/plugin.txt', await snapshot.project.read('LICENSE', 65536))
  files.set(
    'sbom.json',
    bytes({
      bomFormat: 'CycloneDX',
      specVersion: '1.6',
      version: 1,
      metadata: {
        component: {
          type: 'application',
          name: snapshot.manifest.id,
          version: snapshot.manifest.version,
        },
      },
      components: ['plugin-sdk', 'plugin-cli', 'plugin-testkit'].map((name) => ({
        type: 'library',
        name: '@any-music/' + name,
        version: TOOL_VERSION,
      })),
    }),
  )
  return sealPackage(files)
}
export async function readPackage(path, target) {
  // Limit before read as well as inside the verifier; a hostile local file cannot cause an
  // unbounded allocation. Bounded read uses an open handle even if the path is replaced.
  const { open } = await import('node:fs/promises')
  const handle = await open(path, 'r')
  try {
    if (!(await handle.stat()).isFile() || (await handle.stat()).size > 16 * 1024 * 1024)
      refuse('PACKAGE_BUDGET', 'package', 'Package exceeds 16 MiB.')
    const buffer = Buffer.alloc(16 * 1024 * 1024 + 1)
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
    const result = verifyPackage(buffer.subarray(0, bytesRead))
    if (target) checkCompatibility(result.manifest, target)
    return result
  } finally {
    await handle.close()
  }
}
export function inspectPackage(packageValue) {
  return {
    manifest: packageValue.manifest,
    contentHash: packageValue.contentHash,
    publisher: packageValue.signer ?? null,
    publisherVerified: false,
    signature: packageValue.signer ? 'valid-unverified-publisher' : 'unsigned',
    files: [...packageValue.files].map(([path, value]) => ({ path, bytes: value.length })),
    productionAdmission: false,
  }
}
export function permissionDiff(oldManifest, newManifest) {
  const fields = [
    'capabilities',
    'forms',
    'runtimeProfileVersion',
    'memoryClass',
    'contributions',
    'dataSchemaVersion',
    'execution',
    'wireVersions',
    'sdk',
  ]
  const changes = fields
    .filter((key) => JSON.stringify(oldManifest[key]) !== JSON.stringify(newManifest[key]))
    .map((path) => ({ path, before: oldManifest[path], after: newManifest[path] }))
  const oldIds = new Set(oldManifest.capabilities.map((c) => c.id))
  return {
    requiresApproval: changes.length > 0 || oldManifest.id !== newManifest.id,
    addedPermissions: newManifest.capabilities.filter((c) => !oldIds.has(c.id)).map((c) => c.id),
    changes,
  }
}
export async function signPackage(path, keyPath, output) {
  if (!keyPath || !output || output === path)
    refuse(
      'SIGN_ARGUMENTS',
      'sign',
      'Signing requires a local key and a separate output.',
      'Use --key <file> --output <new.amplugin>.',
      2,
    )
  const value = await readPackage(path)
  if (value.signer) refuse('SIGNED_IMMUTABLE', 'package', 'Signed packages cannot be modified.')
  const keyBytes = await readFile(keyPath)
  if (keyBytes.length > 16384) refuse('KEY', 'key', 'Unsupported signing key.')
  const key = createPrivateKey(keyBytes)
  if (key.asymmetricKeyType !== 'ed25519') refuse('KEY', 'key', 'Only Ed25519 keys are supported.')
  const publicKey = createPublicKey(key).export({ type: 'spki', format: 'der' }).subarray(-32)
  value.files.set(
    'signature.json',
    bytes({
      version: 1,
      algorithm: 'Ed25519',
      keyId: 'local-publisher',
      publicKey: publicKey.toString('hex'),
      fingerprint: hash(publicKey),
      signature: sign(
        null,
        Buffer.concat([INTEGRITY_DOMAIN, value.files.get('integrity.json')]),
        key,
      ).toString('hex'),
    }),
  )
  const archive = writeArchive(value.files)
  await writeFile(output, archive, { flag: 'wx' })
  return inspectPackage(verifyPackage(archive))
}
export async function checkMigration(fixturePath, packageValue) {
  const { stat } = await import('node:fs/promises')
  if ((await stat(fixturePath)).size > 262144)
    refuse('MIGRATION_BUDGET', 'fixture', 'Migration fixture exceeds the message budget.')
  const fixture = parseBoundedJson(await readFile(fixturePath, 'utf8'))
  if (fixture.schemaVersion !== 1 || packageValue.manifest.dataSchemaVersion !== 1)
    refuse(
      'MIGRATION_SCHEMA',
      'fixture.schemaVersion',
      'Unsupported data schema; preserve the input.',
    )
  // S14 native migrations admit only versioned host operations. Code smoke executes inside
  // the same ephemeral VM; its output is never committed to product or plugin storage.
  if (packageValue.manifest.execution === 'sandbox-code')
    await runModule(packageValue.files.get('dist/main.js').toString(), {
      operation: 'migrate-check',
      fixture,
    })
  return {
    passed: true,
    schemaVersion: 1,
    operation: 'copy',
    inputHash: hash(bytes(fixture)),
    preserved: true,
  }
}
