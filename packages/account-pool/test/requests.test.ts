import { CancellationSource, DEFAULT_ATTEMPT_POLICY } from '@any-music/network-routing'
import type { RoutingClock, RoutingCancellation } from '@any-music/network-routing'
import { describe, expect, it } from 'vitest'

import { AccountCatalog, AccountSelector, requestWithAccountPool } from '../src/index'
import type { AccountProfile, AccountRequestOptions } from '../src/index'

function setup() {
  const timers = new Set<() => void>()
  const clock: RoutingClock = {
    now: () => 0,
    schedule: (_, callback) => {
      timers.add(callback)
      return () => {
        timers.delete(callback)
      }
    },
  }
  const catalog = new AccountCatalog()
  for (const id of ['a', 'b', 'c'])
    catalog.save({
      id,
      name: id,
      platformId: 'source',
      authentication: 'credential',
      credentialKey: `vault_${id}`,
      enabled: true,
      status: 'ready',
    })
  const options: AccountRequestOptions<string> = {
    catalog,
    clock,
    selector: new AccountSelector(() => 0),
    platformId: 'source',
    operation: 'search',
    policy: { ...DEFAULT_ATTEMPT_POLICY, selection: 'random' },
    replaySafe: true,
    execute: async (account) => account.id,
  }
  return { options, catalog, timers }
}

describe('account request leases', () => {
  it('switches after a validated platform failure and preserves that error for the runtime', async () => {
    const { options, catalog, timers } = setup()
    const failure = new Error('expired')
    const calls: string[] = []
    options.execute = async (account) => {
      calls.push(account.id)
      if (account.id === 'a') throw failure
      return account.id
    }
    options.onFailure = (error, account) => {
      expect(error).toBe(failure)
      catalog.save({ ...account, status: 'expired' })
      return 'retry'
    }
    expect((await requestWithAccountPool(options)).candidateId).not.toBe('a')
    expect(calls).toHaveLength(2)
    expect(catalog.get('a')!.status).toBe('expired')
    expect(timers.size).toBe(0)
  })
  it('keeps one identity for the complete callback', async () => {
    const { options, timers } = setup()
    const seen: Readonly<AccountProfile>[] = []
    options.execute = async (account) => {
      seen.push(account)
      await Promise.resolve()
      seen.push(account)
      return account.credentialKey!
    }
    expect((await requestWithAccountPool(options)).value).toBe('vault_a')
    expect(seen[0]).toBe(seen[1])
    expect(timers.size).toBe(0)
  })
  it.each(['serial', 'parallel'] as const)(
    'does not classify or replay a %s account failure after reentrant cancellation',
    async (mode) => {
      const { options, catalog, timers } = setup()
      const parent = new CancellationSource()
      const calls: string[] = []
      const signals: RoutingCancellation[] = []
      let classifications = 0
      const result = requestWithAccountPool({
        ...options,
        policy: { ...options.policy, mode, concurrency: 2 },
        cancellation: parent.signal,
        execute: (account, cancellation) => {
          calls.push(account.id)
          signals.push(cancellation)
          cancellation.subscribe(() => parent.cancel())
          return account.id === 'a' ? Promise.reject(new Error('upstream')) : new Promise(() => {})
        },
        onFailure: () => {
          classifications++
          return 'retry'
        },
      })
      await expect(result).rejects.toMatchObject({ code: 'cancelled' })
      // eslint-disable-next-line no-await-in-loop -- Nested executors release leases over sequential microtasks.
      for (let index = 0; index < 16; index++) await Promise.resolve()
      expect(classifications).toBe(0)
      expect(calls[0]).toBe('a')
      expect(calls).toHaveLength(mode === 'serial' ? 1 : 2)
      expect(signals.every((signal) => signal.isCancelled())).toBe(true)
      expect(catalog.get('a')!.status).toBe('ready')
      expect(timers.size).toBe(0)
    },
  )
  it('deletion cancels uncooperative work and rejects late results', async () => {
    const { options, catalog, timers } = setup()
    let resolveOld!: (value: string) => void
    let oldSignal!: RoutingCancellation
    options.execute = (account, cancellation) => {
      if (account.id !== 'a') return Promise.resolve(account.id)
      oldSignal = cancellation
      return new Promise((resolve) => {
        resolveOld = resolve
      })
    }
    const result = requestWithAccountPool(options)
    catalog.remove('a')
    const completed = await result
    expect(completed.candidateId).not.toBe('a')
    expect(oldSignal.isCancelled()).toBe(true)
    resolveOld('stale')
    expect(completed.value).not.toBe('stale')
    expect(timers.size).toBe(0)
  })
  it('a parallel winner cancels other leases and leaves queued accounts untouched', async () => {
    const { options, timers } = setup()
    const signals: RoutingCancellation[] = []
    const calls: string[] = []
    options.policy = { ...options.policy, mode: 'parallel', concurrency: 2 }
    options.execute = (account, cancellation) => {
      calls.push(account.id)
      signals.push(cancellation)
      return account.id === 'a' ? Promise.resolve('winner') : new Promise(() => {})
    }
    expect((await requestWithAccountPool(options)).value).toBe('winner')
    // eslint-disable-next-line no-await-in-loop -- Flush nested lease cleanup without a real timer.
    for (let index = 0; index < 16; index++) await Promise.resolve()
    expect(calls).toHaveLength(2)
    expect(signals.every((signal) => signal.isCancelled())).toBe(true)
    expect(timers.size).toBe(0)
  })
  it('rename preserves work while credential rotation invalidates it', async () => {
    const { options, catalog, timers } = setup()
    let resolve!: (value: string) => void
    let signal!: RoutingCancellation
    options.execute = (account, cancellation) => {
      signal = cancellation
      if (account.id !== 'a') return Promise.resolve('other')
      return new Promise((done) => {
        resolve = done
      })
    }
    const result = requestWithAccountPool(options)
    catalog.save({ ...catalog.get('a')!, name: 'renamed' })
    expect(signal.isCancelled()).toBe(false)
    catalog.save({ ...catalog.get('a')!, credentialKey: 'rotated' })
    expect((await result).value).toBe('other')
    resolve('stale')
    expect(timers.size).toBe(0)
  })
  it('pre-cancellation and empty selection do not invoke any transport', async () => {
    const { options, timers } = setup()
    const source = new CancellationSource()
    source.cancel()
    options.execute = () => {
      throw new Error('must not call')
    }
    await expect(
      requestWithAccountPool({ ...options, cancellation: source.signal }),
    ).rejects.toMatchObject({ code: 'cancelled' })
    await expect(
      requestWithAccountPool({ ...options, policy: { ...options.policy, accountIds: [] } }),
    ).rejects.toMatchObject({ code: 'no-candidates' })
    expect(timers.size).toBe(0)
  })
  it('never races or replays unsafe writes through another account', async () => {
    const { options, timers } = setup()
    const calls: string[] = []
    options.execute = async (account) => {
      calls.push(account.id)
      throw new Error('write failed')
    }
    options.onFailure = () => 'retry'
    await expect(
      requestWithAccountPool({
        ...options,
        replaySafe: false,
        policy: { ...options.policy, mode: 'parallel', concurrency: 8 },
      }),
    ).rejects.toMatchObject({ code: 'exhausted' })
    expect(calls).toEqual(['a'])
    expect(timers.size).toBe(0)
  })
})
