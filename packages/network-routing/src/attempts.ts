import { CancellationSource } from './cancellation'
import type { RoutingCancellation } from './cancellation'

/** Runtime supplies a monotonic clock and cancellable timers; this package never reads wall time. */
export interface RoutingClock {
  now(): number
  schedule(delayMs: number, callback: () => void): () => void
}

export interface AttemptPolicy {
  mode: 'serial' | 'parallel'
  concurrency: number
  attemptTimeoutMs: number
  totalTimeoutMs: number
}

export const DEFAULT_ATTEMPT_POLICY: Readonly<AttemptPolicy> = Object.freeze({
  mode: 'serial',
  concurrency: 2,
  attemptTimeoutMs: 10_000,
  totalTimeoutMs: 30_000,
})

export type RoutingErrorCode = 'no-candidates' | 'cancelled' | 'timeout' | 'exhausted' | 'stopped'

/** Safe library error; upstream exceptions remain inside the caller's failure callback. */
export class RoutingError extends Error {
  readonly code: RoutingErrorCode
  constructor(code: RoutingErrorCode) {
    super(`Request routing ${code}.`)
    this.name = 'RoutingError'
    this.code = code
  }
}

export interface AttemptContext {
  cancellation: RoutingCancellation
  attempt: number
}

export interface AttemptResult<Value> {
  value: Value
  candidateId: string
  attempts: number
}

export interface RunAttemptsOptions<Candidate extends { id: string }, Value> {
  candidates: readonly Candidate[]
  policy: AttemptPolicy
  clock: RoutingClock
  /** Required: false limits the operation to one attempt, regardless of routing preferences. */
  replaySafe: boolean
  cancellation?: RoutingCancellation
  isAvailable?: (candidate: Candidate) => boolean
  execute(candidate: Candidate, context: AttemptContext): Promise<Value>
  /** Failure includes API parsing/validation, not just HTTP completion. Unknown failures stop. */
  onFailure?: (error: unknown, candidate: Candidate) => 'retry' | 'stop'
}

export function validateAttemptPolicy(input: AttemptPolicy): AttemptPolicy {
  if (input.mode !== 'serial' && input.mode !== 'parallel')
    throw new TypeError('Invalid attempt mode.')
  for (const [value, max] of [
    [input.concurrency, 8],
    [input.attemptTimeoutMs, 600_000],
    [input.totalTimeoutMs, 600_000],
  ]) {
    if (!Number.isSafeInteger(value) || value < 1 || value > max) {
      throw new RangeError('Attempt policy exceeds its bounds.')
    }
  }
  return { ...input }
}

/**
 * First validated success wins. Work is O(n), active transports O(concurrency), timers bounded.
 * An uncooperative transport cannot hold the operation open or publish after cancellation.
 */
export function runFirstSuccessful<Candidate extends { id: string }, Value>(
  options: RunAttemptsOptions<Candidate, Value>,
): Promise<AttemptResult<Value>> {
  const policy = validateAttemptPolicy(options.policy)
  if (options.candidates.length > 256) throw new RangeError('Too many routing candidates.')
  const ids = new Set(options.candidates.map((candidate) => candidate.id))
  if (ids.size !== options.candidates.length || ids.has('')) {
    throw new TypeError('Routing candidates require unique non-empty IDs.')
  }
  // Freeze candidate order before asynchronous work; identity objects remain owned by the caller.
  const candidates = [...options.candidates]
  const limit = options.replaySafe && policy.mode === 'parallel' ? policy.concurrency : 1
  const maxCandidates = options.replaySafe ? candidates.length : Math.min(candidates.length, 1)

  return new Promise((resolve, reject) => {
    let done = false
    let cursor = 0
    let attempts = 0
    let unsubscribe = noop
    let cancelDeadline = noop
    const active = new Map<number, { source: CancellationSource; cancelTimer: () => void }>()

    function finish(result?: AttemptResult<Value>, error?: RoutingError): void {
      if (done) return
      done = true
      cancelDeadline()
      unsubscribe()
      // Mark terminal before aborting: abort callbacks can synchronously settle their own promises.
      for (const record of active.values()) {
        record.cancelTimer()
        record.source.cancel()
      }
      active.clear()
      if (result) resolve(result)
      else reject(error)
    }

    function launch(): void {
      while (!done && active.size < limit && cursor < maxCandidates) {
        const candidate = candidates[cursor++]!
        try {
          if (options.isAvailable && !options.isAvailable(candidate)) continue
        } catch {
          finish(undefined, new RoutingError('stopped'))
          return
        }
        // Injected callbacks can synchronously cancel and finish the operation.
        if (done) return
        const attempt = ++attempts
        const source = new CancellationSource()
        const record = { source, cancelTimer: () => {} }
        active.set(attempt, record)

        function fail(error: unknown): void {
          if (done || !active.delete(attempt)) return
          record.cancelTimer()
          source.cancel()
          if (done) return
          let decision: 'retry' | 'stop' = 'stop'
          try {
            decision = options.onFailure?.(error, candidate) ?? 'stop'
          } catch {
            // A classifier failure cannot accidentally authorize replay.
          }
          if (decision !== 'retry') finish(undefined, new RoutingError('stopped'))
          else launch()
        }

        record.cancelTimer = options.clock.schedule(policy.attemptTimeoutMs, () =>
          fail(new RoutingError('timeout')),
        )
        try {
          // Invoke before yielding, so account selection/leases reserve synchronously across calls.
          const promise = options.execute(candidate, { cancellation: source.signal, attempt })
          void Promise.resolve(promise).then((value) => {
            if (done || !active.has(attempt)) return
            finish({ value, candidateId: candidate.id, attempts })
          }, fail)
        } catch (error) {
          // Keep synchronous failures on the same path without recursive candidate traversal.
          void Promise.resolve().then(() => fail(error))
        }
      }
      if (!done && active.size === 0 && cursor >= maxCandidates) {
        finish(undefined, new RoutingError(attempts === 0 ? 'no-candidates' : 'exhausted'))
      }
    }

    if (options.cancellation?.isCancelled()) {
      finish(undefined, new RoutingError('cancelled'))
      return
    }
    cancelDeadline = options.clock.schedule(policy.totalTimeoutMs, () =>
      finish(undefined, new RoutingError('timeout')),
    )
    unsubscribe =
      options.cancellation?.subscribe(() => finish(undefined, new RoutingError('cancelled'))) ??
      (() => {})
    // A cancellation port may notify synchronously during subscribe.
    if (done) unsubscribe()
    else launch()
  })
}

function noop(): void {}
