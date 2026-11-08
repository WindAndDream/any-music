/** Product distribution is explicit. Adding a source never opts it into another runtime. */
export type BuiltInSourceTarget = 'userscript' | 'desktop' | 'mobile'

export interface BuiltInSourceRegistration {
  descriptor: { id: string }
  targets: readonly BuiltInSourceTarget[]
}

/** Select before constructing transports, modules or account entries. */
export function selectBuiltInSources<T extends BuiltInSourceRegistration>(
  directory: readonly T[],
  target: BuiltInSourceTarget,
): readonly T[] {
  const ids = new Set<string>()
  for (const entry of directory) {
    if (ids.has(entry.descriptor.id))
      throw new Error(`Duplicate built-in source: ${entry.descriptor.id}`)
    ids.add(entry.descriptor.id)
  }
  return directory.filter((entry) => entry.targets.includes(target))
}
