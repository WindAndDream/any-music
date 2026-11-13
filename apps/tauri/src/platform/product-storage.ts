import type { StableValueStorage } from '@any-music/music-workbench'
import {
  createProductGenerationStorage,
  loadProductGeneration,
} from '@any-music/music-workbench/storage'
import type { ProductGenerationBackend } from '@any-music/music-workbench/storage'
import { invoke } from '@tauri-apps/api/core'

interface ProductSnapshot {
  schemaVersion: 2
  revision: number
  values: Record<string, unknown>
}
const STORAGE_KEY = 'any-music:tauri:product:v2'
let productWriting = false
function record(input: unknown): input is Record<string, unknown> {
  return input !== null && typeof input === 'object' && !Array.isArray(input)
}
function parse(input: unknown): ProductSnapshot | undefined {
  if (!record(input) || input.schemaVersion === undefined) return undefined
  if (input.schemaVersion !== 2)
    throw new Error('Product mirror requires a newer application; read-only')
  if (
    !Number.isSafeInteger(input.revision) ||
    (input.revision as number) < 0 ||
    !record(input.values)
  )
    throw new Error('Invalid product mirror')
  return input as unknown as ProductSnapshot
}
function rawStorage(snapshot: ProductSnapshot): StableValueStorage {
  return {
    read: <T>(key: string, fallback?: T) => (snapshot.values[key] as T | undefined) ?? fallback,
    write: () => {
      throw new Error('Read only')
    },
  }
}
function readLocal(key: string): unknown {
  const text = localStorage.getItem(key)
  if (!text) return undefined
  try {
    return JSON.parse(text)
  } catch {
    return { damaged: true }
  }
}
function generation(snapshot: ProductSnapshot): number {
  const loaded = loadProductGeneration(rawStorage(snapshot))
  if (loaded) return loaded.commit.sequence
  // Interrupted first-launch staging has no published data and can be initialized again.
  return 0
}

/** Interrupted staging uses unique IDs. Only the live and immediately preceding
 * generations are reachable; retaining abandoned chunks can exhaust WebView storage. */
function compactGenerations(snapshot: ProductSnapshot): ProductSnapshot {
  const pointer = snapshot.values['product-data:commit']
  const keep = new Set<string>()
  if (record(pointer)) {
    const prefix = `product-data:g${pointer.slot}:${pointer.id}:`
    keep.add(prefix)
    const manifest = snapshot.values[`${prefix}manifest`]
    if (record(manifest) && record(manifest.previous)) {
      const previous = manifest.previous
      keep.add(`product-data:g${previous.slot}:${previous.id}:`)
    }
  }
  return {
    ...snapshot,
    values: Object.fromEntries(
      Object.entries(snapshot.values).filter(
        ([key]) =>
          !/^product-data:g[01]:[^:]+:(core|host|namespaces|manifest)$/.test(key) ||
          [...keep].some((prefix) => key.startsWith(prefix)),
      ),
    ),
  }
}

/** Generation and revision order complete native/renderer snapshots.
 * Each native write contains the complete staged map, including the single commit pointer. */
export async function createProductStorage(): Promise<StableValueStorage> {
  const nativeInput = await invoke<unknown>('load_product_data')
  const native = parse(nativeInput)
  let expectedLocal = localStorage.getItem(STORAGE_KEY)
  const local = parse(readLocal(STORAGE_KEY))
  const candidates = [native, local].filter((value): value is ProductSnapshot => Boolean(value))
  const valid = candidates
    .flatMap((candidate) => {
      try {
        return [{ candidate, generation: generation(candidate) }]
      } catch (error) {
        if (error instanceof Error && /Unsupported|newer/.test(error.message)) throw error
        return []
      }
    })
    .toSorted((a, b) => b.generation - a.generation || b.candidate.revision - a.candidate.revision)
  if (candidates.length && !valid.length)
    throw new Error('No complete product generation; preserve mirrors for recovery')
  let snapshot: ProductSnapshot
  if (valid[0]) {
    const selected = valid[0].candidate
    snapshot = {
      ...selected,
      revision: Math.max(...candidates.map((candidate) => candidate.revision)) + 1,
    }
  } else {
    if (localStorage.getItem(STORAGE_KEY) !== null)
      throw new Error('Damaged new product mirror; preserve for recovery')
    snapshot = { schemaVersion: 2, revision: 0, values: {} }
  }
  // Candidate validation precedes reclamation; unknown or damaged formats stay untouched.
  snapshot = compactGenerations(snapshot)
  let writes = Promise.resolve()
  let mirrorFailed = false
  function assertCurrentMirror(): void {
    if (localStorage.getItem(STORAGE_KEY) !== expectedLocal)
      throw new Error('Product mirror changed; reload before writing')
  }
  const raw: ProductGenerationBackend = {
    withExclusiveWrite(operation) {
      if (productWriting) throw new Error('Product storage is busy')
      assertCurrentMirror()
      productWriting = true
      try {
        return operation()
      } finally {
        productWriting = false
      }
    },
    read: <T>(key: string, fallback?: T) => (snapshot.values[key] as T | undefined) ?? fallback,
    remove(key) {
      // Reclamation runs immediately before the journal write. That next full snapshot
      // persists all removals together; interruption here leaves the old mirror intact.
      const values = { ...snapshot.values }
      delete values[key]
      snapshot = { ...snapshot, values }
    },
    write(key, value) {
      if (mirrorFailed) throw new Error('Native mirror failed; restart before writing')
      const next: ProductSnapshot = {
        schemaVersion: 2,
        revision: snapshot.revision + 1,
        values: { ...snapshot.values, [key]: value },
      }
      const text = JSON.stringify(next)
      localStorage.setItem(STORAGE_KEY, text)
      expectedLocal = text
      snapshot = next
      writes = writes.then(() => invoke<void>('save_product_data', { value: next }))
      void writes.catch(() => {
        mirrorFailed = true
        window.dispatchEvent(new CustomEvent('any-music:storage-error'))
      })
    },
  }
  let storage: ReturnType<typeof createProductGenerationStorage>
  try {
    storage = createProductGenerationStorage(raw, { runtime: 'tauri' })
  } catch (error) {
    await writes.catch(() => {})
    throw error
  }
  // No repositories or Vue state are exposed until both mirrors share one generation.
  await writes
  assertCurrentMirror()
  await invoke<void>('save_product_data', { value: snapshot })
  assertCurrentMirror()
  const text = JSON.stringify(snapshot)
  localStorage.setItem(STORAGE_KEY, text)
  expectedLocal = text
  return storage
}
