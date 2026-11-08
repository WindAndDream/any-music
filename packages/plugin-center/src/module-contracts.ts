/** Trusted host contracts. These tokens and implementation IDs are never an external SDK. */
export type ModuleRuntime = 'userscript' | 'tauri'
export type ModuleForm = 'desktop' | 'mobile'
export interface ModuleContext {
  runtime: ModuleRuntime
  form: ModuleForm
  area: string
  listType?: string
  selectionCount: number
  hasTrack: boolean
}
export type ContextField = keyof ModuleContext
export type WhenExpression =
  | { field: ContextField; equals: string | number | boolean }
  | { all: readonly WhenExpression[] }
  | { any: readonly WhenExpression[] }
  | { not: WhenExpression }
export interface ContributionScope {
  runtimes?: readonly ModuleRuntime[]
  forms?: readonly ModuleForm[]
  areas?: readonly string[]
  listTypes?: readonly string[]
}
export interface ExtensionPoint {
  id: string
  version: number
  inputSchema: string
  eventSchema: string
  cardinality: 'single' | 'multiple'
  implementations: readonly ('host-component' | 'host-command' | 'declarative')[]
  trust: 'trusted-built-in' | 'public'
  defaultContributionId?: string
  groups: readonly string[]
  maxContributions: number
  /** Host-owned scope vocabulary; absence permits no area/list-type restriction in definitions. */
  scopeValues?: { areas: readonly string[]; listTypes: readonly string[] }
}
export interface ModuleContribution {
  localId: string
  pointId: string
  contractVersion: number
  inputSchema: string
  eventSchema: string
  implementation: 'host-component' | 'host-command' | 'declarative'
  implementationId: string
  scope?: ContributionScope
  when?: WhenExpression
  group: string
  order: number
}
export interface ServiceRequirement {
  id: string
  version: number
}
export interface ModuleDescriptor {
  id: string
  name: string
  /** Build-owned maintenance notice, independent of user enablement and runtime activation. */
  developmentStatus?: 'stable' | 'updating' | 'fixing' | 'developing' | 'disabled'
  /** Build-owned startup gate; a reason keeps this module disabled until the build removes it. */
  unavailableReason?: string
  version: number
  /** Host build identity, not an editable manifest field or authorization record. */
  installationId: string
  contentHash: string
  required: boolean
  provides: readonly ServiceRequirement[]
  requires: readonly ServiceRequirement[]
  optional: readonly ServiceRequirement[]
  contributions: readonly ModuleContribution[]
}
export interface ModuleState {
  installed: boolean
  enabled: boolean
  activation: 'inactive' | 'activating' | 'active' | 'failed' | 'suspended'
  availability: 'unchecked' | 'available' | 'unavailable'
  login: 'unknown' | 'not-required' | 'signed-in' | 'signed-out'
  generation: number
}
export interface ModuleCommandContext extends ModuleContext {
  userGesture: boolean
  objectRevision: number
  viewRevision: number
}
export interface ModuleCommand {
  localId: string
  /** Re-read authoritative object/view versions here; a previous visibility check is insufficient. */
  validate(context: ModuleCommandContext): boolean
  execute(context: ModuleCommandContext): unknown | Promise<unknown>
}
export interface ModuleActivationScope {
  readonly isCurrent: () => boolean
  /** Register cleanup immediately, including resources acquired before an activation throws. */
  defer(dispose: () => void | Promise<void>): void
}
export interface ModuleInstance {
  contributionIds: readonly string[]
  commands?: readonly ModuleCommand[]
}
export interface BuiltInModule {
  descriptor: ModuleDescriptor
  activate(scope: ModuleActivationScope): ModuleInstance | Promise<ModuleInstance>
}
export interface RegisteredContribution extends ModuleContribution {
  ownerId: string
  id: string
}
export interface RegistrySnapshot {
  revision: number
  contributions: readonly RegisteredContribution[]
}
export type AllocationReason =
  | 'disabled'
  | 'failed'
  | 'inactive'
  | 'unavailable'
  | 'unsupported-runtime'
  | 'permission-denied'
  | 'incompatible-contract'
  | 'scope-mismatch'
  | 'not-selected'
  | 'selection-unavailable'
  | 'conflict'
  | 'dependency-missing'
  | 'dependency-version'
  | 'dependency-cycle'
  | 'provider-conflict'
export interface AllocationSnapshot {
  registryRevision: number
  lifecycleGeneration: number
  permissionEpoch: number
  slots: Readonly<Record<string, readonly string[]>>
  diagnostics: readonly { id: string; reason: AllocationReason }[]
}
export interface AllocationInput {
  context: ModuleContext
  selections?: Readonly<Record<string, string>>
  themeMappings?: Readonly<Record<string, string>>
  userOrder?: readonly string[]
}
export class ModuleFrameworkError extends Error {
  readonly reason: string
  readonly path: readonly string[]
  constructor(reason: string, path: readonly string[]) {
    super(`${reason}: ${path.join(' -> ')}`)
    this.name = 'ModuleFrameworkError'
    this.reason = reason
    this.path = path
  }
}

/** Freeze copied descriptors rather than caller-owned data; live business objects never enter here. */
export function freezeModuleData<T>(value: T): T {
  if (Array.isArray(value)) return Object.freeze(value.map(freezeModuleData)) as T
  if (value && typeof value === 'object') {
    return Object.freeze(
      Object.fromEntries(Object.entries(value).map(([key, item]) => [key, freezeModuleData(item)])),
    ) as T
  }
  return value
}
