import { describe, expect, it } from 'vitest'

import {
  CancellationSource,
  DEFAULT_ATTEMPT_POLICY,
  ProxyPool,
  requestWithProxyPool,
} from '../src/index'
import type { ProxyAssignment, ProxyRequestOptions } from '../src/index'
import { ManualClock, deferred, flush } from './fixtures/clock'

function setup() {
  const clock = new ManualClock()
  const pool = new ProxyPool(clock)
  pool.save({ id: 'p1', name: '代理一', configurationKey: 'config1', enabled: true })
  pool.save({ id: 'p2', name: '代理二', configurationKey: 'config2', enabled: true })
  const assignment: ProxyAssignment = {
    proxyIds: ['p1', 'p2'],
    selection: 'ordered',
    onProxyFailure: 'next-proxy',
  }
  const calls: string[] = []
  const options: ProxyRequestOptions<string> = {
    pool,
    clock,
    assignment,
    policy: DEFAULT_ATTEMPT_POLICY,
    replaySafe: true,
    supportsExplicitProxy: true,
    execute: async (proxy) => {
      calls.push(proxy?.id ?? 'direct')
      if (proxy?.id === 'p1') throw new Error('proxy-connect')
      return 'ok'
    },
    classifyFailure: (error) =>
      error instanceof Error && error.message === 'proxy-connect' ? 'proxy' : 'other',
  }
  return { pool, clock, assignment, calls, options }
}

describe('proxy routing and health', () => {
  it('switches only after a proven proxy failure and returns the next success', async () => {
    const { options, calls, pool, clock } = setup()
    expect(await requestWithProxyPool(options)).toBe('ok')
    expect(calls).toEqual(['p1', 'p2'])
    expect(pool.health('p1')).toMatchObject({ failures: 1, availableAtMs: 1000, inFlight: 0 })
    expect(pool.health('p2')).toMatchObject({ failures: 0, inFlight: 0 })
    expect(clock.pending).toBe(0)
  })

  it('propagates platform failures to the account classifier without poisoning proxy health', async () => {
    const { options, calls, pool, clock } = setup()
    const platformError = new Error('verification-required')
    options.execute = async (proxy) => {
      calls.push(proxy!.id)
      throw platformError
    }
    await expect(requestWithProxyPool(options)).rejects.toBe(platformError)
    expect(calls).toEqual(['p1'])
    expect(pool.health('p1')).toMatchObject({ failures: 0, inFlight: 0 })
    expect(clock.pending).toBe(0)
  })

  it('preserves direct platform failures after an explicitly permitted fallback', async () => {
    const { options, calls } = setup()
    const error = new Error('signed-out')
    options.execute = async (proxy) => {
      calls.push(proxy?.id ?? 'direct')
      throw proxy ? new Error('proxy-connect') : error
    }
    await expect(
      requestWithProxyPool({
        ...options,
        assignment: { ...options.assignment, onProxyFailure: 'direct' },
      }),
    ).rejects.toBe(error)
    expect(calls).toEqual(['p1', 'direct'])
  })

  it('never silently goes direct on an unsupported runtime', async () => {
    const { options, calls, clock } = setup()
    await expect(
      requestWithProxyPool({ ...options, supportsExplicitProxy: false }),
    ).rejects.toMatchObject({ code: 'stopped' })
    expect(calls).toEqual([])
    expect(clock.pending).toBe(0)
  })

  it('uses direct fallback only when explicitly authorized', async () => {
    const { options, calls } = setup()
    expect(
      await requestWithProxyPool({
        ...options,
        assignment: { ...options.assignment, onProxyFailure: 'direct' },
      }),
    ).toBe('ok')
    expect(calls).toEqual(['p1', 'direct'])
    const stop = setup()
    await expect(
      requestWithProxyPool({
        ...stop.options,
        assignment: { ...stop.assignment, onProxyFailure: 'stop-account' },
      }),
    ).rejects.toThrow('proxy-connect')
    expect(stop.calls).toEqual(['p1'])
  })

  it('does not replay a write through another proxy or through direct', async () => {
    for (const onProxyFailure of ['next-proxy', 'direct'] as const) {
      const { options, calls } = setup()
      // eslint-disable-next-line no-await-in-loop -- Verify each independent failover policy through completion.
      await expect(
        requestWithProxyPool({
          ...options,
          replaySafe: false,
          assignment: { ...options.assignment, onProxyFailure },
        }),
      ).rejects.toThrow('proxy-connect')
      expect(calls).toEqual(['p1'])
    }
  })

  it('permits one half-open probe after cooldown, with bounded exponential backoff', () => {
    const { pool, clock } = setup()
    for (let failure = 0; failure < 10; failure++) {
      const lease = pool.acquire('p1')!
      expect(lease).toBeDefined()
      lease.finish('proxy-failure')
      const delay = Math.min(60_000, 1000 * 2 ** failure)
      expect(pool.health('p1')!.availableAtMs - clock.now()).toBe(delay)
      expect(pool.acquire('p1')).toBeUndefined()
      clock.advance(delay)
    }
    const probe = pool.acquire('p1')!
    expect(pool.acquire('p1')).toBeUndefined()
    probe.finish('success')
    expect(pool.acquire('p1')).toBeDefined()
  })

  it('prefers lower measured latency and accounts for current in-flight load', () => {
    const { pool, clock } = setup()
    const first = pool.acquire('p1')!
    clock.advance(10)
    first.finish('success')
    const second = pool.acquire('p2')!
    clock.advance(15)
    second.finish('success')
    expect(pool.select(['p1', 'p2'], 'adaptive')).toBe('p1')
    const busy = pool.acquire('p1')!
    expect(pool.select(['p1', 'p2'], 'adaptive')).toBe('p2')
    busy.finish('neutral')
  })

  it('late outcomes cannot overwrite a newer success or a replaced profile', () => {
    const { pool, clock } = setup()
    const old = pool.acquire('p1')!
    const newer = pool.acquire('p1')!
    clock.advance(5)
    newer.finish('success')
    old.finish('proxy-failure')
    expect(pool.health('p1')!.failures).toBe(0)
    const removed = pool.acquire('p1')!
    pool.remove('p1')
    expect(removed.cancellation.isCancelled()).toBe(true)
    pool.save({ id: 'p1', name: '替换', configurationKey: 'other', enabled: true })
    removed.finish('proxy-failure')
    expect(pool.health('p1')!.failures).toBe(0)
  })

  it('keeps load meaningful for zero-ms samples', () => {
    const { pool } = setup()
    pool.acquire('p1')!.finish('success')
    pool.acquire('p2')!.finish('success')
    const busy = pool.acquire('p1')!
    expect(pool.select(['p1', 'p2'], 'adaptive')).toBe('p2')
    busy.finish('neutral')
  })

  it('cancels an uncooperative transport when its proxy is deleted', async () => {
    const { options, pool, clock, calls } = setup()
    options.execute = (proxy) => {
      calls.push(proxy!.id)
      return new Promise(() => {})
    }
    const pending = requestWithProxyPool(options)
    const rejected = expect(pending).rejects.toMatchObject({ code: 'cancelled' })
    pool.remove('p1')
    await rejected
    expect(calls).toEqual(['p1'])
    expect(clock.pending).toBe(0)
  })

  it('enforces one total deadline across multiple proxy attempts', async () => {
    const { options, clock, pool, calls } = setup()
    const first = deferred<string>()
    options.policy = { ...DEFAULT_ATTEMPT_POLICY, attemptTimeoutMs: 20, totalTimeoutMs: 25 }
    options.execute = (proxy) => {
      calls.push(proxy!.id)
      return proxy!.id === 'p1' ? first.promise : new Promise(() => {})
    }
    const pending = requestWithProxyPool(options)
    const rejected = expect(pending).rejects.toMatchObject({ code: 'timeout' })
    clock.advance(10)
    first.reject(new Error('proxy-connect'))
    await flush()
    expect(calls).toEqual(['p1', 'p2'])
    clock.advance(15)
    await rejected
    await flush()
    expect(pool.health('p2')!.inFlight).toBe(0)
    expect(pool.health('p2')!.failures).toBe(0)
    expect(clock.pending).toBe(0)
  })

  it('parent cancellation stops all work and does not trigger direct fallback', async () => {
    const { options, clock, pool, calls } = setup()
    const source = new CancellationSource()
    options.execute = (proxy) => {
      calls.push(proxy!.id)
      return new Promise(() => {})
    }
    const pending = requestWithProxyPool({
      ...options,
      cancellation: source.signal,
      assignment: { ...options.assignment, onProxyFailure: 'direct' },
    })
    source.cancel()
    await expect(pending).rejects.toMatchObject({ code: 'cancelled' })
    await flush()
    expect(calls).toEqual(['p1'])
    expect(pool.health('p1')!.inFlight).toBe(0)
    expect(clock.pending).toBe(0)
  })

  it('strips credentials from public metadata and rejects duplicate names', () => {
    const { pool } = setup()
    pool.save({
      id: 'p3',
      name: '公开',
      configurationKey: 'config3',
      enabled: true,
      password: 'secret',
    } as Parameters<ProxyPool['save']>[0])
    expect(JSON.stringify(pool.list())).not.toContain('secret')
    expect(() =>
      pool.save({ id: 'p4', name: '公开', configurationKey: 'config4', enabled: true }),
    ).toThrow('Duplicate')
  })
})
