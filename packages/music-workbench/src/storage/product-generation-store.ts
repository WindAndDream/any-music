import type { StableValueStorage } from '../runtime/workbench-runtime'
import { copyJson, isRecord, jsonText, validateNamespaces } from './product-data'
import type { ProductData } from './product-data'
import { createProductData, readProductValue, writeProductValue } from './product-data-projection'

export const PRODUCT_COMMIT_KEY = 'product-data:commit'
const JOURNAL_KEY = 'product-data:journal'
const PROXY_KEY = 'runtime:proxy:v1'
const PARTS = ['core', 'host', 'namespaces'] as const
interface Commit {
  schemaVersion: 1
  sequence: number
  slot: number
  id: string
}
interface Manifest extends Omit<Commit, 'schemaVersion'> {
  schemaVersion: 2
  checksums: Record<string, string>
  previous?: Commit
}
function partKey(commit: Commit, part: string): string {
  return `product-data:g${commit.slot}:${commit.id}:${part}`
}
// Corruption checksum only, not an authenticity/security boundary. The caller
// validates the complete product before canonicalizing any of its parts.
function checksumValidatedJson(value: unknown): string {
  // Native JSON maps reorder keys across IPC and disk round trips.
  const text = JSON.stringify(value, (_key, item) =>
    isRecord(item)
      ? Object.fromEntries(
          Object.keys(item)
            .toSorted()
            .map((key) => [key, item[key]]),
        )
      : item,
  )
  let hash = 2166136261
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619)
  return `c1:${text.length}:${hash >>> 0}`
}
function validateCommit(input: unknown): asserts input is Commit {
  if (
    !isRecord(input) ||
    input.schemaVersion !== 1 ||
    !Number.isSafeInteger(input.sequence) ||
    (input.sequence as number) < 1 ||
    (input.slot !== 0 && input.slot !== 1) ||
    typeof input.id !== 'string'
  )
    throw new Error('Unsupported product generation; storage is read-only')
}
export function loadProductGeneration(
  raw: StableValueStorage,
): { commit: Commit; data: ProductData } | undefined {
  return readProductGeneration(raw, true)
}
function readProductGeneration(
  raw: StableValueStorage,
  isolate: boolean,
): { commit: Commit; data: ProductData } | undefined {
  const journal = raw.read<unknown>(JOURNAL_KEY)
  if (journal !== undefined && (!isRecord(journal) || journal.schemaVersion !== 1))
    throw new Error('Unsupported product journal')
  const commit = raw.read<unknown>(PRODUCT_COMMIT_KEY)
  if (commit === undefined) return undefined
  validateCommit(commit)
  const manifest = raw.read<Manifest>(partKey(commit, 'manifest'))
  if (manifest && manifest.schemaVersion !== 2)
    throw new Error('Unsupported generation manifest schema')
  if (
    !manifest ||
    manifest.id !== commit.id ||
    manifest.sequence !== commit.sequence ||
    manifest.slot !== commit.slot
  )
    throw new Error('Incomplete product generation')
  const data = { schemaVersion: 1 } as ProductData
  for (const part of PARTS) {
    Object.assign(data, { [part]: raw.read<unknown>(partKey(commit, part)) })
  }
  // Validate the full depth/byte budget and reject accessors before checksum
  // canonicalization. Per-part validation would repeat the large library walk.
  jsonText(data)
  for (const part of PARTS) {
    const expected = manifest.checksums[part]
    if (typeof expected !== 'string' || !expected.startsWith('c1:'))
      throw new Error('Unsupported generation checksum algorithm')
    if (checksumValidatedJson(data[part]) !== expected)
      throw new Error('Product generation checksum mismatch')
  }
  validateProductStructure(data)
  return { commit, data: isolate ? copyJson(data) : data }
}
export function validateProductData(data: ProductData): void {
  jsonText(data)
  validateProductStructure(data)
}
function validateProductStructure(data: ProductData): void {
  if (
    data.schemaVersion !== 1 ||
    !isRecord(data.core) ||
    !isRecord(data.core.library) ||
    data.core.library.schemaVersion !== 6 ||
    !isRecord(data.host)
  )
    throw new Error('Unsupported product data schema')
  validateNamespaces(data.namespaces)
}

export interface ProductGenerationStorage extends StableValueStorage {
  snapshot(): ProductData
  replace(data: ProductData, expectedRevision: string): void
  revision(): string
}
/** The runtime serializes all users of the same durable store, including other tabs.
 * A busy writer must fail before invoking the callback; timestamp leases are insufficient. */
export interface ProductGenerationBackend extends StableValueStorage {
  withExclusiveWrite<T>(operation: () => T): T
}
/** Immutable chunks + one pointer: competing renderers cannot overwrite live staging keys. */
export function createProductGenerationStorage(
  raw: ProductGenerationBackend,
  options: {
    runtime: 'userscript' | 'tauri'
    id?: () => string
  },
): ProductGenerationStorage {
  const id = options.id ?? (() => crypto.randomUUID())
  let loaded = raw.withExclusiveWrite(() => loadProductGeneration(raw))
  let poisoned = false
  let imported = false
  function commit(data: ProductData, writeRuntimeSettings?: () => void): void {
    raw.withExclusiveWrite(() => commitExclusive(data, writeRuntimeSettings))
  }
  function commitExclusive(data: ProductData, writeRuntimeSettings?: () => void): void {
    if (poisoned) throw new Error('Restart required after an interrupted product write')
    const durable = raw.read<unknown>(PRODUCT_COMMIT_KEY)
    if (JSON.stringify(durable) !== JSON.stringify(loaded?.commit))
      throw new Error('Product generation changed; reload before writing')
    const next: Commit = {
      schemaVersion: 1,
      sequence: (loaded?.commit.sequence ?? 0) + 1,
      slot: loaded ? 1 - loaded.commit.slot : 0,
      id: id(),
    }
    const candidate = copyJson(data)
    validateProductData(candidate)
    try {
      writeRuntimeSettings?.()
      // Reclaim only the previous generation before staging. The committed generation
      // remains intact at every failure boundary. Unique keys also
      // keep an interleaved stale tab from corrupting the active generation.
      const previousManifest = loaded
        ? raw.read<Manifest>(partKey(loaded.commit, 'manifest'))
        : undefined
      if (raw.remove && previousManifest?.previous) {
        const retired = previousManifest.previous
        validateCommit(retired)
        if (
          !loaded ||
          retired.sequence >= loaded.commit.sequence ||
          retired.id === loaded.commit.id
        )
          throw new Error('Invalid retired product generation')
        for (const part of [...PARTS, 'manifest']) raw.remove(partKey(retired, part))
      }
      raw.write(JOURNAL_KEY, {
        schemaVersion: 1,
        phase: 'staging',
        previous: loaded?.commit ?? null,
        candidate: next,
      })
      const checksums: Record<string, string> = {}
      for (const part of PARTS) {
        raw.write(partKey(next, part), candidate[part])
        checksums[part] = checksumValidatedJson(candidate[part])
      }
      raw.write(
        partKey(next, 'manifest'),
        // Canonical checksums survive native JSON map ordering.
        copyJson({
          ...next,
          schemaVersion: 2 as const,
          checksums,
          previous: loaded?.commit,
        }) satisfies Manifest,
      )
      // Verify manifest and all staged ownership parts through the normal reader before publishing.
      readProductGeneration(
        {
          read: (key, fallback) =>
            key === PRODUCT_COMMIT_KEY ? (next as never) : raw.read(key, fallback),
          write: () => {
            throw new Error('Read only')
          },
        },
        false,
      )
      if (JSON.stringify(raw.read(PRODUCT_COMMIT_KEY)) !== JSON.stringify(loaded?.commit))
        throw new Error('Product generation changed during staging; reload before writing')
      raw.write(PRODUCT_COMMIT_KEY, next)
      loaded = { commit: next, data: candidate }
      // No fallible write follows the linearization point. The journal is historical intent;
      // recovery compares it to the pointer rather than requiring a second "done" write.
    } catch (error) {
      poisoned = true
      throw error
    }
  }
  if (!loaded) commit(createProductData())
  return {
    read<T>(key: string, fallback?: T): T | undefined {
      const value = readProductValue(
        loaded!.data,
        key,
        options.runtime === 'userscript' ? raw.read(PROXY_KEY) : undefined,
      )
      return value === undefined ? fallback : (copyJson(value) as T)
    },
    write(key, value) {
      if (imported) throw new Error('Reload required after product import')
      const writeProxy =
        key === 'music-source-workspace:v1' &&
        options.runtime === 'userscript' &&
        isRecord(value) &&
        value.proxySettings !== undefined
      // Projection writers replace values inside these owning containers; they
      // never mutate existing entries. Keep the current snapshot intact while
      // commit creates the one fully detached candidate, including caller input.
      const next: ProductData = {
        ...loaded!.data,
        core: { ...loaded!.data.core },
        host: { ...loaded!.data.host },
        namespaces: [...loaded!.data.namespaces],
      }
      writeProductValue(next, key, value)
      commit(next, writeProxy ? () => raw.write(PROXY_KEY, value.proxySettings) : undefined)
    },
    snapshot: () => copyJson(loaded!.data),
    revision: () => loaded!.commit.id,
    replace(data, expectedRevision) {
      if (imported) throw new Error('Reload required after product import')
      if (loaded!.commit.id !== expectedRevision) throw new Error('Import preview is stale')
      commit(data)
      // Existing Vue controllers retain their current refs. Freeze this writer until the
      // complete workbench reloads, so those refs cannot overwrite the imported generation.
      imported = true
    },
  }
}
