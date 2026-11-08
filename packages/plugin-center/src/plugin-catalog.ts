/** Minimal identity contract: catalogs can host non-music plugins without application models. */
export interface PluginIdentity {
  descriptor: { readonly id: string; readonly name: string }
}

/** The host decides how to present or serialize catalog failures. */
export class PluginCatalogError extends Error {
  readonly code: 'conflict' | 'unsupported-operation'

  constructor(code: 'conflict' | 'unsupported-operation', message: string) {
    super(message)
    this.code = code
    this.name = 'PluginCatalogError'
  }
}

/** Owns identity and built-in protection; never executes plugins or grants runtime permissions. */
export class PluginCatalog<Plugin extends PluginIdentity> {
  private readonly entries = new Map<string, Plugin>()
  private readonly names = new Map<string, string>()
  private readonly nameById = new Map<string, string>()
  private readonly builtInIds = new Set<string>()
  private snapshot: readonly Plugin[] = Object.freeze([])

  constructor(builtIns: readonly Plugin[] = []) {
    for (const plugin of builtIns) {
      this.install(plugin)
      this.builtInIds.add(plugin.descriptor.id)
    }
  }

  get plugins(): readonly Plugin[] {
    return this.snapshot
  }

  get(id: string): Plugin | undefined {
    return this.entries.get(id)
  }

  /** Check identity before a host creates a plugin, keeping duplicate installs free of factory effects. */
  assertCanInstall(descriptor: PluginIdentity['descriptor']): void {
    const { id, name } = descriptor
    const key = normalizePluginName(name)
    if (this.builtInIds.has(id))
      throw new PluginCatalogError('conflict', '自定义插件不能覆盖内置插件。')
    if (this.entries.has(id)) throw new PluginCatalogError('conflict', `插件 ID“${id}”已存在。`)
    const existingId = this.names.get(key)
    if (existingId !== undefined)
      throw new PluginCatalogError('conflict', `插件名称“${name}”已被 ${existingId} 使用。`)
  }

  install(plugin: Plugin): Plugin {
    this.assertCanInstall(plugin.descriptor)
    const { id, name } = plugin.descriptor
    const key = normalizePluginName(name)
    this.entries.set(id, plugin)
    this.names.set(key, id)
    // Capture the installed key so later third-party descriptor mutation cannot leak a reserved name.
    this.nameById.set(id, key)
    // Membership snapshots stay referentially stable during availability-only updates.
    this.snapshot = Object.freeze([...this.entries.values()])
    return plugin
  }

  remove(id: string): void {
    if (this.builtInIds.has(id))
      throw new PluginCatalogError('unsupported-operation', '内置插件不能删除。')
    const key = this.nameById.get(id)
    if (key !== undefined) this.names.delete(key)
    this.nameById.delete(id)
    if (this.entries.delete(id)) this.snapshot = Object.freeze([...this.entries.values()])
  }

  /** Host-controlled update preserves built-in membership and checks names before changing anything. */
  assertCanReplace({ id, name }: PluginIdentity['descriptor']): void {
    if (!this.entries.has(id))
      throw new PluginCatalogError('unsupported-operation', `插件 ID“${id}”不存在。`)
    const key = normalizePluginName(name)
    const owner = this.names.get(key)
    if (owner !== undefined && owner !== id)
      throw new PluginCatalogError('conflict', `插件名称“${name}”已被 ${owner} 使用。`)
  }

  replace(plugin: Plugin): void {
    this.assertCanReplace(plugin.descriptor)
    const { id, name } = plugin.descriptor
    const key = normalizePluginName(name)
    this.names.delete(this.nameById.get(id)!)
    this.names.set(key, id)
    this.nameById.set(id, key)
    this.entries.set(id, plugin)
    this.snapshot = Object.freeze([...this.entries.values()])
  }
}

/** Unicode normalization keeps case, full-width text and repeated whitespace from bypassing uniqueness. */
function normalizePluginName(name: string): string {
  return name.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase()
}
