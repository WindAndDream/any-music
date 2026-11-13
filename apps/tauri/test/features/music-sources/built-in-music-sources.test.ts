import type { MusicSourcePlugin, ResolvedMediaSource, Track, TrackPage } from '@any-music/core'
import { AppError } from '@any-music/core'
import { CancellationSource } from '@any-music/network-routing'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readonly } from 'vue'

import { AccountRuntime } from '@/features/accounts/account-runtime'
import { createBuiltInMusicSources } from '@/features/music-sources/built-in-music-sources'

const verification = vi.hoisted(() => ({ verify: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/platform/douyin-search-verification', () => ({
  verifyDouyinSearch: verification.verify,
}))
const native = vi.hoisted(() => ({ invoke: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@tauri-apps/api/core', () => ({ invoke: native.invoke }))
beforeEach(() => {
  native.invoke.mockClear()
  verification.verify.mockClear()
})

describe('account listing lifetime', () => {
  it('offers restored search verification for the challenged account within the current policy without a search', async () => {
    const runtime = new AccountRuntime()
    const accounts = ['a', 'b'].map((id) => ({
      id,
      platformId: 'douyin',
      name: id,
      enabled: true,
      status: 'verification-required',
      authentication: 'credential' as const,
      state: {
        login: 'signed-in' as const,
        verification: 'required' as const,
        connection: 'available' as const,
      },
      userAgent: 'agent',
      webId: '1',
      proxyId: null,
      backupProxyIds: [],
    }))
    runtime.snapshot.value = { accounts, proxies: [] }
    runtime.selectedAccountIds.value = { douyin: 'b' }
    vi.spyOn(runtime, 'refresh').mockResolvedValue()
    const run = vi.spyOn(runtime, 'run')
    const createPlugin = vi.spyOn(runtime, 'createPlugin')
    const listing = createBuiltInMusicSources(runtime, 'desktop')[1]!.search({ query: '夜曲' })
    expect(listing.verify).toBeTypeOf('function')
    expect(listing.account).toBeUndefined()
    expect(native.invoke).not.toHaveBeenCalled()
    expect(verification.verify).not.toHaveBeenCalled()
    await listing.verify?.()
    expect(verification.verify).toHaveBeenCalledExactlyOnceWith('b', '夜曲', undefined, undefined)
    expect(listing.account?.id).toBe('b')
    expect(run).not.toHaveBeenCalled()
    expect(createPlugin).not.toHaveBeenCalled()
  })
  it('resolves a list track with its original account and falls back after that account is removed', async () => {
    const runtime = new AccountRuntime()
    let accounts = ['a', 'b'].map((id) => ({
      backupProxyIds: [],
      state: {
        login: 'signed-in' as 'signed-in' | 'signed-out',
        verification: 'not-required' as const,
        connection: 'available' as const,
      },

      id,
      platformId: 'bilibili' as const,
      name: id,
      status: 'ready',
      enabled: true,
      userAgent: 'agent',
      webId: '1',
      proxyId: null,
      authentication: 'credential' as const,
    }))
    native.invoke.mockImplementation(async (command) =>
      command === 'account_snapshot' ? { accounts, proxies: [] } : undefined,
    )
    await runtime.refresh()
    runtime.selectedAccountIds.value = { bilibili: 'b' }
    const track: Track = {
      id: 'song',
      title: '歌曲',
      artists: [],
      source: { pluginId: 'bilibili', resourceId: '1', mediaKind: 'audio' },
    }
    runtime.rememberTrackAccount(track, 'a')
    const media: ResolvedMediaSource = {
      type: 'complete-binary',
      bytes: new Uint8Array(),
      mimeType: 'audio/mpeg',
      loadingStrategy: 'eager',
      quality: { id: 'default', label: '默认', rank: 1 },
      availableQualities: [],
    }
    vi.spyOn(runtime, 'createPlugin').mockResolvedValue({
      resolveMedia: async () => media,
    } as unknown as MusicSourcePlugin)
    const source = createBuiltInMusicSources(runtime, 'desktop')[0]!
    const first = await source.resolveMedia(readonly(track))
    expect(first.accountId).toBe('a')
    first.release?.()
    accounts = accounts.filter((account) => account.id === 'b')
    const fallback = await source.resolveMedia(readonly(track))
    expect(fallback.accountId).toBe('b')
    fallback.release?.()
  })
  it('pins reloads to the original identity and chooses an available account after deletion', async () => {
    const runtime = new AccountRuntime()
    const accounts = ['a', 'b'].map((id) => ({
      backupProxyIds: [],
      state: {
        login: 'signed-in' as 'signed-in' | 'signed-out',
        verification: 'not-required' as const,
        connection: 'available' as const,
      },

      id,
      platformId: 'bilibili' as const,
      name: id,
      status: 'ready',
      enabled: true,
      userAgent: 'agent',
      webId: '1',
      proxyId: null,
      authentication: 'credential' as const,
    }))
    let savedAccounts = accounts
    native.invoke.mockImplementation(async (command) =>
      command === 'account_snapshot' ? { accounts: savedAccounts, proxies: [] } : undefined,
    )
    await runtime.refresh()
    runtime.selectedAccountIds.value = { bilibili: 'a' }
    const loaded: string[] = []
    vi.spyOn(runtime, 'createPlugin').mockImplementation(
      async (account) =>
        ({
          search: () => ({
            id: account.id,
            title: '音乐',
            async *pages() {
              loaded.push(`${account.id}:1`)
              yield { items: [], pageNumber: 1, pageSize: 1, hasMore: true }
              loaded.push(`${account.id}:2`)
              yield { items: [], pageNumber: 2, pageSize: 1, hasMore: false }
            },
          }),
        }) as unknown as MusicSourcePlugin,
    )
    const listing = createBuiltInMusicSources(runtime, 'desktop')[0]!.search({ query: '音乐' })
    let pages = listing.pages()[Symbol.asyncIterator]()
    await pages.next()
    await pages.return?.()
    runtime.selectedAccountIds.value = { bilibili: 'b' }
    pages = listing.pages()[Symbol.asyncIterator]()
    await pages.next()
    expect(listing.account?.id).toBe('a')
    await pages.return?.()
    savedAccounts = accounts.filter((account) => account.id === 'b')
    await runtime.refresh()
    pages = listing.pages()[Symbol.asyncIterator]()
    await pages.next()
    expect(listing.account?.id).toBe('b')
    expect(loaded).toEqual(['a:1', 'a:1', 'b:1'])
    await pages.return?.()
  })
  it('shows the winning account and its custom name without extra session checks or following selection changes', async () => {
    const runtime = new AccountRuntime()
    const accounts = ['a', 'b'].map((id) => ({
      backupProxyIds: [],
      state: {
        login: 'signed-in' as 'signed-in' | 'signed-out',
        verification: 'not-required' as const,
        connection: 'available' as const,
      },

      id,
      platformId: 'bilibili' as const,
      name: `自定义${id}`,
      status: 'ready',
      enabled: true,
      userAgent: 'agent',
      webId: '1',
      proxyId: null,
      authentication: 'credential' as const,
    }))
    runtime.snapshot.value = { accounts, proxies: [] }
    for (const account of accounts)
      runtime.catalog.save({ ...account, credentialKey: account.id, status: 'ready' })
    const getSession = vi.fn(async () => ({
      status: 'signed-in' as const,
      user: { id: 'remote-b', name: '平台用户B' },
    }))
    const plugin = {
      getSession,
      search: () => ({
        id: 'listing',
        title: '结果',
        async *pages() {
          yield { items: [], pageNumber: 1, pageSize: 1, hasMore: true }
          yield { items: [], pageNumber: 2, pageSize: 1, hasMore: false }
        },
      }),
    } as unknown as MusicSourcePlugin
    vi.spyOn(runtime, 'createPlugin').mockResolvedValue(plugin)
    vi.spyOn(runtime, 'run').mockImplementation(async (_, _operation, execute) =>
      execute(accounts[1]!, plugin, new CancellationSource().signal),
    )
    const source = createBuiltInMusicSources(runtime, 'desktop')[0]!
    const session = await source.getSession()
    expect(session).toEqual({
      status: 'signed-in',
      user: { id: 'remote-b', name: '平台用户B', customName: '自定义b' },
    })
    expect(runtime.sessionUserNames.value.get('b')).toBe('平台用户B')
    expect(runtime.sessionUserNames.value.has('a')).toBe(false)
    const listing = source.search({ query: '音乐' })
    expect(listing.account).toBeUndefined()
    const pages = listing.pages()[Symbol.asyncIterator]()
    await pages.next()
    expect(listing.account).toMatchObject({ id: 'b', name: '平台用户B', customName: '自定义b' })
    runtime.selectedAccountIds.value = { bilibili: 'a' }
    runtime.snapshot.value = {
      accounts: accounts.map((account) =>
        account.id === 'b' ? Object.assign({}, account, { name: '新的命名' }) : account,
      ),
      proxies: [],
    }
    await pages.next()
    expect(listing.account).toMatchObject({ id: 'b', name: '平台用户B', customName: '新的命名' })
    expect(session.status === 'signed-in' && session.user.customName).toBe('新的命名')
    expect(getSession).toHaveBeenCalledOnce()
    await pages.return?.()
  })
  it('uses the selected search route for text search and imported legacy search lists without opening a browser', () => {
    const runtime = new AccountRuntime()
    const source = createBuiltInMusicSources(runtime, 'desktop')[1]!
    const expected = 'https://www.douyin.com/jingxuan/search/%E5%8F%A4%E9%A3%8E?type=general'
    expect(source.search({ query: ' 古风 ' }).sourceUrl).toBe(expected)
    expect(
      source.importFromUrl({ url: 'https://www.douyin.com/search/%E5%8F%A4%E9%A3%8E' }).sourceUrl,
    ).toBe(expected)
    expect(
      source.importFromUrl({
        url: 'https://www.douyin.com/jingxuan/search/%E5%8F%A4%E9%A3%8E?aid=example&type=general',
      }).sourceUrl,
    ).toBe(expected)
    expect(verification.verify).not.toHaveBeenCalled()
  })
  it('binds verification and recovery to the error actually returned from concurrent account attempts', async () => {
    const runtime = new AccountRuntime()
    const accounts = ['a', 'b'].map((id) => ({
      backupProxyIds: [],
      state: {
        login: 'signed-in' as 'signed-in' | 'signed-out',
        verification: 'not-required' as const,
        connection: 'available' as const,
      },

      id,
      platformId: 'douyin' as const,
      name: id,
      status: 'ready',
      enabled: true,
      userAgent: 'agent',
      webId: '1',
      proxyId: null,
      authentication: 'credential' as const,
    }))
    for (const account of accounts)
      runtime.catalog.save({ ...account, credentialKey: account.id, status: 'ready' })
    runtime.snapshot.value = { accounts, proxies: [] }
    const failures = [
      new AppError('verification-required', 'A'),
      new AppError('verification-required', 'B'),
    ]
    let verified = false
    const plugin = (index: number) =>
      ({
        search: () => ({
          id: 'listing',
          title: '夜曲',
          async *pages() {
            if (!verified) throw failures[index]
            yield { items: [], pageNumber: 1, pageSize: 10, hasMore: false }
          },
        }),
      }) as unknown as MusicSourcePlugin
    vi.spyOn(runtime, 'createPlugin').mockImplementation(async (account) =>
      plugin(account.id === 'a' ? 0 : 1),
    )
    vi.spyOn(runtime, 'refresh').mockResolvedValue()
    const run = vi
      .spyOn(runtime, 'run')
      .mockImplementation(async (_, _operation, execute, _cancel, pinned) => {
        if (pinned) return execute(accounts[0]!, plugin(0), new CancellationSource().signal)
        await Promise.allSettled(
          accounts.map((account, index) =>
            execute(account, plugin(index), new CancellationSource().signal),
          ),
        )
        // Routing returns A even though B's local failure was observed later.
        throw failures[0]
      })
    const listing = createBuiltInMusicSources(runtime, 'desktop')[1]!.search({ query: '夜曲' })
    await expect(listing.pages()[Symbol.asyncIterator]().next()).rejects.toBe(failures[0])
    expect(listing.account).toMatchObject({ id: 'a', customName: 'a' })
    await listing.verify?.()
    expect(verification.verify).toHaveBeenCalledWith('a', '夜曲', undefined, undefined)
    verified = true
    let pages = listing.pages()[Symbol.asyncIterator]()
    await pages.next()
    expect(run.mock.calls.at(-1)?.[4]).toBe('a')
    await pages.return?.()
    runtime.catalog.remove('a')
    runtime.snapshot.value = { accounts: [accounts[1]!], proxies: [] }
    run.mockImplementation(async (_, _operation, execute) =>
      execute(accounts[1]!, plugin(1), new CancellationSource().signal),
    )
    pages = listing.pages()[Symbol.asyncIterator]()
    await pages.next()
    await pages.return?.()
    expect(listing.account?.id).toBe('b')
    pages = listing.pages()[Symbol.asyncIterator]()
    await pages.next()
    expect(run.mock.calls.at(-1)?.[4]).toBe('b')
    await pages.return?.()
  })
  it('keeps the winning pages alive after the competition lease ends, then releases on return', async () => {
    const runtime = new AccountRuntime()
    const account = {
      backupProxyIds: [],
      state: {
        login: 'signed-in' as 'signed-in' | 'signed-out',
        verification: 'not-required' as const,
        connection: 'available' as const,
      },

      id: 'a',
      platformId: 'bilibili' as const,
      name: 'A',
      status: 'ready',
      enabled: true,
      userAgent: 'agent',
      webId: '1',
      proxyId: null,
      authentication: 'credential' as const,
    }
    runtime.catalog.save({
      id: 'a',
      platformId: 'bilibili',
      name: 'A',
      authentication: 'credential',
      credentialKey: 'a',
      enabled: true,
      status: 'ready',
    })
    const attempted = new CancellationSource()
    let pageSignal: Parameters<AccountRuntime['createPlugin']>[1]
    const cleanup = vi.fn()
    const page: TrackPage = { items: [], pageNumber: 1, pageSize: 1, hasMore: true }
    const iterator = {
      next: vi.fn(async () => {
        if (pageSignal?.isCancelled()) throw new Error('cancelled')
        return { done: false as const, value: page }
      }),
      return: vi.fn(async () => {
        cleanup()
        return { done: true as const, value: undefined }
      }),
    }
    const plugin = {
      search: () => ({
        id: 'listing',
        title: 'Result',
        pages: () => ({ [Symbol.asyncIterator]: () => iterator }),
      }),
    } as unknown as MusicSourcePlugin
    vi.spyOn(runtime, 'createPlugin').mockImplementation(async (_, signal) => {
      pageSignal = signal
      return plugin
    })
    vi.spyOn(runtime, 'run').mockImplementation(async (_platform, _operation, execute) => {
      const result = await execute(account, plugin, attempted.signal)
      attempted.cancel()
      return result
    })
    const listing = createBuiltInMusicSources(runtime, 'desktop')[0]!.search({ query: 'music' })
    const pages = listing.pages()[Symbol.asyncIterator]()
    await pages.next()
    await pages.next()
    const usage = native.invoke.mock.calls.find(([name]) => name === 'acquire_account_usage')?.[1]
    expect(usage).toMatchObject({ accountId: 'a', reason: '搜索' })
    expect(native.invoke.mock.calls.some(([name]) => name === 'release_account_usage')).toBe(false)
    expect(iterator.next).toHaveBeenCalledTimes(2)
    expect(pageSignal?.isCancelled()).toBe(false)
    await pages.return?.()
    expect(pageSignal?.isCancelled()).toBe(true)
    expect(cleanup).toHaveBeenCalledOnce()
    expect(native.invoke).toHaveBeenCalledWith('release_account_usage', { usageId: usage.usageId })
  })
})
