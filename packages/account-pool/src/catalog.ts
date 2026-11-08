import { CancellationSource, validateAttemptPolicy } from '@any-music/network-routing'
import type { AttemptPolicy, RoutingCancellation } from '@any-music/network-routing'

export type AccountStatus =
  | 'ready'
  | 'signed-out'
  | 'expired'
  | 'verification-required'
  | 'network-blocked'

/** Public identity and operational metadata only; login secrets belong to a runtime vault. */
export interface AccountProfile {
  id: string
  platformId: string
  name: string
  authentication: 'credential' | 'anonymous'
  credentialKey?: string
  platformUserId?: string
  username?: string
  enabled: boolean
  status: AccountStatus
}

export interface AccountOperationPolicy extends AttemptPolicy {
  selection: 'random' | 'shuffle'
  /** Undefined means all eligible accounts; an empty list intentionally disables this operation. */
  accountIds?: readonly string[]
}

export interface AccountLease {
  account: Readonly<AccountProfile>
  cancellation: RoutingCancellation
  release(): void
}

interface AccountEntry {
  profile: Readonly<AccountProfile>
  leases: Set<CancellationSource>
}

/** Each platform owns independent account IDs; no secret or transport is stored in this catalog. */
export class AccountCatalog {
  private readonly accounts = new Map<string, AccountEntry>()
  private readonly policies = new Map<string, Readonly<AccountOperationPolicy>>()

  save(input: AccountProfile): Readonly<AccountProfile> {
    const profile = Object.freeze(validateAccountProfile(input))
    const previous = this.accounts.get(profile.id)
    if (!previous && this.accounts.size >= 256) throw new RangeError('Too many accounts.')
    if (
      previous &&
      (previous.profile.platformId !== profile.platformId ||
        previous.profile.authentication !== profile.authentication)
    ) {
      throw new TypeError('Account platform and authentication mode are immutable.')
    }
    for (const entry of this.accounts.values()) {
      if (entry.profile.id === profile.id || entry.profile.platformId !== profile.platformId)
        continue
      if (entry.profile.name === profile.name)
        throw new TypeError('Duplicate account name within platform.')
      if (profile.platformUserId && entry.profile.platformUserId === profile.platformUserId) {
        throw new TypeError('Platform identity is already registered.')
      }
    }
    const mustInvalidate =
      previous &&
      (previous.profile.credentialKey !== profile.credentialKey ||
        previous.profile.platformUserId !== profile.platformUserId ||
        previous.profile.enabled !== profile.enabled ||
        previous.profile.status !== profile.status)
    this.accounts.set(profile.id, {
      profile,
      leases: mustInvalidate ? new Set() : (previous?.leases ?? new Set()),
    })
    if (mustInvalidate) for (const source of previous.leases) source.cancel()
    return profile
  }

  remove(id: string): void {
    const entry = this.accounts.get(id)
    this.accounts.delete(id)
    if (entry) for (const source of entry.leases) source.cancel()
    // Keep an explicit selection explicit, even when deleting its last account.
    for (const [key, policy] of this.policies) {
      if (policy.accountIds?.includes(id)) {
        this.policies.set(
          key,
          Object.freeze({
            ...policy,
            accountIds: Object.freeze(policy.accountIds.filter((accountId) => accountId !== id)),
          }),
        )
      }
    }
  }

  get(id: string): Readonly<AccountProfile> | undefined {
    return this.accounts.get(id)?.profile
  }

  list(platformId?: string): readonly Readonly<AccountProfile>[] {
    return [...this.accounts.values()]
      .map((entry) => entry.profile)
      .filter((account) => platformId === undefined || account.platformId === platformId)
  }

  savePolicy(platformId: string, operation: string, input: AccountOperationPolicy): void {
    const key = operationKey(platformId, operation)
    const policy = validateAccountOperationPolicy(input)
    if (!this.policies.has(key) && this.policies.size >= 512)
      throw new RangeError('Too many account policies.')
    for (const id of policy.accountIds ?? []) {
      if (this.get(id)?.platformId !== platformId)
        throw new TypeError('Policy contains an unknown or foreign platform account.')
    }
    this.policies.set(key, Object.freeze(policy))
  }

  getPolicy(platformId: string, operation: string): Readonly<AccountOperationPolicy> | undefined {
    return this.policies.get(operationKey(platformId, operation))
  }

  eligible(
    platformId: string,
    policy: AccountOperationPolicy,
  ): readonly Readonly<AccountProfile>[] {
    const allowed = policy.accountIds === undefined ? undefined : new Set(policy.accountIds)
    return this.list(platformId).filter(
      (account) =>
        account.enabled && account.status === 'ready' && (!allowed || allowed.has(account.id)),
    )
  }

  acquire(id: string): AccountLease | undefined {
    const entry = this.accounts.get(id)
    if (!entry || !entry.profile.enabled || entry.profile.status !== 'ready') return undefined
    const source = new CancellationSource()
    entry.leases.add(source)
    return {
      account: entry.profile,
      cancellation: source.signal,
      release: () => entry.leases.delete(source),
    }
  }
}

export function operationKey(platformId: string, operation: string): string {
  for (const value of [platformId, operation]) {
    if (!/^[a-zA-Z0-9_.:-]{1,128}$/.test(value)) throw new TypeError('Invalid operation scope.')
  }
  // Length-prefix prevents ':' in a plugin ID from colliding with ':' in an operation ID.
  return `${platformId.length}:${platformId}${operation}`
}

export function validateAccountProfile(input: AccountProfile): AccountProfile {
  operationKey(input.platformId, 'account')
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(input.id)) throw new TypeError('Invalid account identifier.')
  const name = label(input.name)
  const username = input.username === undefined ? undefined : label(input.username)
  if (input.authentication !== 'credential' && input.authentication !== 'anonymous')
    throw new TypeError('Invalid account authentication mode.')
  if (
    input.authentication === 'credential' &&
    !/^[a-zA-Z0-9_-]{1,128}$/.test(input.credentialKey ?? '')
  )
    throw new TypeError('Authenticated accounts require a vault reference.')
  if (input.authentication === 'anonymous' && input.credentialKey !== undefined)
    throw new TypeError('Anonymous accounts cannot reference credentials.')
  if (input.platformUserId !== undefined && !/^[a-zA-Z0-9_.:-]{1,128}$/.test(input.platformUserId))
    throw new TypeError('Invalid platform user identifier.')
  if (
    typeof input.enabled !== 'boolean' ||
    !['ready', 'signed-out', 'expired', 'verification-required', 'network-blocked'].includes(
      input.status,
    )
  )
    throw new TypeError('Invalid account state.')
  // Construct a whitelist: unknown input fields (cookies, tokens, passwords) never enter snapshots.
  return {
    id: input.id,
    platformId: input.platformId,
    name,
    authentication: input.authentication,
    enabled: input.enabled,
    status: input.status,
    ...(input.credentialKey === undefined ? {} : { credentialKey: input.credentialKey }),
    ...(input.platformUserId === undefined ? {} : { platformUserId: input.platformUserId }),
    ...(username === undefined ? {} : { username }),
  }
}

export function validateAccountOperationPolicy(
  input: AccountOperationPolicy,
): AccountOperationPolicy {
  const policy = validateAttemptPolicy(input)
  if (input.selection !== 'random' && input.selection !== 'shuffle')
    throw new TypeError('Invalid account selection.')
  if (
    input.accountIds !== undefined &&
    (input.accountIds.length > 256 ||
      new Set(input.accountIds).size !== input.accountIds.length ||
      input.accountIds.some((id) => !/^[a-zA-Z0-9_-]{1,128}$/.test(id)))
  )
    throw new TypeError('Invalid account selection range.')
  return {
    mode: policy.mode,
    concurrency: policy.concurrency,
    attemptTimeoutMs: policy.attemptTimeoutMs,
    totalTimeoutMs: policy.totalTimeoutMs,
    selection: input.selection,
    ...(input.accountIds === undefined ? {} : { accountIds: Object.freeze([...input.accountIds]) }),
  }
}

function label(value: string): string {
  const normalized = value.normalize('NFC').trim()
  if (!normalized || normalized.length > 64 || /\p{Cc}/u.test(normalized))
    throw new TypeError('Account name must contain 1–64 printable characters.')
  return normalized
}
