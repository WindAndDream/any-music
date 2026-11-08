import { RoutingError, runFirstSuccessful } from './attempts'
import type { AttemptPolicy, RoutingClock } from './attempts'
import { CancellationSource } from './cancellation'
import type { RoutingCancellation } from './cancellation'

/** Public metadata only. Endpoint authentication lives behind configurationKey in the runtime. */
export interface ProxyProfile {
  id: string
  name: string
  configurationKey: string
  enabled: boolean
}

export interface ProxyAssignment {
  proxyIds: readonly string[]
  selection: 'ordered' | 'adaptive'
  /** Direct fallback is an explicit per-account permission, never an implicit default. */
  onProxyFailure: 'next-proxy' | 'stop-account' | 'direct'
}

export interface ProxyHealthSnapshot {
  id: string
  failures: number
  availableAtMs: number
  inFlight: number
  latencyMs?: number
}

interface ProxyState {
  profile: Readonly<ProxyProfile>
  failures: number
  availableAtMs: number
  latencyMs?: number
  generation: number
  nextSequence: number
  latestOutcome: number
  leases: Set<CancellationSource>
}

export interface ProxyLease {
  profile: Readonly<ProxyProfile>
  cancellation: RoutingCancellation
  /** Idempotent; results from a deleted/reconfigured proxy cannot alter current health. */
  finish(outcome: 'success' | 'proxy-failure' | 'neutral'): void
}

/** Bounded passive circuit breaker. A recovered circuit permits one probe until it settles. */
export class ProxyPool {
  private readonly states = new Map<string, ProxyState>()
  private generation = 0
  private readonly clock: RoutingClock

  constructor(clock: RoutingClock) {
    this.clock = clock
  }

  save(input: ProxyProfile): Readonly<ProxyProfile> {
    const profile = Object.freeze(validateProxyProfile(input))
    const previous = this.states.get(profile.id)
    if (!previous && this.states.size >= 128) throw new RangeError('Too many proxy profiles.')
    if (
      [...this.states.values()].some(
        (state) => state.profile.id !== profile.id && state.profile.name === profile.name,
      )
    ) {
      throw new TypeError('Duplicate proxy name.')
    }
    if (
      previous &&
      previous.profile.configurationKey === profile.configurationKey &&
      previous.profile.enabled === profile.enabled
    ) {
      previous.profile = profile
      return profile
    }
    // Publish the new generation before aborting old work; callbacks may immediately request a lease.
    this.states.set(profile.id, {
      profile,
      failures: 0,
      availableAtMs: 0,
      generation: ++this.generation,
      nextSequence: 0,
      latestOutcome: 0,
      leases: new Set(),
    })
    if (previous) for (const source of previous.leases) source.cancel()
    return profile
  }

  remove(id: string): void {
    const state = this.states.get(id)
    this.states.delete(id)
    if (state) for (const source of state.leases) source.cancel()
  }

  list(): readonly Readonly<ProxyProfile>[] {
    return [...this.states.values()].map((state) => state.profile)
  }

  health(id: string): ProxyHealthSnapshot | undefined {
    const state = this.states.get(id)
    if (!state) return undefined
    return {
      id,
      failures: state.failures,
      availableAtMs: state.availableAtMs,
      inFlight: state.leases.size,
      ...(state.latencyMs === undefined ? {} : { latencyMs: state.latencyMs }),
    }
  }

  /** Linear minimum selection avoids sorting and preserves configured order on score ties. */
  select(ids: readonly string[], selection: ProxyAssignment['selection']): string | undefined {
    let selected: string | undefined
    let bestScore = Infinity
    for (const id of ids) {
      const state = this.states.get(id)
      if (!state || !this.isAvailable(state)) continue
      // Clock resolution may produce a zero-ms sample; load still needs to influence the score.
      const score = Math.max(1, state.latencyMs ?? 1000) * (1 + state.leases.size)
      if (selection === 'ordered') return id
      if (score < bestScore) {
        selected = id
        bestScore = score
      }
    }
    return selected
  }

  acquire(id: string): ProxyLease | undefined {
    const state = this.states.get(id)
    if (!state || !this.isAvailable(state)) return undefined
    const source = new CancellationSource()
    const start = this.clock.now()
    const sequence = ++state.nextSequence
    state.leases.add(source)
    let finished = false
    return {
      profile: state.profile,
      cancellation: source.signal,
      finish: (outcome) => {
        if (finished) return
        finished = true
        state.leases.delete(source)
        if (this.states.get(id)?.generation !== state.generation || source.signal.isCancelled())
          return
        if (outcome === 'neutral' || sequence < state.latestOutcome) return
        state.latestOutcome = sequence
        if (outcome === 'success') {
          const latency = Math.max(0, this.clock.now() - start)
          state.latencyMs =
            state.latencyMs === undefined ? latency : state.latencyMs * 0.75 + latency * 0.25
          state.failures = 0
          state.availableAtMs = 0
        } else if (outcome === 'proxy-failure') {
          state.failures = Math.min(state.failures + 1, 16)
          // Only an explicitly diagnosed proxy failure opens the circuit; backoff is bounded at 60s.
          state.availableAtMs =
            this.clock.now() + Math.min(60_000, 1000 * 2 ** (state.failures - 1))
        }
      },
    }
  }

  private isAvailable(state: ProxyState): boolean {
    return (
      state.profile.enabled &&
      this.clock.now() >= state.availableAtMs &&
      (state.failures === 0 || state.leases.size === 0)
    )
  }
}

/** Unknown errors stop; only the transport can prove whether the failure came from a proxy. */
export type ProxyFailureKind = 'proxy' | 'other'

export interface ProxyRequestOptions<Value> {
  pool: ProxyPool
  assignment: ProxyAssignment
  policy: AttemptPolicy
  clock: RoutingClock
  replaySafe: boolean
  /** Must be true for a runtime that can enforce account-specific routing. */
  supportsExplicitProxy: boolean
  cancellation?: RoutingCancellation
  execute(
    proxy: Readonly<ProxyProfile> | undefined,
    cancellation: RoutingCancellation,
  ): Promise<Value>
  classifyFailure(error: unknown): ProxyFailureKind
}

/** Request an account's proxy group serially; the enclosing account executor owns concurrency. */
export async function requestWithProxyPool<Value>(
  options: ProxyRequestOptions<Value>,
): Promise<Value> {
  const assignment = validateProxyAssignment(options.assignment)
  if (assignment.proxyIds.length && !options.supportsExplicitProxy) {
    // Fail before transport invocation: a browser ignoring a proxy option is not a direct permission.
    throw new RoutingError('stopped')
  }
  const remaining = new Set(assignment.proxyIds)
  let lastFailure: unknown
  // One outer deadline covers proxy changes, so nested attempts cannot multiply total time budgets.
  const result = await runFirstSuccessful({
    candidates: [{ id: 'proxy-group' }],
    clock: options.clock,
    policy: { ...options.policy, mode: 'serial', attemptTimeoutMs: options.policy.totalTimeoutMs },
    replaySafe: false,
    cancellation: options.cancellation,
    execute: async (_, context) => {
      while (remaining.size) {
        if (context.cancellation.isCancelled()) throw new RoutingError('cancelled')
        const id = options.pool.select([...remaining], assignment.selection)
        if (!id) break
        remaining.delete(id)
        const lease = options.pool.acquire(id)
        if (!lease) continue
        let outcome: 'success' | 'proxy-failure' | 'neutral' = 'neutral'
        try {
          // eslint-disable-next-line no-await-in-loop -- Proxy failover is deliberately serial.
          const attempt = await executeProxyAttempt(options, context.cancellation, lease)
          outcome = 'success'
          return attempt
        } catch (error) {
          lastFailure = error
          // Neither cancellation nor an attempt timeout diagnoses a failed proxy.
          if (
            context.cancellation.isCancelled() ||
            lease.cancellation.isCancelled() ||
            options.classifyFailure(error) !== 'proxy'
          ) {
            throw error
          }
          outcome = 'proxy-failure'
          if (!options.replaySafe || assignment.onProxyFailure === 'stop-account') throw error
          if (assignment.onProxyFailure === 'direct') break
        } finally {
          lease.finish(outcome)
        }
      }
      if (assignment.proxyIds.length && assignment.onProxyFailure !== 'direct') {
        throw lastFailure ?? new RoutingError('no-candidates')
      }
      // A non-replay-safe call that failed above never reaches this fallback.
      let directFailure: unknown
      const direct = await runFirstSuccessful({
        candidates: [{ id: 'direct' }],
        clock: options.clock,
        policy: { ...options.policy, mode: 'serial' },
        replaySafe: false,
        cancellation: context.cancellation,
        execute: (_direct, attempt) => options.execute(undefined, attempt.cancellation),
        onFailure: (error) => {
          directFailure = error
          return 'stop'
        },
      }).catch((error: unknown) => {
        if (
          error instanceof RoutingError &&
          error.code === 'stopped' &&
          directFailure !== undefined
        )
          throw directFailure
        throw error
      })
      return direct.value
    },
    // Keep the local upstream failure for the caller's account classifier without serializing it.
    onFailure: (error) => {
      lastFailure = error
      return 'stop'
    },
  }).catch((error: unknown) => {
    if (error instanceof RoutingError && error.code === 'stopped' && lastFailure !== undefined)
      throw lastFailure
    throw error
  })
  return result.value
}

async function executeProxyAttempt<Value>(
  options: ProxyRequestOptions<Value>,
  parent: RoutingCancellation,
  lease: ProxyLease,
): Promise<Value> {
  const source = new CancellationSource()
  const detachParent = parent.subscribe(() => source.cancel())
  const detachLease = lease.cancellation.subscribe(() => source.cancel())
  let failure: unknown
  try {
    const result = await runFirstSuccessful({
      candidates: [{ id: lease.profile.id }],
      clock: options.clock,
      policy: { ...options.policy, mode: 'serial' },
      replaySafe: false,
      cancellation: source.signal,
      execute: (_, attempt) => options.execute(lease.profile, attempt.cancellation),
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
  }
}

export function validateProxyProfile(input: ProxyProfile): ProxyProfile {
  const name = input.name.normalize('NFC').trim()
  if (!name || name.length > 64 || /\p{Cc}/u.test(name)) throw new TypeError('Invalid proxy name.')
  for (const id of [input.id, input.configurationKey]) {
    if (!/^[a-zA-Z0-9_-]{1,128}$/.test(id)) throw new TypeError('Invalid proxy identifier.')
  }
  if (typeof input.enabled !== 'boolean') throw new TypeError('Invalid proxy activation.')
  return { id: input.id, name, configurationKey: input.configurationKey, enabled: input.enabled }
}

export function validateProxyAssignment(input: ProxyAssignment): ProxyAssignment {
  if (
    input.proxyIds.length > 128 ||
    new Set(input.proxyIds).size !== input.proxyIds.length ||
    input.proxyIds.some((id) => !/^[a-zA-Z0-9_-]{1,128}$/.test(id))
  ) {
    throw new TypeError('Invalid proxy group.')
  }
  if (input.selection !== 'ordered' && input.selection !== 'adaptive')
    throw new TypeError('Invalid proxy selection.')
  if (!['next-proxy', 'stop-account', 'direct'].includes(input.onProxyFailure))
    throw new TypeError('Invalid proxy fallback.')
  return {
    proxyIds: Object.freeze([...input.proxyIds]),
    selection: input.selection,
    onProxyFailure: input.onProxyFailure,
  }
}
