import type { HostLocalMusicLibrarySnapshot } from '@any-music/core'

/** Host persistence contains stable records and published assets only. */
export type CoreLibrary = HostLocalMusicLibrarySnapshot
export interface PluginDataNamespace {
  pluginId: string
  schemaVersion: number
  /** Opaque JSON: never merged as an object, registered, or executed. */
  data: unknown
}
export interface ProductCore {
  library: CoreLibrary
  queue: unknown
  downloads: unknown
  favorites?: unknown
}
export interface ProductData {
  schemaVersion: 1
  core: ProductCore
  host: Record<string, unknown>
  namespaces: PluginDataNamespace[]
}
export const TAG_NAMESPACE = 'feature.tags'
export const COMPOSER_NAMESPACE = 'feature.composer'
export const PRODUCT_DATA_LIMITS = {
  totalBytes: 8 * 1024 * 1024,
  namespaceBytes: 1024 * 1024,
  namespaceCount: 100,
  depth: 32,
} as const

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** Also rejects cycles, accessors, non-JSON values and prototype-bearing imported objects. */
export function jsonText(
  value: unknown,
  maxBytes: number = PRODUCT_DATA_LIMITS.totalBytes,
): string {
  function check(input: unknown, depth: number, parents: Set<object>): void {
    if (depth > PRODUCT_DATA_LIMITS.depth) throw new Error('Product data exceeds depth budget')
    if (input === null || typeof input === 'string' || typeof input === 'boolean') return
    if (typeof input === 'number' && Number.isFinite(input)) return
    if (typeof input !== 'object' || !input) throw new Error('Product data must be JSON')
    if (parents.has(input)) throw new Error('Cyclic product data')
    if (!Array.isArray(input) && ![Object.prototype, null].includes(Object.getPrototypeOf(input)))
      throw new Error('Product data must use plain objects')
    parents.add(input)
    // Inspect every own string property, including non-enumerable properties and
    // array length, without allocating a descriptor map plus a second values
    // array for each record in a large library. Never read through the object:
    // accessors must be rejected before JSON.stringify can invoke them.
    for (const key of Object.getOwnPropertyNames(input)) {
      const descriptor = Object.getOwnPropertyDescriptor(input, key)
      if (!descriptor) continue
      if (descriptor.get || descriptor.set) throw new Error('Product data cannot contain accessors')
      check(descriptor.value, depth + 1, parents)
    }
    parents.delete(input)
  }
  check(value, 0, new Set())
  const text = JSON.stringify(value)
  if (new TextEncoder().encode(text).length > maxBytes)
    throw new Error('Product data exceeds byte budget')
  return text
}

/** Undefined optional fields produced by trusted normalizers are omitted at the JSON boundary. */
export function copyJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

export function validateNamespaces(input: unknown): asserts input is PluginDataNamespace[] {
  if (!Array.isArray(input) || input.length > PRODUCT_DATA_LIMITS.namespaceCount)
    throw new Error('Invalid namespace count')
  const ids = new Set<string>()
  for (const item of input) {
    if (
      !isRecord(item) ||
      typeof item.pluginId !== 'string' ||
      !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,199}$/.test(item.pluginId) ||
      !Number.isSafeInteger(item.schemaVersion) ||
      (item.schemaVersion as number) < 1 ||
      !Object.hasOwn(item, 'data') ||
      ids.has(item.pluginId)
    )
      throw new Error('Invalid or duplicate plugin namespace')
    ids.add(item.pluginId)
    jsonText(item, PRODUCT_DATA_LIMITS.namespaceBytes)
  }
  jsonText(input)
}
