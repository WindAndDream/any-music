import { ModuleFrameworkError } from './module-contracts'
import type { ModuleDescriptor, ServiceRequirement } from './module-contracts'

export interface ModuleDependencies {
  order: readonly string[]
  dependencies: ReadonlyMap<string, readonly string[]>
  optionalMissing: readonly { ownerId: string; serviceId: string }[]
}

/** No service locator: resolve versioned tokens to one explicit provider before any activation. */
export function resolveModuleDependencies(
  modules: readonly ModuleDescriptor[],
  roots: readonly string[],
): ModuleDependencies {
  const byId = new Map(modules.map((module) => [module.id, module]))
  const providers = new Map<string, ModuleDescriptor>()
  for (const module of modules.toSorted((a, b) => (a.id < b.id ? -1 : 1))) {
    for (const service of module.provides) {
      if (providers.has(service.id))
        throw new ModuleFrameworkError('provider-conflict', [service.id])
      providers.set(service.id, module)
    }
  }
  const order: string[] = []
  const dependencies = new Map<string, readonly string[]>()
  const optionalMissing: { ownerId: string; serviceId: string }[] = []
  const visiting: string[] = []
  function visit(id: string): void {
    if (order.includes(id)) return
    if (visiting.includes(id)) throw new ModuleFrameworkError('dependency-cycle', [...visiting, id])
    const module = byId.get(id)
    if (!module) throw new ModuleFrameworkError('dependency-missing', [...visiting, id])
    visiting.push(id)
    const resolved: string[] = []
    function resolve(requirement: ServiceRequirement, optional: boolean): void {
      const provider = providers.get(requirement.id)
      const version = provider?.provides.find((service) => service.id === requirement.id)?.version
      if (!provider || version !== requirement.version) {
        if (optional) {
          optionalMissing.push({ ownerId: id, serviceId: requirement.id })
          return
        }
        throw new ModuleFrameworkError(provider ? 'dependency-version' : 'dependency-missing', [
          ...visiting,
          requirement.id,
        ])
      }
      visit(provider.id)
      resolved.push(provider.id)
    }
    for (const requirement of module.requires) resolve(requirement, false)
    for (const requirement of module.optional) resolve(requirement, true)
    dependencies.set(id, resolved)
    visiting.pop()
    order.push(id)
  }
  for (const root of [...new Set(roots)].toSorted()) visit(root)
  return { order, dependencies, optionalMissing }
}
