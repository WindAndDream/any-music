import { AccountCatalog } from '@any-music/account-pool'
import { AppError } from '@any-music/core'
import { CancellationSource, DEFAULT_ATTEMPT_POLICY, ProxyPool } from '@any-music/network-routing'
import type { RoutingClock } from '@any-music/network-routing'
import { describe, expect, it, vi } from 'vitest'

import { AccountRequestRouter } from '@/features/accounts/account-request-router'

function setup(clockOverride?: RoutingClock) {
  const timers = new Set<() => void>()
  const clock: RoutingClock = clockOverride ?? {
    now: () => 0,
    schedule: (_, callback) => {
      timers.add(callback)
      return () => {
        timers.delete(callback)
      }
    },
  }
  const catalog = new AccountCatalog()
  for (const id of ['a', 'b'])
    catalog.save({
      id,
      platformId: 'bilibili',
      name: id,
      authentication: 'credential',
      credentialKey: `vault_${id}`,
      enabled: true,
      status: 'ready',
    })
  catalog.savePolicy('bilibili', 'search', { ...DEFAULT_ATTEMPT_POLICY, selection: 'random' })
  const proxies = new ProxyPool(clock)
  for (const id of ['p1', 'p2'])
    proxies.save({ id, name: id, configurationKey: `config_${id}`, enabled: true })
  const capabilities = { isolatedAccounts: true, explicitProxy: true }
  const router = new AccountRequestRouter({
    clock,
    catalog,
    proxies,
    capabilities,
    random: () => 0,
    isProxyFailure: (error) => error instanceof Error && error.message === 'proxy-connect',
  })
  return { router, catalog, proxies, capabilities, timers }
}

describe('formal account/proxy composition', () => {
  it('fails over an attempt timeout within the unchanged total budget', async () => {
    vi.useFakeTimers()
    try {
      const { router, catalog } = setup({
        now: () => Date.now(),
        schedule: (delay, callback) => {
          const timer = setTimeout(callback, delay)
          return () => clearTimeout(timer)
        },
      })
      catalog.savePolicy('bilibili', 'search', {
        ...DEFAULT_ATTEMPT_POLICY,
        selection: 'random',
        attemptTimeoutMs: 10,
        totalTimeoutMs: 30,
      })
      const calls: string[] = []
      const pending = router.request({
        platformId: 'bilibili',
        operation: 'search',
        replaySafe: true,
        execute: ({ account }) => {
          calls.push(account.id)
          return account.id === 'a' ? new Promise(() => {}) : Promise.resolve('ok')
        },
      })
      await vi.advanceTimersByTimeAsync(10)
      expect(await pending).toBe('ok')
      expect(calls).toEqual(['a', 'b'])
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })
  it('composes account and proxy failover while keeping identity scoped per callback', async () => {
    const { router, catalog, timers } = setup()
    router.assignProxies('a', {
      proxyIds: ['p1', 'p2'],
      selection: 'ordered',
      onProxyFailure: 'next-proxy',
    })
    const calls: string[] = []
    const result = await router.request({
      platformId: 'bilibili',
      operation: 'search',
      replaySafe: true,
      execute: async ({ account, proxy }) => {
        calls.push(`${account.id}/${proxy?.id ?? 'direct'}`)
        if (proxy?.id === 'p1') throw new Error('proxy-connect')
        if (account.id === 'a') throw new AppError('not-authenticated')
        return 'ok'
      },
    })
    expect(result).toBe('ok')
    expect(calls).toEqual(['a/p1', 'a/p2', 'b/direct'])
    expect(catalog.get('a')!.status).toBe('expired')
    expect(timers.size).toBe(0)
  })
  it('marks a challenged account without changing other accounts', async () => {
    const { router, catalog } = setup()
    expect(
      await router.request({
        platformId: 'bilibili',
        operation: 'search',
        replaySafe: true,
        execute: async ({ account }) => {
          if (account.id === 'a') throw new AppError('verification-required')
          return 'ok'
        },
      }),
    ).toBe('ok')
    expect(catalog.get('a')!.status).toBe('verification-required')
    expect(catalog.get('b')!.status).toBe('ready')
  })
  it('stops future requests through a network-blocked account until explicit recovery', async () => {
    const { router, catalog } = setup()
    router.assignProxies('a', {
      proxyIds: ['p1', 'p2'],
      selection: 'ordered',
      onProxyFailure: 'stop-account',
    })
    const calls: string[] = []
    const request = {
      platformId: 'bilibili',
      operation: 'search',
      replaySafe: true,
      execute: async ({ account }: { account: { id: string } }) => {
        calls.push(account.id)
        if (account.id === 'a') throw new AppError('network-error', 'proxy-connect')
        return 'ok'
      },
    }
    await router.request(request)
    expect(catalog.get('a')!.status).toBe('network-blocked')
    await router.request(request)
    expect(calls).toEqual(['a', 'b', 'b'])
  })
  it('checks isolation/proxy capabilities before any transport call', async () => {
    const { router, capabilities } = setup()
    let calls = 0
    const request = {
      platformId: 'bilibili',
      operation: 'search',
      replaySafe: true,
      execute: async () => {
        calls++
        return 'ok'
      },
    }
    capabilities.isolatedAccounts = false
    await expect(router.request(request)).rejects.toMatchObject({ code: 'unsupported-operation' })
    capabilities.isolatedAccounts = true
    capabilities.explicitProxy = false
    router.assignProxies('a', { proxyIds: ['p1'], selection: 'ordered', onProxyFailure: 'direct' })
    await expect(router.request(request)).rejects.toMatchObject({ code: 'unsupported-operation' })
    expect(calls).toBe(0)
  })
  it('keeps terminal errors structured and explicit user cancellation distinguishable', async () => {
    const { router, catalog } = setup()
    const source = new CancellationSource()
    source.cancel()
    await expect(
      router.request({
        platformId: 'bilibili',
        operation: 'search',
        replaySafe: true,
        cancellation: source.signal,
        execute: async () => 'ok',
      }),
    ).rejects.toMatchObject({ code: 'operation-cancelled' })
    router.removeAccount('a')
    router.removeAccount('b')
    expect(catalog.list()).toEqual([])
    await expect(
      router.request({
        platformId: 'bilibili',
        operation: 'search',
        replaySafe: true,
        execute: async () => 'ok',
      }),
    ).rejects.toMatchObject({ code: 'not-authenticated' })
  })
})
