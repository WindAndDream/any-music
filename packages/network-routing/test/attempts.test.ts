import { describe, expect, it } from 'vitest'

import { CancellationSource, DEFAULT_ATTEMPT_POLICY, runFirstSuccessful } from '../src/index'
import type { RoutingCancellation } from '../src/index'
import { ManualClock, deferred, flush } from './fixtures/clock'

const candidates = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]

async function forbiddenTransport(): Promise<never> {
  throw new Error('must not run')
}

describe('bounded first-success executor', () => {
  it('retries serially only after a classified failure and never repeats a candidate', async () => {
    const clock = new ManualClock()
    const calls: string[] = []
    const result = await runFirstSuccessful({
      candidates,
      clock,
      policy: DEFAULT_ATTEMPT_POLICY,
      replaySafe: true,
      execute: async ({ id }) => {
        calls.push(id)
        if (id === 'a') throw new Error('expired')
        return id
      },
      onFailure: () => 'retry',
    })
    expect(calls).toEqual(['a', 'b'])
    expect(result).toEqual({ value: 'b', candidateId: 'b', attempts: 2 })
    expect(clock.pending).toBe(0)
  })

  it('limits parallel transports, cancels losers and ignores their late success', async () => {
    const clock = new ManualClock()
    const first = deferred<string>()
    const second = deferred<string>()
    const signals = new Map<string, RoutingCancellation>()
    const calls: string[] = []
    const result = runFirstSuccessful({
      candidates,
      clock,
      policy: { ...DEFAULT_ATTEMPT_POLICY, mode: 'parallel', concurrency: 2 },
      replaySafe: true,
      execute: ({ id }, { cancellation }) => {
        calls.push(id)
        signals.set(id, cancellation)
        return id === 'a' ? first.promise : second.promise
      },
      onFailure: () => 'retry',
    })
    expect(calls).toEqual(['a', 'b'])
    second.resolve('winner')
    expect(await result).toEqual({ value: 'winner', candidateId: 'b', attempts: 2 })
    expect(signals.get('a')?.isCancelled()).toBe(true)
    first.resolve('late')
    await flush()
    expect(calls).toEqual(['a', 'b'])
    expect(clock.pending).toBe(0)
  })

  it('fills a freed parallel slot after failure while another candidate is pending', async () => {
    const clock = new ManualClock()
    const pending = deferred<string>()
    const calls: string[] = []
    const result = runFirstSuccessful({
      candidates,
      clock,
      policy: { ...DEFAULT_ATTEMPT_POLICY, mode: 'parallel' },
      replaySafe: true,
      execute: async ({ id }) => {
        calls.push(id)
        if (id === 'a') throw new Error()
        if (id === 'b') return pending.promise
        return 'ok'
      },
      onFailure: () => 'retry',
    })
    expect((await result).candidateId).toBe('c')
    expect(calls).toEqual(['a', 'b', 'c'])
    expect(clock.pending).toBe(0)
  })

  it('bounds uncooperative attempts and the total operation deadline', async () => {
    const clock = new ManualClock()
    const calls: string[] = []
    const signals: RoutingCancellation[] = []
    const result = runFirstSuccessful({
      candidates,
      clock,
      policy: { ...DEFAULT_ATTEMPT_POLICY, attemptTimeoutMs: 10, totalTimeoutMs: 15 },
      replaySafe: true,
      execute: ({ id }, { cancellation }) => {
        calls.push(id)
        signals.push(cancellation)
        return new Promise(() => {})
      },
      onFailure: () => 'retry',
    })
    const rejected = expect(result).rejects.toMatchObject({ code: 'timeout' })
    clock.advance(10)
    expect(calls).toEqual(['a', 'b'])
    clock.advance(5)
    await rejected
    expect(signals.every((signal) => signal.isCancelled())).toBe(true)
    expect(calls).toEqual(['a', 'b'])
    expect(clock.pending).toBe(0)
  })

  it('cancellation settles even if a transport never acknowledges abort', async () => {
    const clock = new ManualClock()
    const source = new CancellationSource()
    let calls = 0
    const result = runFirstSuccessful({
      candidates,
      clock,
      policy: DEFAULT_ATTEMPT_POLICY,
      replaySafe: true,
      cancellation: source.signal,
      execute: () => {
        calls++
        return new Promise(() => {})
      },
      onFailure: () => 'retry',
    })
    source.cancel()
    await expect(result).rejects.toMatchObject({ code: 'cancelled' })
    expect(calls).toBe(1)
    expect(clock.pending).toBe(0)
  })

  it.each(['serial', 'parallel'] as const)(
    'does not start work after availability cancels a %s operation',
    async (mode) => {
      const clock = new ManualClock()
      const parent = new CancellationSource()
      const calls: string[] = []
      const result = runFirstSuccessful({
        candidates,
        clock,
        policy: { ...DEFAULT_ATTEMPT_POLICY, mode },
        replaySafe: true,
        cancellation: parent.signal,
        isAvailable: () => {
          parent.cancel()
          return true
        },
        execute: async ({ id }) => {
          calls.push(id)
          return 'unexpected'
        },
      })
      await expect(result).rejects.toMatchObject({ code: 'cancelled' })
      await flush()
      expect(calls).toEqual([])
      expect(clock.pending).toBe(0)
    },
  )

  it.each(['serial', 'parallel'] as const)(
    'stops %s failure classification when an abort listener cancels the parent',
    async (mode) => {
      const clock = new ManualClock()
      const parent = new CancellationSource()
      const first = deferred<string>()
      const other = deferred<string>()
      const calls: string[] = []
      const signals: RoutingCancellation[] = []
      let classifications = 0
      const result = runFirstSuccessful({
        candidates,
        clock,
        policy: { ...DEFAULT_ATTEMPT_POLICY, mode },
        replaySafe: true,
        cancellation: parent.signal,
        execute: ({ id }, { cancellation }) => {
          calls.push(id)
          signals.push(cancellation)
          cancellation.subscribe(() => parent.cancel())
          return id === 'a' ? first.promise : other.promise
        },
        onFailure: () => {
          classifications++
          return 'retry'
        },
      })
      const rejected = expect(result).rejects.toMatchObject({ code: 'cancelled' })
      first.reject(new Error('upstream'))
      await rejected
      expect(classifications).toBe(0)
      expect(calls).toEqual(mode === 'serial' ? ['a'] : ['a', 'b'])
      expect(signals.every((signal) => signal.isCancelled())).toBe(true)
      expect(clock.pending).toBe(0)
      other.resolve('late')
      await flush()
      expect(classifications).toBe(0)
      expect(calls).not.toContain('c')
      expect(clock.pending).toBe(0)
    },
  )

  it('does no work after pre-cancellation or an empty selection', async () => {
    const clock = new ManualClock()
    const source = new CancellationSource()
    source.cancel()
    const execute = forbiddenTransport
    await expect(
      runFirstSuccessful({
        candidates,
        clock,
        policy: DEFAULT_ATTEMPT_POLICY,
        replaySafe: true,
        cancellation: source.signal,
        execute,
      }),
    ).rejects.toMatchObject({ code: 'cancelled' })
    await expect(
      runFirstSuccessful({
        candidates: [],
        clock,
        policy: DEFAULT_ATTEMPT_POLICY,
        replaySafe: true,
        execute,
      }),
    ).rejects.toMatchObject({ code: 'no-candidates' })
    expect(clock.pending).toBe(0)
  })

  it('never races or replays an unsafe write even when retry is requested', async () => {
    const clock = new ManualClock()
    const calls: string[] = []
    const result = runFirstSuccessful({
      candidates,
      clock,
      policy: { ...DEFAULT_ATTEMPT_POLICY, mode: 'parallel', concurrency: 8 },
      replaySafe: false,
      execute: async ({ id }) => {
        calls.push(id)
        throw new Error()
      },
      onFailure: () => 'retry',
    })
    await expect(result).rejects.toMatchObject({ code: 'exhausted' })
    expect(calls).toEqual(['a'])
    expect(clock.pending).toBe(0)
  })

  it('unknown failures and broken classifiers stop without retaining sensitive messages', async () => {
    const clock = new ManualClock()
    for (const onFailure of [
      undefined,
      () => {
        throw new Error('secret')
      },
    ]) {
      const result = runFirstSuccessful({
        candidates,
        clock,
        policy: DEFAULT_ATTEMPT_POLICY,
        replaySafe: true,
        execute: async () => {
          throw new Error('cookie=secret')
        },
        onFailure,
      })
      // eslint-disable-next-line no-await-in-loop -- Each failure policy must fully release its own timers.
      await expect(result).rejects.toMatchObject({
        code: 'stopped',
        message: 'Request routing stopped.',
      })
    }
    expect(clock.pending).toBe(0)
  })

  it('rejects invalid bounds and duplicate identities before any timer is scheduled', () => {
    const clock = new ManualClock()
    const options = {
      candidates,
      clock,
      policy: DEFAULT_ATTEMPT_POLICY,
      replaySafe: true,
      execute: async () => 'ok',
    }
    expect(() =>
      runFirstSuccessful({ ...options, policy: { ...DEFAULT_ATTEMPT_POLICY, concurrency: 9 } }),
    ).toThrow(RangeError)
    expect(() =>
      runFirstSuccessful({ ...options, candidates: [{ id: 'a' }, { id: 'a' }] }),
    ).toThrow(TypeError)
    expect(() =>
      runFirstSuccessful({
        ...options,
        policy: { ...DEFAULT_ATTEMPT_POLICY, totalTimeoutMs: NaN },
      }),
    ).toThrow(RangeError)
    expect(clock.pending).toBe(0)
  })

  it('aborts all transports even when one abort subscriber throws', () => {
    const source = new CancellationSource()
    let notified = 0
    source.signal.subscribe(() => {
      throw new Error()
    })
    source.signal.subscribe(() => {
      notified++
    })
    source.cancel()
    source.cancel()
    expect(notified).toBe(1)
    source.signal.subscribe(() => {
      notified++
    })
    expect(notified).toBe(2)
  })
})
