import { validateModuleWhen } from './module-conditions'
import { freezeModuleData, ModuleFrameworkError } from './module-contracts'
import type {
  ExtensionPoint,
  ModuleDescriptor,
  RegisteredContribution,
  RegistrySnapshot,
} from './module-contracts'

const LOCAL_ID = /^[a-z][a-z0-9.-]*$/

/** Static definitions only. The controller holds executable instances in a separate private map. */
export class ContributionRegistry {
  readonly points: readonly ExtensionPoint[]
  private snapshot: RegistrySnapshot = freezeModuleData({ revision: 0, contributions: [] })
  private registrations = new Map<
    string,
    { module: ModuleDescriptor; trusted: boolean; generation: number; token: object }
  >()

  constructor(points: readonly ExtensionPoint[]) {
    if (new Set(points.map((point) => point.id)).size !== points.length)
      throw new ModuleFrameworkError('point-conflict', [])
    for (const point of points) {
      if (!Number.isSafeInteger(point.version) || point.version < 1 || point.maxContributions < 1)
        throw new ModuleFrameworkError('invalid-point', [point.id])
    }
    this.points = freezeModuleData(points)
  }

  get current(): RegistrySnapshot {
    return this.snapshot
  }

  /** Validate the complete replacement before publishing a single revision. */
  replace(
    modules: readonly ModuleDescriptor[],
    trustedOwnerIds: ReadonlySet<string>,
  ): RegistrySnapshot {
    const entries = modules.map(
      (module) =>
        [
          module.id,
          {
            module: freezeModuleData(module),
            trusted: trustedOwnerIds.has(module.id),
            generation: 0,
            token: {},
          },
        ] as const,
    )
    if (new Set(modules.map((module) => module.id)).size !== modules.length)
      throw new ModuleFrameworkError('owner-conflict', [])
    return this.publishEntries(new Map(entries))
  }

  /** Registration ownership is host-bound. A stale dispose cannot remove a newer owner generation. */
  registerBatch(
    module: ModuleDescriptor,
    trusted: boolean,
    generation: number,
  ): { dispose(): void } {
    // Cleanup owns this registration identity, independent of later caller descriptor changes.
    const ownerId = module.id
    const current = this.registrations.get(ownerId)
    if (
      !Number.isSafeInteger(generation) ||
      generation < 0 ||
      (current && generation <= current.generation)
    )
      throw new ModuleFrameworkError('stale-registration', [ownerId])
    const token = {}
    const entries = new Map(this.registrations)
    entries.set(ownerId, { module: freezeModuleData(module), trusted, generation, token })
    this.publishEntries(entries)
    return {
      dispose: () => {
        if (this.registrations.get(ownerId)?.token !== token) return
        const next = new Map(this.registrations)
        next.delete(ownerId)
        this.publishEntries(next)
      },
    }
  }

  private publishEntries(entries: typeof this.registrations): RegistrySnapshot {
    const contributions: RegisteredContribution[] = []
    const ids = new Set<string>()
    for (const { module, trusted } of entries.values()) {
      if (!LOCAL_ID.test(module.id)) throw new ModuleFrameworkError('invalid-owner', [module.id])
      if (
        !module.name.trim() ||
        !Number.isSafeInteger(module.version) ||
        module.version < 1 ||
        !module.installationId ||
        !module.contentHash ||
        typeof module.required !== 'boolean' ||
        [...module.provides, ...module.requires, ...module.optional].some(
          (service) =>
            !LOCAL_ID.test(service.id) ||
            !Number.isSafeInteger(service.version) ||
            service.version < 1,
        )
      )
        throw new ModuleFrameworkError('invalid-module', [module.id])
      for (const contribution of module.contributions) {
        const id = `${module.id}/${contribution.localId}`
        const point = this.points.find((entry) => entry.id === contribution.pointId)
        if (!LOCAL_ID.test(contribution.localId) || ids.has(id))
          throw new ModuleFrameworkError('contribution-conflict', [id])
        if (
          !point ||
          point.version !== contribution.contractVersion ||
          point.inputSchema !== contribution.inputSchema ||
          point.eventSchema !== contribution.eventSchema ||
          !point.implementations.includes(contribution.implementation)
        )
          throw new ModuleFrameworkError('incompatible-contract', [id])
        if (
          !trusted &&
          (point.trust === 'trusted-built-in' || contribution.implementation !== 'declarative')
        )
          throw new ModuleFrameworkError('untrusted-contribution', [id])
        if (
          !LOCAL_ID.test(contribution.implementationId) ||
          !point.groups.includes(contribution.group) ||
          !Number.isSafeInteger(contribution.order) ||
          Math.abs(contribution.order) > 10000
        )
          throw new ModuleFrameworkError('invalid-contribution', [id])
        if (contribution.when) validateModuleWhen(contribution.when)
        if (contribution.scope) {
          const allowed: Record<string, readonly string[]> = {
            runtimes: ['userscript', 'tauri'],
            forms: ['desktop', 'mobile'],
            areas: point.scopeValues?.areas ?? [],
            listTypes: point.scopeValues?.listTypes ?? [],
          }
          for (const [field, values] of Object.entries(contribution.scope)) {
            if (
              !allowed[field] ||
              !Array.isArray(values) ||
              values.length === 0 ||
              values.some((value) => !allowed[field]!.includes(value))
            )
              throw new ModuleFrameworkError('invalid-scope', [id, field])
          }
        }
        ids.add(id)
        contributions.push({ ...contribution, id, ownerId: module.id })
      }
    }
    contributions.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    this.registrations = entries
    this.snapshot = freezeModuleData({ revision: this.snapshot.revision + 1, contributions })
    return this.snapshot
  }
}
