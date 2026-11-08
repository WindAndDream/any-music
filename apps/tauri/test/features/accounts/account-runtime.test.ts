import { AppError } from '@any-music/core'
import type { MusicSourcePlugin, Track } from '@any-music/core'
import { CancellationSource } from '@any-music/network-routing'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AccountRuntime } from '@/features/accounts/account-runtime'
import type { NativeAccount } from '@/features/accounts/account-runtime'

const native = vi.hoisted(() => ({ invoke: vi.fn() }))
beforeEach(() => {
  const values = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  })
})
afterEach(() => vi.unstubAllGlobals())
vi.mock('@tauri-apps/api/core', () => ({ invoke: native.invoke }))
const account = (id: string, authentication: 'anonymous' | 'credential'): NativeAccount => ({
  backupProxyIds: [],
  state: {
    login: (authentication === 'credential' ? 'signed-in' : 'signed-out') as
      | 'signed-in'
      | 'signed-out',
    verification: 'not-required' as const,
    connection: 'available' as const,
  },

  id,
  authentication,
  platformId: 'bilibili',
  name: id,
  status: 'ready',
  enabled: true,
  proxyId: null,
  userAgent: 'agent',
  webId: '1',
})

describe('native account composition', () => {
  it.each(['bilibili', 'douyin', 'netease'])(
    'requires login before routing built-in %s content',
    async (platformId) => {
      const runtime = new AccountRuntime()
      native.invoke.mockResolvedValueOnce({
        accounts: [{ ...account('unverified', 'anonymous'), platformId }],
        proxies: [],
      })
      await runtime.refresh()
      expect(runtime.catalog.eligible(platformId, runtime.getPolicy(platformId, 'search'))).toEqual(
        [],
      )
      expect(native.invoke).not.toHaveBeenCalledWith('http_request', expect.anything())
    },
  )
  it('shows the latest name after rename/re-addition without reviving the old routing account', async () => {
    const runtime = new AccountRuntime()
    const oldId = '11111111-1111-4111-8111-111111111111'
    const nextId = '22222222-2222-4222-8222-222222222222'
    runtime.snapshot.value = { accounts: [account(oldId, 'credential')], proxies: [] }
    const track: Track = {
      id: 'bilibili:1',
      title: '歌曲',
      artists: [{ name: '作者' }],
      source: { pluginId: 'bilibili', mediaKind: 'video', resourceId: '1' },
    }
    runtime.rememberTrackAccount(track, oldId)
    const saved = JSON.parse(JSON.stringify(track)) as Track
    native.invoke.mockResolvedValue({
      accounts: [{ ...account(nextId, 'credential'), name: '最新名称' }],
      proxies: [],
      accountLabels: { [oldId]: { name: '最新名称', activeAccountId: nextId } },
    })
    await runtime.refresh()
    expect(runtime.getTrackAccountName(saved)).toBe('最新名称')
    expect(saved.acquisition?.accountName).toBe(oldId)
    expect(runtime.getTrackAccountId(saved)).toBeUndefined()
    expect(runtime.getTrackAccountId(track)).toBe(oldId)
    runtime.snapshot.value = { accounts: [], proxies: [] }
    expect(runtime.getTrackAccountName(saved)).toBe(oldId)
  })
  it.each(['verification-required', 'expired', 'network-blocked'])(
    'checks a paused identity directly without replay or switching accounts: %s',
    async (status) => {
      const runtime = new AccountRuntime()
      const paused = { ...account('a', 'credential'), status }
      native.invoke.mockImplementation(async (command: string) =>
        command === 'account_snapshot'
          ? { accounts: [paused, account('b', 'credential')], proxies: [] }
          : undefined,
      )
      runtime.selectedAccountIds.value = { bilibili: 'a' }
      vi.spyOn(runtime, 'createPlugin').mockResolvedValue({} as MusicSourcePlugin)
      const execute = vi.fn(async (selected: NativeAccount) => selected.id)
      expect(await runtime.run('bilibili', 'session', execute)).toBe('a')
      expect(execute).toHaveBeenCalledOnce()
    },
  )
  it.each([
    ['verification-required', 'verification-required'],
    ['network-blocked', 'network-error'],
    ['expired', 'not-authenticated'],
    ['signed-out', 'not-authenticated'],
  ])('preserves the reason a selected Douyin account is paused (%s)', async (status, code) => {
    const runtime = new AccountRuntime()
    const profile: NativeAccount = {
      ...account('a', 'credential'),
      platformId: 'douyin',
      status,
      state: {
        login: ['expired', 'signed-out'].includes(status) ? 'signed-out' : 'signed-in',
        verification: status === 'verification-required' ? 'required' : 'not-required',
        connection: status === 'network-blocked' ? 'unavailable' : 'available',
      },
    }
    native.invoke.mockResolvedValue({ accounts: [profile], proxies: [] })
    const execute = vi.fn()
    await expect(runtime.run('douyin', 'search', execute)).rejects.toMatchObject({ code })
    expect(execute).not.toHaveBeenCalled()
  })
  it('does not retry another account when native deletion interrupts an operation', async () => {
    const runtime = new AccountRuntime()
    native.invoke.mockImplementation(async (command: string) =>
      command === 'account_snapshot'
        ? { accounts: [account('a', 'credential'), account('b', 'credential')], proxies: [] }
        : undefined,
    )
    await runtime.refresh()
    runtime.setPolicy('bilibili', 'search', {
      ...runtime.getPolicy('bilibili', 'search'),
      mode: 'serial',
      concurrency: 1,
    })
    vi.spyOn(runtime, 'createPlugin').mockResolvedValue({} as MusicSourcePlugin)
    const execute = vi.fn(async () => {
      throw new AppError('operation-cancelled', '账号已删除')
    })
    await expect(runtime.run('bilibili', 'search', execute)).rejects.toMatchObject({
      code: 'operation-cancelled',
    })
    expect(execute).toHaveBeenCalledOnce()
  })
  it('falls back to available accounts when the last policy participant is removed', async () => {
    const runtime = new AccountRuntime()
    native.invoke.mockImplementation(async (command: string) =>
      command === 'account_snapshot'
        ? { accounts: [account('a', 'credential'), account('b', 'credential')], proxies: [] }
        : undefined,
    )
    await runtime.refresh()
    runtime.setPolicy('bilibili', 'search', {
      ...runtime.getPolicy('bilibili', 'search'),
      accountIds: ['a'],
    })
    expect(runtime.getPolicy('bilibili', 'search').accountIds).toEqual(['a'])
    native.invoke.mockImplementation(async (command: string) =>
      command === 'account_snapshot'
        ? { accounts: [account('b', 'credential')], proxies: [] }
        : undefined,
    )
    await runtime.refresh()
    vi.spyOn(runtime, 'createPlugin').mockResolvedValue({} as MusicSourcePlugin)
    const execute = vi.fn(async (profile: NativeAccount) => profile.id)
    await expect(runtime.run('bilibili', 'search', execute, undefined, 'a')).resolves.toBe('b')
    expect(execute).toHaveBeenCalledOnce()
  })
  it('keeps known usernames scoped to saved accounts and clears removed identities', async () => {
    const runtime = new AccountRuntime()
    runtime.sessionUserNames.value = new Map([
      ['a', '平台用户甲'],
      ['b', '平台用户乙'],
    ])
    native.invoke.mockResolvedValue({ accounts: [account('a', 'credential')], proxies: [] })
    await runtime.refresh()
    expect([...runtime.sessionUserNames.value]).toEqual([['a', '平台用户甲']])
  })
  it('persists one selected identity across operations and restores automatic policies', async () => {
    const runtime = new AccountRuntime()
    native.invoke.mockImplementation(async (command: string) =>
      command === 'account_snapshot'
        ? { accounts: [account('a', 'credential'), account('b', 'credential')], proxies: [] }
        : undefined,
    )
    await runtime.refresh()
    const lease = runtime.catalog.acquire('a')!
    await runtime.selectAccount('bilibili', 'b')
    expect(native.invoke).not.toHaveBeenCalledWith('cancel_platform_requests', expect.anything())
    expect(lease.cancellation.isCancelled()).toBe(false)
    for (const operation of ['search', 'import', 'session', 'playback'] as const)
      expect(runtime.getPolicy('bilibili', operation).accountIds).toEqual(['b'])
    expect(runtime.getPolicy('bilibili', 'search', false).accountIds).toBeUndefined()
    const restored = new AccountRuntime()
    await restored.initialize()
    expect(restored.selectedAccountIds.value.bilibili).toBe('b')
    await restored.selectAccount('bilibili', null)
    expect(restored.getPolicy('bilibili', 'search').accountIds).toBeUndefined()
    lease.release()
  })
  it('restores each platform selection with its latest native account state after reopening', async () => {
    const bilibili = account('bilibili-last', 'credential')
    const douyin = {
      ...account('douyin-last', 'credential'),
      platformId: 'douyin',
      state: { ...bilibili.state, verification: 'required' as const },
    }
    native.invoke.mockImplementation(async (command: string) =>
      command === 'account_snapshot' ? { accounts: [bilibili, douyin], proxies: [] } : undefined,
    )
    const first = new AccountRuntime()
    await first.initialize()
    await first.selectAccount('bilibili', bilibili.id)
    await first.selectAccount('douyin', douyin.id)
    const restored = new AccountRuntime()
    await restored.initialize()
    expect(restored.selectedAccountIds.value).toEqual({ bilibili: bilibili.id, douyin: douyin.id })
    for (const platform of ['bilibili', 'douyin']) {
      const id = restored.selectedAccountIds.value[platform]
      expect(restored.getPolicy(platform, 'session').accountIds).toEqual([id])
    }
    expect(restored.snapshot.value.accounts.find((item) => item.id === douyin.id)?.state).toEqual(
      douyin.state,
    )
  })
  it('cancels removed account operations and rejects disabled or mismatched selections', async () => {
    const runtime = new AccountRuntime()
    native.invoke.mockImplementation(async (command: string) =>
      command === 'account_snapshot'
        ? {
            accounts: [
              account('a', 'credential'),
              account('b', 'credential'),
              { ...account('disabled', 'credential'), enabled: false },
            ],
            proxies: [],
          }
        : undefined,
    )
    await runtime.refresh()
    await runtime.selectAccount('bilibili', 'a')
    vi.spyOn(runtime, 'createPlugin').mockResolvedValue({} as MusicSourcePlugin)
    let started!: () => void
    const ready = new Promise<void>((resolve) => {
      started = resolve
    })
    const execute = vi.fn(
      async (_account, _plugin, cancellation) =>
        new Promise<never>((_resolve, reject) => {
          started()
          cancellation.subscribe(() => reject(new AppError('operation-cancelled')))
        }),
    )
    const pending = runtime.run('bilibili', 'search', execute)
    const assertion = expect(pending).rejects.toMatchObject({ code: 'operation-cancelled' })
    await ready
    await runtime.selectAccount('bilibili', 'b')
    expect(execute).toHaveBeenCalledOnce()
    native.invoke.mockResolvedValue({ accounts: [account('b', 'credential')], proxies: [] })
    await runtime.refresh()
    await assertion
    expect(execute).toHaveBeenCalledOnce()
    await expect(runtime.selectAccount('douyin', 'b')).rejects.toMatchObject({
      code: 'invalid-input',
    })
    await expect(runtime.selectAccount('bilibili', 'disabled')).rejects.toMatchObject({
      code: 'invalid-input',
    })
    native.invoke.mockResolvedValue({ accounts: [account('a', 'credential')], proxies: [] })
    await runtime.refresh()
    expect(runtime.selectedAccountIds.value.bilibili).toBeUndefined()
  })
  it('revokes only removed account media, publishes once and releases buffered uses', async () => {
    native.invoke.mockClear()
    const runtime = new AccountRuntime()
    native.invoke.mockImplementation(async (command) =>
      command === 'account_snapshot'
        ? { accounts: [account('a', 'credential'), account('b', 'credential')], proxies: [] }
        : undefined,
    )
    await runtime.refresh()
    const onInvalidation = vi.fn()
    const unsubscribe = runtime.subscribeSourceInvalidation(onInvalidation)
    const first = await runtime.lease('a', '播放', 'song-a')
    const second = await runtime.lease('b', '播放', 'song-b')
    native.invoke.mockImplementation(async (command) =>
      command === 'account_snapshot'
        ? { accounts: [account('b', 'credential')], proxies: [] }
        : undefined,
    )
    await runtime.refresh()
    await runtime.refresh()
    expect(onInvalidation).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ accountId: 'a', trackIds: ['song-a'] }),
    )
    expect(
      native.invoke.mock.calls.filter(([command]) => command === 'release_account_usage'),
    ).toHaveLength(1)
    first()
    second()
    expect(
      native.invoke.mock.calls.filter(([command]) => command === 'release_account_usage'),
    ).toHaveLength(2)
    unsubscribe()
  })
  it('rejects an account lease that completes after its identity was removed', async () => {
    const runtime = new AccountRuntime()
    native.invoke.mockResolvedValue({ accounts: [account('a', 'credential')], proxies: [] })
    await runtime.refresh()
    let finish!: () => void
    native.invoke.mockImplementation(async (command) =>
      command === 'acquire_account_usage'
        ? new Promise<void>((resolve) => {
            finish = resolve
          })
        : command === 'account_snapshot'
          ? { accounts: [], proxies: [] }
          : undefined,
    )
    const pending = runtime.lease('a', '播放', 'song')
    const assertion = expect(pending).rejects.toMatchObject({ code: 'operation-cancelled' })
    await runtime.refresh()
    finish()
    await assertion
    expect(native.invoke).toHaveBeenCalledWith('release_account_usage', expect.anything())
  })
  it('reports a missing platform account before issuing a source request', async () => {
    const runtime = new AccountRuntime()
    native.invoke.mockResolvedValue({ accounts: [], proxies: [] })
    const execute = vi.fn()
    await expect(runtime.run('bilibili', 'search', execute)).rejects.toMatchObject({
      code: 'account-unavailable',
      message: expect.stringContaining('账号设置'),
    })
    expect(execute).not.toHaveBeenCalled()
  })
  it('sends the exact search text/cursor to Rust CDP and never uses HTTP on a page rejection', async () => {
    const runtime = new AccountRuntime()
    const douyin = { ...account('douyin-account', 'credential'), platformId: 'douyin' as const }
    native.invoke.mockReset()
    native.invoke.mockImplementation(async (command: string) => {
      if (command === 'request_state') return { userAgent: 'agent', webId: '1' }
      if (command === 'douyin_catalog_request') throw 'verification-required:请完成安全验证。'
    })
    const plugin = await runtime.createPlugin(douyin)
    const query = '夜曲 & 中文/空格'
    await expect(
      plugin.search({ query }).pages()[Symbol.asyncIterator]().next(),
    ).rejects.toMatchObject({
      code: 'verification-required',
    })
    expect(native.invoke).toHaveBeenCalledWith(
      'douyin_catalog_request',
      expect.objectContaining({
        accountId: douyin.id,
        query,
        offset: 0,
      }),
    )
    expect(native.invoke.mock.calls.some(([command]) => command === 'http_request')).toBe(false)
  })

  it('serializes Douyin search despite an old parallel preference and stops at the first risk challenge', async () => {
    const runtime = new AccountRuntime()
    const accounts = ['a', 'b'].map((id) =>
      Object.assign(account(id, 'credential'), { platformId: 'douyin' as const }),
    )
    runtime.snapshot.value = { accounts, proxies: [] }
    for (const profile of accounts)
      runtime.catalog.save({ ...profile, credentialKey: profile.id, status: 'ready' })
    runtime.setPolicy(
      'douyin',
      'search',
      { ...runtime.getPolicy('douyin', 'search'), mode: 'parallel', concurrency: 2 },
      false,
    )
    expect(runtime.getPolicy('douyin', 'search')).toMatchObject({ mode: 'serial', concurrency: 1 })
    vi.spyOn(runtime, 'refresh').mockResolvedValue()
    vi.spyOn(runtime, 'createPlugin').mockResolvedValue({} as MusicSourcePlugin)
    const search = vi.fn(async () => {
      throw new AppError('verification-required')
    })
    await expect(runtime.run('douyin', 'search', search)).rejects.toMatchObject({
      code: 'verification-required',
    })
    expect(search).toHaveBeenCalledOnce()
  })
  it('allows native search startup beyond 25s and still cancels an over-budget attempt', async () => {
    vi.useFakeTimers()
    try {
      const runtime = new AccountRuntime()
      const profile = { ...account('a', 'credential'), platformId: 'douyin' as const }
      runtime.snapshot.value = { accounts: [profile], proxies: [] }
      runtime.catalog.save({ ...profile, credentialKey: profile.id, status: 'ready' })
      vi.spyOn(runtime, 'refresh').mockResolvedValue()
      vi.spyOn(runtime, 'createPlugin').mockResolvedValue({} as MusicSourcePlugin)
      const slow = runtime.run(
        'douyin',
        'search',
        async () => new Promise<string>((resolve) => setTimeout(() => resolve('ok'), 30_000)),
      )
      await vi.advanceTimersByTimeAsync(30_000)
      expect(await slow).toBe('ok')

      let cancelled = false
      const execute = vi.fn(async (_account, _plugin, signal) => {
        signal.subscribe(() => {
          cancelled = true
        })
        return new Promise<never>(() => {})
      })
      const pending = runtime.run('douyin', 'search', execute)
      const assertion = expect(pending).rejects.toMatchObject({ code: 'request-timeout' })
      await vi.advanceTimersByTimeAsync(50_000)
      await assertion
      expect(cancelled).toBe(true)
      expect(execute).toHaveBeenCalledOnce()
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })
  it.each(['network-error', 'request-timeout', 'rate-limited'] as const)(
    'preserves %s from official search without trying another account',
    async (code) => {
      const runtime = new AccountRuntime()
      const profiles = ['a', 'b'].map((id) =>
        Object.assign(account(id, 'credential'), { platformId: 'douyin' as const }),
      )
      runtime.snapshot.value = { accounts: profiles, proxies: [] }
      for (const profile of profiles)
        runtime.catalog.save({ ...profile, credentialKey: profile.id, status: 'ready' })
      vi.spyOn(runtime, 'refresh').mockResolvedValue()
      vi.spyOn(runtime, 'createPlugin').mockResolvedValue({} as MusicSourcePlugin)
      const failure = new AppError(code, 'Official search failed.')
      const execute = vi.fn(async () => {
        throw failure
      })
      await expect(runtime.run('douyin', 'search', execute)).rejects.toBe(failure)
      expect(execute).toHaveBeenCalledOnce()
    },
  )
  it('prefers credentials for session state while preserving public content and explicit account scopes', async () => {
    const runtime = new AccountRuntime()
    runtime.snapshot.value = {
      accounts: [account('guest', 'anonymous'), account('signed-in', 'credential')],
      proxies: [],
    }
    native.invoke.mockResolvedValue(runtime.snapshot.value)
    await runtime.refresh()
    expect(runtime.getPolicy('bilibili', 'session').accountIds).toEqual(['signed-in'])
    expect(runtime.getPolicy('bilibili', 'search').accountIds).toBeUndefined()
    runtime.setPolicy(
      'bilibili',
      'session',
      { ...runtime.getPolicy('bilibili', 'session'), accountIds: ['guest'] },
      false,
    )
    expect(runtime.getPolicy('bilibili', 'session').accountIds).toEqual(['guest'])
  })
  it('preserves leases on rename and cancels them when the proxy changes', async () => {
    const runtime = new AccountRuntime()
    const original = account('a', 'credential')
    native.invoke.mockResolvedValue({ accounts: [original], proxies: [] })
    await runtime.refresh()
    const lease = runtime.catalog.acquire('a')!
    native.invoke.mockResolvedValue({ accounts: [{ ...original, name: 'Renamed' }], proxies: [] })
    await runtime.refresh()
    expect(lease.cancellation.isCancelled()).toBe(false)
    native.invoke.mockResolvedValue({
      accounts: [{ ...original, proxyId: 'new-proxy' }],
      proxies: [],
    })
    await runtime.refresh()
    expect(lease.cancellation.isCancelled()).toBe(true)
    lease.release()
  })
  it('reports cancelled routing as cancellation without suggesting login', async () => {
    const runtime = new AccountRuntime()
    vi.spyOn(runtime, 'refresh').mockResolvedValue()
    const cancellation = new CancellationSource()
    cancellation.cancel()
    await expect(
      runtime.run('bilibili', 'search', vi.fn(), cancellation.signal),
    ).rejects.toMatchObject({ code: 'operation-cancelled' })
  })
  it('releases media returned late by a cancelled attempt and releases its native usage once', async () => {
    const runtime = new AccountRuntime()
    const profile = account('a', 'credential')
    runtime.snapshot.value = { accounts: [profile], proxies: [] }
    runtime.catalog.save({ ...profile, credentialKey: profile.id, status: 'ready' })
    vi.spyOn(runtime, 'refresh').mockResolvedValue()
    vi.spyOn(runtime, 'createPlugin').mockResolvedValue({} as MusicSourcePlugin)
    native.invoke.mockReset().mockResolvedValue(undefined)
    let complete!: (value: { release: () => void }) => void
    let started!: () => void
    const ready = new Promise<void>((resolve) => {
      started = resolve
    })
    const cancellation = new CancellationSource()
    const release = vi.fn()
    const pending = runtime.run(
      'bilibili',
      'playback',
      async () => {
        started()
        return new Promise<{ release: () => void }>((resolve) => {
          complete = resolve
        })
      },
      cancellation.signal,
      undefined,
      (source) => source.release(),
    )
    const rejected = expect(pending).rejects.toMatchObject({ code: 'operation-cancelled' })
    await ready
    cancellation.cancel()
    await rejected
    complete({ release })
    await vi.waitFor(() => expect(release).toHaveBeenCalledTimes(1))
    expect(
      native.invoke.mock.calls.filter(([command]) => command === 'release_account_usage'),
    ).toHaveLength(1)
  })
})
