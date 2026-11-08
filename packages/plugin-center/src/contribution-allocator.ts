import { matchesModuleScope, matchesModuleWhen } from './module-conditions'
import { freezeModuleData, ModuleFrameworkError } from './module-contracts'
import type {
  AllocationInput,
  AllocationReason,
  AllocationSnapshot,
  ExtensionPoint,
  ModuleState,
  ModuleDescriptor,
  RegistrySnapshot,
  RegisteredContribution,
} from './module-contracts'
import { resolveModuleDependencies } from './module-dependencies'

/** Pure, deterministic selection. It neither activates a module nor grants a permission. */
export function allocateContributions(
  options: AllocationInput & {
    registry: RegistrySnapshot
    points: readonly ExtensionPoint[]
    states: ReadonlyMap<string, ModuleState>
    modules: readonly ModuleDescriptor[]
    lifecycleGeneration: number
    permissionEpoch: number
    isAuthorized(ownerId: string): boolean
    allowInactive?: boolean
  },
): AllocationSnapshot {
  const slots: Record<string, readonly string[]> = Object.create(null)
  const diagnostics: { id: string; reason: AllocationReason }[] = []
  const diagnose = (id: string, reason: AllocationReason) => diagnostics.push({ id, reason })
  const usableModules = options.modules.filter((module) => {
    const state = options.states.get(module.id)
    return (
      state?.installed &&
      state.enabled &&
      state.availability !== 'unavailable' &&
      state.activation !== 'failed' &&
      state.activation !== 'suspended' &&
      options.isAuthorized(module.id)
    )
  })
  const dependencyReasons = new Map<string, AllocationReason>()
  for (const module of usableModules) {
    try {
      resolveModuleDependencies(usableModules, [module.id])
    } catch (error) {
      dependencyReasons.set(
        module.id,
        error instanceof ModuleFrameworkError &&
          [
            'dependency-missing',
            'dependency-version',
            'dependency-cycle',
            'provider-conflict',
          ].includes(error.reason)
          ? (error.reason as AllocationReason)
          : 'dependency-missing',
      )
    }
  }
  for (const point of options.points) {
    const candidates = options.registry.contributions
      .filter((entry) => entry.pointId === point.id)
      .filter((entry) => {
        const state = options.states.get(entry.ownerId)
        let reason: AllocationReason | undefined
        if (!state?.installed || !state.enabled) reason = 'disabled'
        else if (state.activation === 'failed' || state.activation === 'suspended')
          reason = 'failed'
        else if (state.availability === 'unavailable') reason = 'unavailable'
        else if (!options.isAuthorized(entry.ownerId)) reason = 'permission-denied'
        else if (dependencyReasons.has(entry.ownerId)) reason = dependencyReasons.get(entry.ownerId)
        else if (entry.scope?.runtimes && !entry.scope.runtimes.includes(options.context.runtime))
          reason = 'unsupported-runtime'
        else if (
          !matchesModuleScope(entry.scope, options.context) ||
          !matchesModuleWhen(entry.when, options.context)
        )
          reason = 'scope-mismatch'
        else if (!options.allowInactive && state.activation !== 'active') reason = 'inactive'
        if (reason) diagnose(entry.id, reason)
        return !reason
      })
    const compare = (a: RegisteredContribution, b: RegisteredContribution): number => {
      const group = point.groups.indexOf(a.group) - point.groups.indexOf(b.group)
      if (group !== 0) return group
      // Preferences reorder only within host-controlled groups.
      const order = options.userOrder ?? []
      const ai = order.indexOf(a.id),
        bi = order.indexOf(b.id)
      if (ai >= 0 || bi >= 0) return (ai < 0 ? Infinity : ai) - (bi < 0 ? Infinity : bi)
      return a.order - b.order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
    }
    candidates.sort(compare)
    let selected: RegisteredContribution[]
    if (point.cardinality === 'single') {
      const preference = options.selections?.[point.id]
      const preferred = candidates.find((entry) => entry.id === preference)
      if (preference && !preferred) diagnose(preference, 'selection-unavailable')
      const theme = candidates.find((entry) => entry.id === options.themeMappings?.[point.id])
      const fallback = candidates.find((entry) => entry.id === point.defaultContributionId)
      const winner =
        preferred ?? theme ?? fallback ?? (candidates.length === 1 ? candidates[0] : undefined)
      selected = winner ? [winner] : []
      if (!winner && candidates.length > 1)
        candidates.forEach((entry) => diagnose(entry.id, 'conflict'))
    } else selected = candidates.slice(0, point.maxContributions)
    for (const candidate of candidates)
      if (!selected.includes(candidate)) diagnose(candidate.id, 'not-selected')
    slots[point.id] = selected.map((entry) => entry.id)
  }
  return freezeModuleData({
    registryRevision: options.registry.revision,
    lifecycleGeneration: options.lifecycleGeneration,
    permissionEpoch: options.permissionEpoch,
    slots,
    diagnostics,
  })
}
