/* eslint-disable no-await-in-loop -- Dependency activation and reverse resource cleanup must be sequential. */
import { allocateContributions } from './contribution-allocator'
import { ContributionRegistry } from './contribution-registry'
import { matchesModuleScope, matchesModuleWhen } from './module-conditions'
import { freezeModuleData, ModuleFrameworkError } from './module-contracts'
import type {
  AllocationInput,
  AllocationSnapshot,
  BuiltInModule,
  ExtensionPoint,
  ModuleCommandContext,
  ModuleDescriptor,
  ModuleInstance,
  ModuleState,
} from './module-contracts'
import { resolveModuleDependencies } from './module-dependencies'
import type { ModuleFailureRecord } from './module-recovery'
import { PluginCatalog } from './plugin-catalog'

interface Activation {
  instance: ModuleInstance
  dispose(): Promise<void>
}
interface ModuleEntry extends BuiltInModule {
  state: ModuleState
  active?: Activation
  prepared?: Activation
  pending?: Promise<Activation>
  cancelPending?: () => Promise<void>
}
export interface ModuleControllerOptions {
  /** Only the application build directory can supply executable modules. No external install API. */
  builtIns: readonly BuiltInModule[]
  points: readonly ExtensionPoint[]
  readCommandContext(): ModuleCommandContext
  /** Read-only projection of native authority. This controller never stores or creates grants. */
  readPolicy?(): { permissionEpoch: number; isAuthorized(ownerId: string): boolean }
  onRequiredFailure?(failure: ModuleFailureRecord): void
  onCleanupFailure?(ownerId: string): void
}

/** Serial atomic publication with per-module coalescing and synchronous invalidation barriers. */
export class ModuleController {
  private readonly catalog: PluginCatalog<ModuleEntry>
  private readonly registry: ContributionRegistry
  private lifecycleGeneration = 0
  private queue: Promise<unknown> = Promise.resolve()
  private readonly activationRequests = new Map<string, Promise<AllocationSnapshot>>()
  private snapshot: AllocationSnapshot
  private lastInput: AllocationInput
  private readonly listeners = new Set<(snapshot: AllocationSnapshot) => void>()
  private disposed = false
  private readonly options: ModuleControllerOptions

  constructor(options: ModuleControllerOptions) {
    this.options = options
    this.registry = new ContributionRegistry(options.points)
    this.catalog = new PluginCatalog(options.builtIns.map((module) => this.createEntry(module)))
    this.register(this.catalog.plugins)
    this.lastInput = { context: options.readCommandContext() }
    this.snapshot = this.allocate(this.lastInput)
  }

  get allocation(): AllocationSnapshot {
    return this.snapshot
  }
  get definitions() {
    return this.registry.current
  }
  get states(): ReadonlyMap<string, ModuleState> {
    return new Map(
      this.catalog.plugins.map((entry) => [entry.descriptor.id, freezeModuleData(entry.state)]),
    )
  }
  get descriptors(): readonly ModuleDescriptor[] {
    return this.catalog.plugins.map((entry) => entry.descriptor)
  }

  subscribe(listener: (snapshot: AllocationSnapshot) => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /** Static discovery can select candidates without executing any factory. */
  preview(input: AllocationInput): AllocationSnapshot {
    return this.allocate(input, true)
  }

  activate(
    ids: readonly string[],
    input: AllocationInput = this.lastInput,
  ): Promise<AllocationSnapshot> {
    const generation = this.lifecycleGeneration
    const permissionEpoch = this.policy().permissionEpoch
    const requestedIds = Object.freeze([...new Set(ids)])
    const capturedInput = freezeModuleData(input)
    const key = JSON.stringify([
      generation,
      permissionEpoch,
      requestedIds.toSorted(),
      capturedInput,
    ])
    const existing = this.activationRequests.get(key)
    if (existing) return existing
    const run = this.queue
      .then(() => this.activateBatch(requestedIds, capturedInput, generation, permissionEpoch))
      .finally(() => {
        if (this.activationRequests.get(key) === run) this.activationRequests.delete(key)
      })
    this.activationRequests.set(key, run)
    // Failed batches do not poison the serial publication queue.
    this.queue = run.catch(() => {})
    return run
  }

  async start(input: AllocationInput = this.lastInput): Promise<AllocationSnapshot> {
    return this.activate(
      this.descriptors.filter((module) => module.required).map((module) => module.id),
      input,
    )
  }

  /** Selected modules activate together; a failed preparation retains the prior valid snapshot. */
  async select(input: AllocationInput): Promise<AllocationSnapshot> {
    const candidate = this.preview(input)
    const owners = new Set(
      Object.values(candidate.slots)
        .flat()
        .map((id) => id.split('/')[0]!),
    )
    return this.activate([...owners], input)
  }

  setEnabled(id: string, enabled: boolean): Promise<void> {
    const entry = this.getEntry(id)
    if (enabled && entry.descriptor.unavailableReason)
      throw new ModuleFrameworkError('module-unavailable', [id])
    if (entry.descriptor.required && !enabled)
      throw new ModuleFrameworkError('required-module', [id])
    if (
      !enabled &&
      this.dependentsOf(id).some((ownerId) => this.getEntry(ownerId).descriptor.required)
    )
      throw new ModuleFrameworkError('required-dependent', [id])
    if (entry.state.enabled === enabled) return Promise.resolve()
    if (enabled) {
      const cleanup = this.invalidate([], 'inactive')
      entry.state = {
        ...entry.state,
        enabled: true,
        activation: 'inactive',
        generation: entry.state.generation + 1,
      }
      this.publish(this.allocate(this.lastInput))
      return cleanup
    }
    return this.invalidate(this.dependentsOf(id), 'inactive', id)
  }

  /** Application upgrade/reload only. Core providers are fixed for this host lifetime. */
  async replaceBuiltIn(module: BuiltInModule): Promise<void> {
    const previous = this.getEntry(module.descriptor.id)
    if (previous.descriptor.required)
      throw new ModuleFrameworkError('required-module', [module.descriptor.id])
    const replacement = this.createEntry(module)
    replacement.state = {
      ...replacement.state,
      enabled: previous.state.enabled && !replacement.descriptor.unavailableReason,
    }
    const candidates = this.catalog.plugins.map((entry) =>
      entry === previous ? replacement : entry,
    )
    // Validate on a temporary registry, preserving the current revision if validation fails.
    const probe = new ContributionRegistry(this.registry.points)
    probe.replace(
      candidates.map((entry) => entry.descriptor),
      new Set(candidates.map((entry) => entry.descriptor.id)),
    )
    this.catalog.assertCanReplace(replacement.descriptor)
    const cleanup = this.invalidate(
      this.dependentsOf(previous.descriptor.id),
      'inactive',
      previous.descriptor.id,
    )
    this.catalog.replace(replacement)
    this.register(this.catalog.plugins)
    this.publish(this.allocate(this.lastInput))
    await cleanup
  }

  /** Permission revocation removes old selections immediately; cleanup never delays the barrier. */
  refreshPolicy(): Promise<void> {
    const rejected = this.catalog.plugins.filter(
      (entry) => !this.policy().isAuthorized(entry.descriptor.id),
    )
    const affected = new Set(rejected.flatMap((entry) => this.dependentsOf(entry.descriptor.id)))
    return this.invalidate([...affected], 'suspended')
  }

  updateAvailability(
    id: string,
    availability: ModuleState['availability'],
    login: ModuleState['login'],
  ): Promise<void> {
    const entry = this.getEntry(id)
    entry.state = { ...entry.state, availability, login }
    if (availability === 'unavailable') return this.invalidate(this.dependentsOf(id), 'suspended')
    this.publish(this.allocate(this.lastInput))
    return Promise.resolve()
  }

  async executeCommand(
    id: string,
    expected: { objectRevision: number; viewRevision: number },
  ): Promise<unknown> {
    const definition = this.registry.current.contributions.find(
      (entry) => entry.id === id && entry.implementation === 'host-command',
    )
    if (!definition) throw new ModuleFrameworkError('unknown-command', [id])
    const generation = this.lifecycleGeneration
    const epoch = this.policy().permissionEpoch
    const expectedContext = { ...expected }
    await this.activate([definition.ownerId])
    const entry = this.getEntry(definition.ownerId)
    const command = entry.active?.instance.commands?.find(
      (item) => item.localId === definition.localId,
    )
    const context = freezeModuleData(this.options.readCommandContext())
    if (
      generation !== this.lifecycleGeneration ||
      epoch !== this.policy().permissionEpoch ||
      !this.canUse(entry) ||
      entry.state.activation !== 'active' ||
      !context.userGesture ||
      context.objectRevision !== expectedContext.objectRevision ||
      context.viewRevision !== expectedContext.viewRevision ||
      !matchesModuleScope(definition.scope, context) ||
      !matchesModuleWhen(definition.when, context) ||
      !command?.validate(context)
    )
      throw new ModuleFrameworkError('command-context-denied', [id])
    const result = await command.execute(context)
    if (
      generation !== this.lifecycleGeneration ||
      epoch !== this.policy().permissionEpoch ||
      !this.canUse(entry)
    )
      throw new ModuleFrameworkError('stale-command', [id])
    return result
  }

  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    await this.invalidate(
      this.catalog.plugins.map((entry) => entry.descriptor.id),
      'suspended',
    )
    this.listeners.clear()
  }

  private createEntry(module: BuiltInModule): ModuleEntry {
    return {
      descriptor: freezeModuleData(module.descriptor),
      activate: module.activate,
      state: {
        installed: true,
        enabled: !module.descriptor.unavailableReason,
        activation: 'inactive',
        availability: 'unchecked',
        login: 'unknown',
        generation: 0,
      },
    }
  }
  private register(entries: readonly ModuleEntry[]): void {
    this.registry.replace(
      entries.map((entry) => entry.descriptor),
      new Set(entries.map((entry) => entry.descriptor.id)),
    )
  }
  private getEntry(id: string): ModuleEntry {
    const entry = this.catalog.get(id)
    if (!entry) throw new ModuleFrameworkError('module-missing', [id])
    return entry
  }
  private policy() {
    return this.options.readPolicy?.() ?? { permissionEpoch: 0, isAuthorized: () => true }
  }
  private canUse(entry: ModuleEntry): boolean {
    return (
      !this.disposed &&
      !entry.descriptor.unavailableReason &&
      entry.state.enabled &&
      entry.state.availability !== 'unavailable' &&
      this.policy().isAuthorized(entry.descriptor.id)
    )
  }
  private allocate(input: AllocationInput, allowInactive = false): AllocationSnapshot {
    const policy = this.policy()
    return allocateContributions({
      ...input,
      registry: this.registry.current,
      points: this.registry.points,
      states: this.states,
      modules: this.descriptors,
      lifecycleGeneration: this.lifecycleGeneration,
      permissionEpoch: policy.permissionEpoch,
      isAuthorized: policy.isAuthorized,
      allowInactive,
    })
  }
  private publish(snapshot: AllocationSnapshot): void {
    this.snapshot = snapshot
    for (const listener of this.listeners) {
      try {
        listener(snapshot)
      } catch {
        /* Observers cannot roll back a commit. */
      }
    }
  }

  private async activateBatch(
    ids: readonly string[],
    input: AllocationInput,
    generation: number,
    permissionEpoch: number,
  ): Promise<AllocationSnapshot> {
    const created: { entry: ModuleEntry; activation: Activation }[] = []
    let preparingId: string | undefined
    const assertCurrent = () => {
      if (
        this.disposed ||
        generation !== this.lifecycleGeneration ||
        permissionEpoch !== this.policy().permissionEpoch
      )
        throw new ModuleFrameworkError('stale-activation', ids)
    }
    try {
      assertCurrent()
      const graph = resolveModuleDependencies(
        this.descriptors.filter((module) => this.getEntry(module.id).state.enabled),
        ids,
      )
      for (const id of graph.order) {
        const entry = this.getEntry(id)
        if (!this.canUse(entry)) throw new ModuleFrameworkError('module-unavailable', [id])
        if (entry.active) continue
        preparingId = id
        const activation = await this.prepare(entry)
        created.push({ entry, activation })
        assertCurrent()
      }
      assertCurrent()
      // Check the entire required contract set before publishing any runtime instance.
      for (const { entry, activation } of created) {
        const actual = activation.instance.contributionIds
        const declared = entry.descriptor.contributions.map((item) => item.localId)
        if (
          actual.length !== declared.length ||
          new Set(actual).size !== actual.length ||
          actual.some((id) => !declared.includes(id))
        )
          throw new ModuleFrameworkError('activation-contract', [entry.descriptor.id])
        const commands = activation.instance.commands ?? []
        const commandIds = entry.descriptor.contributions
          .filter((item) => item.implementation === 'host-command')
          .map((item) => item.localId)
        if (
          new Set(commands.map((command) => command.localId)).size !== commands.length ||
          commands.length !== commandIds.length ||
          commands.some((command) => !commandIds.includes(command.localId))
        )
          throw new ModuleFrameworkError('activation-contract', [entry.descriptor.id])
      }
      for (const { entry, activation } of created) {
        entry.active = activation
        entry.prepared = undefined
        entry.state = { ...entry.state, activation: 'active' }
      }
      this.lastInput = input
      this.publish(this.allocate(input))
      return this.snapshot
    } catch (error) {
      for (const { entry, activation } of created.toReversed()) {
        await activation.dispose()
        if (entry.prepared === activation) entry.prepared = undefined
        if (!entry.active && entry.state.activation === 'activating')
          entry.state = {
            ...entry.state,
            activation:
              error instanceof ModuleFrameworkError &&
              error.reason === 'activation-contract' &&
              error.path[0] === entry.descriptor.id
                ? 'failed'
                : 'inactive',
          }
      }
      const requiredIds = ids.filter((id) => this.catalog.get(id)?.descriptor.required)
      if (
        preparingId &&
        this.catalog.get(preparingId)?.descriptor.required &&
        !requiredIds.includes(preparingId)
      )
        requiredIds.push(preparingId)
      if (requiredIds.length && generation === this.lifecycleGeneration && !this.disposed)
        this.options.onRequiredFailure?.({
          moduleIds: requiredIds,
          reason: error instanceof ModuleFrameworkError ? error.reason : 'activation-failed',
        })
      throw error
    }
  }

  private prepare(entry: ModuleEntry): Promise<Activation> {
    if (entry.pending) return entry.pending
    const generation = entry.state.generation
    const isCurrent = () =>
      !disposed &&
      this.catalog.get(entry.descriptor.id) === entry &&
      generation === entry.state.generation &&
      this.canUse(entry)
    const cleanup: (() => void | Promise<void>)[] = []
    let rejectCancellation!: (reason: unknown) => void
    const cancelled = new Promise<never>((_, reject) => {
      rejectCancellation = reject
    })
    let disposed = false
    let disposal: Promise<void> | undefined
    const dispose = (): Promise<void> => {
      if (disposal) return disposal
      disposed = true
      disposal = Promise.resolve().then(async () => {
        for (const release of cleanup.toReversed()) {
          try {
            await release()
          } catch {
            try {
              this.options.onCleanupFailure?.(entry.descriptor.id)
            } catch {
              /* Diagnostic observers cannot stop cleanup. */
            }
          }
        }
      })
      return disposal
    }
    entry.cancelPending = async () => {
      const releasing = dispose()
      rejectCancellation(new ModuleFrameworkError('stale-activation', [entry.descriptor.id]))
      await releasing
    }
    entry.state = { ...entry.state, activation: 'activating' }
    const loading = Promise.resolve().then(() => {
      if (!isCurrent()) throw new ModuleFrameworkError('stale-activation', [entry.descriptor.id])
      return entry.activate({
        isCurrent,
        defer: (release) => {
          if (disposed)
            void Promise.resolve()
              .then(release)
              .catch(() => this.options.onCleanupFailure?.(entry.descriptor.id))
          else cleanup.push(release)
        },
      })
    })
    const pending = Promise.race([loading, cancelled])
      .then(async (instance) => {
        if (!isCurrent()) {
          await dispose()
          throw new ModuleFrameworkError('stale-activation', [entry.descriptor.id])
        }
        const activation = { instance: freezeModuleData(instance), dispose }
        entry.prepared = activation
        return activation
      })
      .catch(async (error: unknown) => {
        const wasCurrent = isCurrent()
        await dispose()
        if (wasCurrent) entry.state = { ...entry.state, activation: 'failed' }
        throw error
      })
      .finally(() => {
        if (entry.pending === pending) {
          entry.pending = undefined
          entry.cancelPending = undefined
        }
      })
    entry.pending = pending
    return pending
  }

  private dependentsOf(id: string): string[] {
    const affected = new Set([id])
    let changed = true
    while (changed) {
      changed = false
      const tokens = new Set(
        this.descriptors
          .filter((module) => affected.has(module.id))
          .flatMap((module) => module.provides.map((service) => service.id)),
      )
      for (const module of this.descriptors) {
        if (
          !affected.has(module.id) &&
          [...module.requires, ...module.optional].some((service) => tokens.has(service.id))
        ) {
          affected.add(module.id)
          changed = true
        }
      }
    }
    return [...affected]
  }

  private async invalidate(
    ids: readonly string[],
    activation: 'inactive' | 'suspended',
    disabledId?: string,
  ): Promise<void> {
    this.lifecycleGeneration++
    // Any pending transaction predates this barrier. Cancel all staged resources, even for
    // unaffected owners, so a blocked loader cannot retain a half-prepared batch indefinitely.
    const targets = [
      ...new Set([
        ...ids,
        ...this.catalog.plugins
          .filter((entry) => entry.state.activation === 'activating')
          .map((entry) => entry.descriptor.id),
      ]),
    ]
    const cleanups: (() => Promise<void>)[] = []
    // Insertion order of active instances follows dependency topology; reverse it for cleanup.
    let order: readonly string[] = targets
    try {
      order = resolveModuleDependencies(this.descriptors, targets).order
    } catch {
      /* A broken graph still permits forced cleanup. */
    }
    for (const id of order.toReversed().filter((ownerId) => targets.includes(ownerId))) {
      const entry = this.getEntry(id)
      entry.state = {
        ...entry.state,
        enabled: id === disabledId ? false : entry.state.enabled,
        activation,
        generation: entry.state.generation + 1,
      }
      if (entry.active) {
        cleanups.push(entry.active.dispose)
        entry.active = undefined
      }
      if (entry.prepared) {
        cleanups.push(entry.prepared.dispose)
        entry.prepared = undefined
      }
      if (entry.cancelPending) cleanups.push(entry.cancelPending)
      entry.cancelPending = undefined
      entry.pending = undefined
    }
    this.publish(this.allocate(this.lastInput))
    const requiredIds = ids.filter((id) => this.getEntry(id).descriptor.required)
    if (!this.disposed && activation === 'suspended' && requiredIds.length)
      this.options.onRequiredFailure?.({
        moduleIds: requiredIds,
        reason: 'required-module-unavailable',
      })
    for (const cleanup of cleanups) await cleanup()
  }
}
