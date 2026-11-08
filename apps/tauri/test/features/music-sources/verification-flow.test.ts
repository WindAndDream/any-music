import type { HttpResponse } from '@any-music/core'
import { configureWorkbenchRuntime } from '@any-music/music-workbench'
import { useMusicSourceWorkspace } from '@any-music/music-workbench/features/music-sources/use-music-source-workspace'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, onScopeDispose } from 'vue'

import { AccountRuntime } from '@/features/accounts/account-runtime'
import type { NativeAccount } from '@/features/accounts/account-runtime'
import { createBuiltInMusicSources } from '@/features/music-sources/built-in-music-sources'

const native = vi.hoisted(() => ({ invoke: vi.fn() }))
vi.mock('@tauri-apps/api/core', () => ({ invoke: native.invoke }))
const scopes: ReturnType<typeof effectScope>[] = []
beforeEach(() => {
  native.invoke.mockReset()
  const preferences = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => preferences.get(key) ?? null,
    setItem: (key: string, value: string) => preferences.set(key, value),
  })
  vi.stubGlobal('window', {
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
  })
  setActivePinia(createPinia())
})
afterEach(() => {
  scopes.splice(0).forEach((scope) => scope.stop())
  vi.unstubAllGlobals()
})
const emptySearch = { status_code: 0, data: [], has_more: 0, cursor: 0 }
const bytes = (value: unknown) => Array.from(new TextEncoder().encode(JSON.stringify(value)))

function setup(authentication: NativeAccount['authentication'] = 'credential', paused = true) {
  let account: NativeAccount = {
    backupProxyIds: [],

    id: 'account-a',
    platformId: 'douyin',
    name: '我的账号',
    enabled: true,
    status: paused ? 'verification-required' : 'ready',
    authentication,
    state: {
      login: authentication === 'credential' ? 'signed-in' : 'unknown',
      verification: paused ? 'required' : 'not-required',
      connection: 'available',
    },
    proxyId: null,
    userAgent: 'agent',
    webId: '1',
  }
  const runtime = new AccountRuntime()
  let launchError: string | undefined
  let commitError: string | undefined
  let failRefreshAfterCommit = false
  let failSnapshot = false
  let waiting = false
  let pageChallenge = false
  let searchDocument: unknown = emptySearch
  native.invoke.mockImplementation(async (command: string, args: Record<string, unknown>) => {
    if (command === 'account_snapshot') {
      if (failSnapshot) {
        failSnapshot = false
        throw new Error('账号快照暂时无法刷新')
      }
      return { accounts: [account], proxies: [] }
    }
    if (command === 'douyin_catalog_request')
      return [0, 200, ...bytes(account.status === 'ready' ? searchDocument : { status_code: 2483 })]
    if (command === 'report_douyin_search_failure') {
      if (args.code === 'pagination-unavailable' && account.status === 'ready' && !pageChallenge)
        return 'pagination-unavailable'
      account = {
        ...account,
        status: 'verification-required',
        state: { ...account.state!, verification: 'required' },
      }
      return 'verification-required'
    }
    if (command === 'begin_douyin_search_verification' && launchError) throw launchError
    if (command === 'poll_douyin_search_verification')
      return waiting ? null : { status: 200, body: bytes(emptySearch) }
    if (command === 'end_douyin_search_verification' && args.completed) {
      if (commitError) throw commitError
      account = {
        ...account,
        status: 'ready',
        authentication: 'credential',
        state: { login: 'signed-in', verification: 'not-required', connection: 'available' },
      }
      failSnapshot = failRefreshAfterCommit
    }
  })
  const plugin = createBuiltInMusicSources(runtime, 'desktop')[1]!
  configureWorkbenchRuntime({
    externalPlugins: 'declarative',
    storage: { read: (_key, fallback) => fallback, write: vi.fn() },
    http: { request: vi.fn<() => Promise<HttpResponse>>() },
    builtInMusicSources: [plugin],
    configureProxy: vi.fn(),
    openLogin: vi.fn(),
  })
  const scope = effectScope()
  scopes.push(scope)
  const workspace = scope.run(() =>
    useMusicSourceWorkspace({
      plugins: [plugin],
      availabilityByPluginId: { douyin: { status: 'available', checkedAtMs: 1 } },
      activePlugin: plugin,
      activatePlugin: vi.fn(),
      getPlugin: () => plugin,
    }),
  )!
  const unsubscribe = runtime.subscribeSourceInvalidation(workspace.invalidateSource)
  scope.run(() => onScopeDispose(unsubscribe))
  return {
    runtime,
    workspace,
    setRefreshFailureAfterCommit: () => {
      failRefreshAfterCommit = true
    },
    setCommitError: (error?: string) => {
      commitError = error
    },
    setSearchDocument: (value: unknown) => {
      searchDocument = value
    },
    setPageChallenge: (value: boolean) => {
      pageChallenge = value
    },
    setLaunchError: (error?: string) => {
      launchError = error
    },
    setWaiting: (value: boolean) => {
      waiting = value
    },
    removeAccount: () => {
      account = { ...account, enabled: false }
    },
  }
}

describe('Douyin request, identity, verification and recovery flow', () => {
  it('offers verification for an empty first page with a visible challenge and restores songs afterwards', async () => {
    const { workspace, setPageChallenge, setSearchDocument } = setup('credential', false)
    setPageChallenge(true)
    await workspace.search('动漫歌曲')
    const drawer = workspace.drawers.value[0]!
    expect(drawer).toMatchObject({
      status: 'error',
      errorCode: 'verification-required',
      canVerify: true,
      loadedPageCount: 0,
    })
    setPageChallenge(false)
    setSearchDocument({
      status_code: 0,
      data: [
        { type: 1, doc_type: 153, aweme_info: { aweme_id: '123', video: { duration: 1000 } } },
      ],
      has_more: 0,
    })
    await workspace.verify(drawer.id)
    expect(workspace.drawers.value[0]).toMatchObject({
      status: 'ready',
      loadedPageCount: 1,
      tracks: [{ id: 'douyin:video:123' }],
      account: { state: { login: 'signed-in', verification: 'not-required' } },
    })
    expect(
      native.invoke.mock.calls.filter(([name]) => name === 'douyin_catalog_request'),
    ).toHaveLength(2)
  })

  it('retries snapshot recovery after confirmed verification without opening a second browser', async () => {
    const { workspace, setRefreshFailureAfterCommit } = setup('anonymous')
    await workspace.search('夜曲')
    const id = workspace.drawers.value[0]!.id
    setRefreshFailureAfterCommit()
    await workspace.verify(id)
    expect(workspace.drawers.value[0]).toMatchObject({
      errorCode: 'upstream-error',
      failureOperation: 'restore',
      canVerify: false,
      verificationPhase: 'failed',
    })
    await workspace.retry(id)
    expect(workspace.drawers.value[0]).toMatchObject({
      status: 'ready',
      loadedPageCount: 1,
      account: { state: { login: 'signed-in', verification: 'not-required' } },
    })
    expect(
      native.invoke.mock.calls.filter(([name]) => name === 'begin_douyin_search_verification'),
    ).toHaveLength(1)
  })
  it('reports confirmation failure separately and retries the same account without claiming verification succeeded', async () => {
    const { workspace, setCommitError } = setup()
    await workspace.search('夜曲')
    const id = workspace.drawers.value[0]!.id
    setCommitError('invalid-response:官方登录资料尚未确认')
    await workspace.verify(id)
    expect(workspace.drawers.value[0]).toMatchObject({
      errorCode: 'verification-required',
      canVerify: true,
      verificationPhase: 'failed',
      verificationErrorMessage: expect.stringContaining('官方登录资料尚未确认'),
      loadedPageCount: 0,
    })
    setCommitError()
    await workspace.verify(id)
    expect(workspace.drawers.value[0]?.status).toBe('ready')
  })
  it('keeps unknown action errors separate from authentication and retries after recovery', async () => {
    const { workspace, setLaunchError } = setup()
    await workspace.search('夜曲')
    const id = workspace.drawers.value[0]!.id
    setLaunchError('无法识别的原生错误')
    await workspace.verify(id)
    expect(workspace.drawers.value[0]).toMatchObject({
      errorCode: 'verification-required',
      canVerify: true,
      verificationErrorMessage: expect.stringContaining('AM-1000'),
      account: { state: { login: 'signed-in' } },
    })
    setLaunchError()
    await workspace.verify(id)
    expect(workspace.drawers.value[0]?.status).toBe('ready')
  })
  it.each(['search', 'pagination'] as const)(
    'recovers a challenge returned by the actual source adapter during %s',
    async (operation) => {
      const { workspace, setSearchDocument } = setup('credential', false)
      if (operation === 'search') setSearchDocument({ status_code: 2483 })
      else
        setSearchDocument({
          ...emptySearch,
          data: [
            {
              type: 1,
              aweme_info: {
                aweme_id: 'work',
                desc: '歌曲',
                author: { nickname: '作者' },
                video: {
                  duration: 1000,
                  play_addr: { url_list: ['https://media.example/song.mp4'] },
                },
              },
            },
          ],
          has_more: 1,
          cursor: 10,
        })
      await workspace.search('夜曲')
      const id = workspace.drawers.value[0]!.id
      if (operation === 'pagination') {
        setSearchDocument({ status_code: 2483 })
        await workspace.loadNext(id)
      }
      expect(workspace.drawers.value[0]).toMatchObject({
        errorCode: 'verification-required',
        canVerify: true,
        failureOperation: operation,
        account: { id: 'account-a', state: { login: 'signed-in', verification: 'required' } },
      })
      setSearchDocument(emptySearch)
      await workspace.verify(id)
      expect(workspace.drawers.value[0]).toMatchObject({
        status: 'ready',
        loadedPageCount: 1,
        canVerify: false,
      })
    },
  )
  it.each(['credential', 'anonymous'] as const)(
    'binds a preflight challenge before exposing verification and restores the same %s identity',
    async (authentication) => {
      const { workspace } = setup(authentication)
      await workspace.search('夜曲')
      const failed = workspace.drawers.value[0]!
      expect(failed).toMatchObject({
        errorCode: 'verification-required',
        canVerify: true,
        account: { id: 'account-a' },
        failureOperation: 'search',
      })
      expect(native.invoke.mock.calls.some(([name]) => name === 'douyin_catalog_request')).toBe(
        false,
      )
      await workspace.verify(failed.id)
      expect(native.invoke).toHaveBeenCalledWith(
        'begin_douyin_search_verification',
        expect.objectContaining({ accountId: 'account-a', query: '夜曲' }),
      )
      expect(workspace.drawers.value[0]).toMatchObject({
        status: 'ready',
        loadedPageCount: 1,
        canVerify: false,
        verificationPhase: 'complete',
        account: { id: 'account-a', state: { login: 'signed-in', verification: 'not-required' } },
      })
      expect(
        native.invoke.mock.calls.filter(([name]) => name === 'douyin_catalog_request'),
      ).toHaveLength(1)
    },
  )

  it('retains the original challenge after a browser launch failure and the next click launches and restores', async () => {
    const { workspace, setLaunchError } = setup()
    await workspace.search('音乐')
    const id = workspace.drawers.value[0]!.id
    setLaunchError('network-error:浏览器启动失败')
    await workspace.verify(id)
    expect(workspace.drawers.value[0]).toMatchObject({
      errorCode: 'verification-required',
      canVerify: true,
      verificationPhase: 'failed',
      verificationErrorMessage: expect.stringContaining('浏览器启动失败'),
    })
    setLaunchError()
    await workspace.verify(id)
    expect(workspace.drawers.value[0]).toMatchObject({
      status: 'ready',
      verificationErrorMessage: '',
    })
    expect(
      native.invoke.mock.calls.filter(([name]) => name === 'begin_douyin_search_verification'),
    ).toHaveLength(2)
  })

  it('ignores duplicate actions while waiting, allows cancellation and keeps a working verification action', async () => {
    const { workspace, setWaiting } = setup()
    await workspace.search('音乐')
    const id = workspace.drawers.value[0]!.id
    setWaiting(true)
    const pending = workspace.verify(id)
    await vi.waitFor(() => expect(workspace.drawers.value[0]?.verificationPhase).toBe('waiting'))
    await workspace.verify(id)
    await workspace.retry(id)
    expect(
      native.invoke.mock.calls.filter(([name]) => name === 'begin_douyin_search_verification'),
    ).toHaveLength(1)
    workspace.cancelVerification(id)
    await pending
    expect(workspace.drawers.value[0]).toMatchObject({
      errorCode: 'verification-required',
      canVerify: true,
      verificationPhase: 'cancelled',
      isVerifying: false,
    })
    setWaiting(false)
    await workspace.verify(id)
    expect(workspace.drawers.value[0]?.status).toBe('ready')
  })

  it('uses the selected search import account and hides verification when that account is disabled', async () => {
    const { workspace, runtime, removeAccount } = setup()
    await workspace.importFromUrl('https://www.douyin.com/search/夜曲')
    const id = workspace.drawers.value[0]!.id
    expect(workspace.drawers.value[0]?.canVerify).toBe(true)
    removeAccount()
    await runtime.refresh()
    await workspace.verify(id)
    expect(workspace.drawers.value[0]?.canVerify).toBe(false)
    expect(
      native.invoke.mock.calls.some(([name]) => name === 'begin_douyin_search_verification'),
    ).toBe(false)
    await workspace.retry(id)
    expect(workspace.drawers.value[0]?.errorCode).toBe('account-unavailable')
  })
})
