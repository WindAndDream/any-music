import { CancellationSource, RoutingError, runFirstSuccessful } from '@any-music/network-routing'
import type { AttemptResult, RoutingCancellation, RoutingClock } from '@any-music/network-routing'

import { AccountCatalog, validateAccountOperationPolicy } from './catalog'
import type { AccountOperationPolicy, AccountProfile } from './catalog'
import { AccountSelector } from './selection'

export interface AccountRequestOptions<Value> {
  catalog: AccountCatalog
  selector: AccountSelector
  platformId: string
  operation: string
  policy: AccountOperationPolicy
  clock: RoutingClock
  replaySafe: boolean
  cancellation?: RoutingCancellation
  execute(account: Readonly<AccountProfile>, cancellation: RoutingCancellation): Promise<Value>
  /** Runtime maps validated platform/proxy failures to account state; unknown failures must stop. */
  onFailure?: (error: unknown, account: Readonly<AccountProfile>) => 'retry' | 'stop'
}

/** Identity is fixed for the entire callback: signing, API calls and pagination share one lease. */
export function requestWithAccountPool<Value>(
  options: AccountRequestOptions<Value>,
): Promise<AttemptResult<Value>> {
  const policy = validateAccountOperationPolicy(options.policy)
  if (options.cancellation?.isCancelled()) return Promise.reject(new RoutingError('cancelled'))
  const candidates = options.selector.order(
    options.platformId,
    options.operation,
    options.catalog.eligible(options.platformId, policy),
    policy.selection,
  )
  return runFirstSuccessful({
    candidates,
    policy,
    clock: options.clock,
    replaySafe: options.replaySafe,
    cancellation: options.cancellation,
    isAvailable: (account) => {
      const current = options.catalog.get(account.id)
      return (
        current?.enabled === true &&
        current.status === 'ready' &&
        current.credentialKey === account.credentialKey
      )
    },
    execute: (account, context) => executeAccountAttempt(options, account, context.cancellation),
    onFailure: (error, account) => {
      // Removing/disabling an in-flight identity permits another candidate without accepting its data.
      const current = options.catalog.get(account.id)
      if (
        !current?.enabled ||
        current.status !== 'ready' ||
        current.credentialKey !== account.credentialKey
      )
        return 'retry'
      return options.onFailure?.(error, account) ?? 'stop'
    },
  })
}

async function executeAccountAttempt<Value>(
  options: AccountRequestOptions<Value>,
  account: Readonly<AccountProfile>,
  parent: RoutingCancellation,
): Promise<Value> {
  const lease = options.catalog.acquire(account.id)
  if (!lease) throw new RoutingError('no-candidates')
  const source = new CancellationSource()
  const detachParent = parent.subscribe(() => source.cancel())
  const detachLease = lease.cancellation.subscribe(() => source.cancel())
  let failure: unknown
  try {
    const result = await runFirstSuccessful({
      candidates: [lease.account],
      policy: { ...options.policy, mode: 'serial' },
      clock: options.clock,
      replaySafe: false,
      cancellation: source.signal,
      execute: (candidate, context) => options.execute(candidate, context.cancellation),
      onFailure: (error) => {
        failure = error
        return 'stop'
      },
    }).catch((error: unknown) => {
      if (error instanceof RoutingError && error.code === 'stopped' && failure !== undefined)
        throw failure
      throw error
    })
    return result.value
  } finally {
    detachParent()
    detachLease()
    source.cancel()
    lease.release()
  }
}
