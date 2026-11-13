import { AccountCatalog, AccountSelector, requestWithAccountPool } from '@any-music/account-pool'
import type { AccountOperationPolicy } from '@any-music/account-pool'
import { AppError, createAppErrorState } from '@any-music/core'
import type { CancellationSignal, MusicSourcePlugin, Track } from '@any-music/core'
import type { SourceInvalidation } from '@any-music/music-workbench'
import {
  CancellationSource,
  DEFAULT_ATTEMPT_POLICY,
  RoutingError,
} from '@any-music/network-routing'
import { invoke } from '@tauri-apps/api/core'
import { shallowRef, toRaw } from 'vue'

import { createNativeHttpClient } from '../../platform/native-http'
import { BUILT_IN_SOURCE_DIRECTORY } from '../music-sources/built-in-source-directory'
import { AccountOperationError } from './account-operation-error'
import { ACCOUNT_PLATFORMS } from './account-presentation'
import type { AccountState } from './account-state'
import { getAccountState } from './account-state'
import type { AccountPlatform } from './source-authentication'

export interface NativeAccount {
  id: string
  platformId: string
  name: string
  status: string
  state: AccountState
  enabled: boolean
  userAgent: string
  webId: string
  proxyId: string | null
  backupProxyIds: string[]
  authentication: 'anonymous' | 'credential'
  pending?: boolean
}
export interface NativeProxy {
  id: string
  name: string
  url: string
}
export interface AccountSnapshot {
  accounts: NativeAccount[]
  proxies: NativeProxy[]
  accountLabels?: Readonly<Record<string, { name: string; activeAccountId: string | null }>>
}
export type AccountOperation = 'search' | 'import' | 'playback' | 'session'
const POLICY_STORAGE_KEY = 'any-music:tauri:account-policies:v1'
const SELECTION_STORAGE_KEY = 'any-music:tauri:selected-accounts:v1'

/** Public account metadata is reactive; credentials and browser processes remain in Rust. */
export class AccountRuntime {
  readonly sourcePlatforms = shallowRef<readonly AccountPlatform[]>([])
  private sourcePlatformGeneration = 0
  async refreshSourcePlatforms(): Promise<void> {
    const generation = ++this.sourcePlatformGeneration
    const platforms = await invoke<AccountPlatform[]>('source_account_platforms')
    if (generation === this.sourcePlatformGeneration && Array.isArray(platforms)) {
      const directory = new Map(platforms.map((platform) => [platform.id, platform]))
      for (const account of this.snapshot.value.accounts) {
        if (account.platformId.startsWith('external:') && !directory.has(account.platformId))
          directory.set(account.platformId, {
            id: account.platformId,
            name: `不可用的外置来源（${account.platformId.slice(-8)}）`,
            available: false,
          })
      }
      this.sourcePlatforms.value = [...directory.values()]
    }
  }
  readonly snapshot = shallowRef<AccountSnapshot>({ accounts: [], proxies: [] })
  /** 复用既有会话检查的公开用户名；账号弹窗与列表详情不为展示额外请求平台。 */
  readonly sessionUserNames = shallowRef<ReadonlyMap<string, string>>(new Map())
  readonly catalog = new AccountCatalog()
  readonly selectedAccountIds = shallowRef<Readonly<Record<string, string>>>({})
  private readonly selector = new AccountSelector()
  private readonly policies = new Map<string, AccountOperationPolicy>()
  private generation = 0
  private readonly invalidationListeners = new Set<(event: SourceInvalidation) => void>()
  private readonly uses = new Map<string, Set<{ trackId?: string; release: () => void }>>()
  private readonly accountGenerations = new Map<string, number>()
  private readonly trackAccounts = new WeakMap<Track, string>()

  /** Routing stays ephemeral; stable provenance is display-only, including after re-addition. */
  rememberTrackAccount(track: Track, accountId: string): void {
    this.trackAccounts.set(toRaw(track), accountId)
    const account = this.snapshot.value.accounts.find((item) => item.id === accountId)
    if (account)
      track.acquisition = { accountId, accountName: account.name, acquiredAtMs: Date.now() }
  }
  getAccountLabel(accountId: string) {
    const snapshot = this.snapshot.value
    const label = snapshot.accountLabels?.[accountId]
    if (label) return label
    const current = snapshot.accounts.find((account) => account.id === accountId)
    return current ? { name: current.name, activeAccountId: current.id } : undefined
  }
  getTrackAccountName = (track: Track): string | undefined => {
    const acquisition = track.acquisition
    return acquisition
      ? (this.getAccountLabel(acquisition.accountId)?.name ?? acquisition.accountName)
      : undefined
  }
  getTrackAccountId(track: Track): string | undefined {
    return this.trackAccounts.get(toRaw(track))
  }

  subscribeSourceInvalidation = (listener: (event: SourceInvalidation) => void): (() => void) => {
    this.invalidationListeners.add(listener)
    return () => this.invalidationListeners.delete(listener)
  }

  async refresh(): Promise<void> {
    const generation = ++this.generation
    const next = await invoke<AccountSnapshot>('account_snapshot')
    if (generation !== this.generation) return
    const byId = new Map(next.accounts.map((a) => [a.id, a]))
    const ids = new Set(byId.keys())
    const invalidated = this.snapshot.value.accounts.filter((old) => {
      const account = byId.get(old.id)
      return (
        !account ||
        (old.enabled && !account.enabled) ||
        (account &&
          (old.proxyId !== account.proxyId ||
            JSON.stringify(old.backupProxyIds ?? []) !==
              JSON.stringify(account.backupProxyIds ?? []) ||
            old.userAgent !== account.userAgent ||
            old.authentication !== account.authentication))
      )
    })
    // 先发布新快照，再撤销旧身份；订阅者恢复时只能选择仍可用的账号。
    this.snapshot.value = next
    for (const account of invalidated) {
      this.accountGenerations.set(account.id, (this.accountGenerations.get(account.id) ?? 0) + 1)
      const uses = [...(this.uses.get(account.id) ?? [])]
      const event: SourceInvalidation = {
        pluginId: account.platformId,
        accountId: account.id,
        reason: next.accounts.some(
          (updated) =>
            updated.id === account.id &&
            updated.enabled &&
            updated.authentication !== account.authentication &&
            updated.proxyId === account.proxyId &&
            JSON.stringify(updated.backupProxyIds ?? []) ===
              JSON.stringify(account.backupProxyIds ?? []),
        )
          ? 'credentials-updated'
          : 'configuration-updated',
        trackIds: [...new Set(uses.flatMap((use) => (use.trackId ? [use.trackId] : [])))],
        error: createAppErrorState(
          'operation-cancelled',
          !ids.has(account.id)
            ? '列表使用的账号已删除，旧请求已中止。重试时将重新选择可用账号；若没有可用账号，请在设置中添加。'
            : '列表使用的账号已停用或请求环境已更新，旧请求已中止，请重试加载。',
        ),
      }
      this.catalog.remove(account.id)
      for (const listener of this.invalidationListeners) listener(event)
      for (const use of uses) use.release()
    }
    this.sessionUserNames.value = new Map(
      [...this.sessionUserNames.value].filter(([id]) => ids.has(id)),
    )
    for (const old of this.catalog.list()) if (!ids.has(old.id)) this.catalog.remove(old.id)
    for (const account of next.accounts) {
      this.catalog.save({
        id: account.id,
        platformId: account.platformId,
        name: account.name,
        authentication: account.authentication,
        credentialKey: account.authentication === 'credential' ? account.id : undefined,
        enabled:
          account.enabled &&
          !account.pending &&
          (account.platformId.startsWith('external:') || account.authentication === 'credential'),
        status: [
          'ready',
          'expired',
          'verification-required',
          'network-blocked',
          'signed-out',
        ].includes(account.status)
          ? (account.status as 'ready')
          : 'signed-out',
      })
    }
    const selected = Object.fromEntries(
      Object.entries(this.selectedAccountIds.value).filter(([platform, id]) =>
        next.accounts.some(
          (account) => account.id === id && account.platformId === platform && account.enabled,
        ),
      ),
    )
    if (JSON.stringify(selected) !== JSON.stringify(this.selectedAccountIds.value)) {
      this.selectedAccountIds.value = selected
      localStorage.setItem(SELECTION_STORAGE_KEY, JSON.stringify(selected))
    }
  }
  async initialize(): Promise<void> {
    await this.refresh()
    let stored: Record<string, AccountOperationPolicy> = {}
    try {
      stored = JSON.parse(localStorage.getItem(POLICY_STORAGE_KEY) ?? '{}') ?? {}
    } catch {
      // Preferences can be restored independently of the native account vault.
    }
    for (const [key, policy] of Object.entries(stored)) {
      const [platform, operation] = key.split('/')
      if (platform && operation) {
        try {
          this.setPolicy(platform, operation as AccountOperation, policy, false)
        } catch {
          /* Discard invalid preferences. */
        }
      }
    }
    try {
      const selected: unknown = JSON.parse(localStorage.getItem(SELECTION_STORAGE_KEY) ?? '{}')
      if (selected && typeof selected === 'object' && !Array.isArray(selected)) {
        this.selectedAccountIds.value = Object.fromEntries(
          Object.entries(selected).filter(
            ([platform, id]) =>
              typeof id === 'string' &&
              this.snapshot.value.accounts.some(
                (account) =>
                  account.id === id && account.platformId === platform && account.enabled,
              ),
          ),
        )
      }
    } catch {
      /* Ignore invalid identity preferences; credentials remain in the native vault. */
    }
  }

  /** 搜索偏好只作用于新操作；已存在的列表和媒体保持实际使用的账号。 */
  async selectAccount(platform: string, id: string | null): Promise<void> {
    if (
      ![...ACCOUNT_PLATFORMS, ...this.sourcePlatforms.value].some(
        (source) => source.id === platform,
      )
    )
      throw new AppError('invalid-input', '平台不支持账号切换。')
    if (
      id &&
      !this.snapshot.value.accounts.some(
        (account) => account.id === id && account.platformId === platform && account.enabled,
      )
    )
      throw new AppError('invalid-input', '账号已停用或不存在，请刷新后重试。')
    if ((this.selectedAccountIds.value[platform] ?? null) === id) return
    const selected = { ...this.selectedAccountIds.value }
    if (id) selected[platform] = id
    else delete selected[platform]
    localStorage.setItem(SELECTION_STORAGE_KEY, JSON.stringify(selected))
    this.selectedAccountIds.value = selected
  }
  getPolicy(
    platform: string,
    operation: AccountOperation,
    useSelection = true,
  ): AccountOperationPolicy {
    const isDouyinSearch = platform === 'douyin' && operation === 'search'
    const signedInAccounts =
      operation === 'session' || (platform === 'douyin' && operation === 'search')
        ? this.snapshot.value.accounts
            .filter(
              (a) => a.platformId === platform && a.enabled && a.authentication === 'credential',
            )
            .map((a) => a.id)
        : []
    const configuredPolicy = this.policies.get(`${platform}/${operation}`)
    const availableIds = configuredPolicy?.accountIds?.filter((id) =>
      this.snapshot.value.accounts.some(
        (account) => account.id === id && account.platformId === platform && account.enabled,
      ),
    )
    // 删除/停用最后一个参与账号后恢复默认候选范围，避免遗留策略阻挡剩余账号。
    const policy: AccountOperationPolicy = configuredPolicy
      ? {
          ...configuredPolicy,
          accountIds:
            configuredPolicy.accountIds?.length && !availableIds?.length
              ? signedInAccounts.length
                ? signedInAccounts
                : undefined
              : availableIds,
        }
      : {
          ...DEFAULT_ATTEMPT_POLICY,
          // Native search has a 45s deadline including browser startup and queued work.
          // Leave time for its bounded cleanup/error projection instead of cancelling at 25s.
          attemptTimeoutMs: isDouyinSearch ? 50_000 : 25_000,
          totalTimeoutMs: 60_000,
          concurrency: 2,
          selection: 'shuffle',
          // A fast guest response must not hide an existing account's login/verification state.
          accountIds: signedInAccounts.length ? signedInAccounts : undefined,
        }
    // Official-page search is deliberately serial, including previously saved parallel policies.
    const selected = useSelection ? this.selectedAccountIds.value[platform] : undefined
    const scoped = selected ? { ...policy, accountIds: [selected] } : policy
    return isDouyinSearch ? { ...scoped, mode: 'serial', concurrency: 1 } : scoped
  }
  setPolicy(
    platform: string,
    operation: AccountOperation,
    policy: AccountOperationPolicy,
    persist = true,
  ): void {
    this.catalog.savePolicy(platform, operation, policy)
    this.policies.set(`${platform}/${operation}`, this.catalog.getPolicy(platform, operation)!)
    if (persist)
      localStorage.setItem(POLICY_STORAGE_KEY, JSON.stringify(Object.fromEntries(this.policies)))
  }
  async run<T>(
    platform: string,
    operation: AccountOperation,
    execute: (
      account: NativeAccount,
      plugin: MusicSourcePlugin,
      cancellation: CancellationSignal,
    ) => Promise<T>,
    cancellation?: CancellationSignal,
    accountId?: string,
    releaseUnused?: (value: T) => void,
    trackId?: string,
  ): Promise<T> {
    const source = new CancellationSource()
    const detach = cancellation?.subscribe(() => source.cancel())
    if (cancellation?.isCancelled()) source.cancel()
    let invalidation: SourceInvalidation | undefined
    let failure: unknown
    const completed = new Set<T>()
    try {
      await this.refresh()
      if (source.signal.isCancelled()) throw new AppError('operation-cancelled')
      if (
        !this.snapshot.value.accounts.some(
          (account) => account.platformId === platform && account.enabled,
        )
      )
        throw new AppError(
          'account-unavailable',
          '该平台没有可用账号，请在账号设置中添加或启用账号后重试。',
        )
      const preferredId =
        accountId &&
        this.snapshot.value.accounts.some((account) => account.id === accountId && account.enabled)
          ? accountId
          : undefined
      const policy = preferredId
        ? { ...this.getPolicy(platform, operation), accountIds: [preferredId] }
        : this.getPolicy(platform, operation)
      const executeAccount = async (profile: { id: string }, signal: CancellationSignal) => {
        const account = this.snapshot.value.accounts.find((a) => a.id === profile.id)
        if (!account) throw new AppError('operation-cancelled')
        const release = await this.lease(
          account.id,
          { search: '搜索', import: '导入', playback: '播放', session: '检查登录' }[operation],
          trackId,
        )
        const detachInvalidation = this.subscribeSourceInvalidation((event) => {
          if (event.accountId === account.id) {
            invalidation = event
            source.cancel()
          }
        })
        try {
          if (signal.isCancelled()) throw new AppError('operation-cancelled')
          const plugin = await this.createPlugin(account, signal)
          const value = await execute(account, plugin, signal)
          if (signal.isCancelled()) {
            releaseUnused?.(value)
            throw new AppError('operation-cancelled')
          }
          if (releaseUnused) completed.add(value)
          return value
        } finally {
          detachInvalidation()
          release()
        }
      }
      if (operation === 'session') {
        // A read-only identity probe must cross content pauses, retaining one chosen account.
        const accounts = this.snapshot.value.accounts.filter(
          (account) => account.platformId === platform && account.enabled,
        )
        const candidate =
          policy.accountIds === undefined
            ? accounts[0]
            : policy.accountIds
                .map((id) => accounts.find((account) => account.id === id))
                .find((account) => account !== undefined)
        if (!candidate)
          throw new AppError('account-unavailable', '此操作没有配置可用账号，请检查账号设置。')
        const value = await executeAccount(candidate, source.signal)
        completed.delete(value)
        return value
      }
      if (!this.catalog.eligible(platform, policy).length) {
        const candidates = this.snapshot.value.accounts.filter(
          (account) =>
            account.enabled &&
            account.platformId === platform &&
            (policy.accountIds === undefined || policy.accountIds.includes(account.id)),
        )
        const challenged = candidates.find(
          (account) => getAccountState(account).verification === 'required',
        )
        if (challenged)
          throw new AccountOperationError(
            'verification-required',
            '此账号需要完成安全验证，请完成验证后重试当前请求。',
            challenged.id,
            operation,
          )
        const blocked = candidates.find(
          (account) => getAccountState(account).connection === 'unavailable',
        )
        if (blocked)
          throw new AccountOperationError(
            'network-error',
            '账号连接暂不可用，请检查连接后重试。',
            blocked.id,
            operation,
          )
        const signedOut = candidates.find(
          (account) => getAccountState(account).login === 'signed-out',
        )
        if (signedOut)
          throw new AccountOperationError(
            'not-authenticated',
            '此账号未登录，请在账号设置中登录后重试。',
            signedOut.id,
            operation,
          )
        if (candidates.length)
          throw new AppError(
            'operation-cancelled',
            '账号正在登录或状态尚未确认，请完成账号设置中的当前操作后重试。',
          )
        throw new AppError(
          'account-unavailable',
          '此操作没有配置可用账号，请在账号设置中检查账号选择。',
        )
      }
      const result = await requestWithAccountPool({
        catalog: this.catalog,
        selector: this.selector,
        platformId: platform,
        operation,
        policy,
        clock: {
          now: () => performance.now(),
          schedule: (delay, callback) => {
            const id = setTimeout(callback, delay)
            return () => clearTimeout(id)
          },
        },
        replaySafe: true,
        cancellation: source.signal,
        execute: executeAccount,
        onFailure: (error, account) => {
          failure = error
          // 原生删除可以先于快照同步；中止当前操作，不能趁这段间隔换账号重试。
          if (error instanceof AppError && error.code === 'operation-cancelled') return 'stop'
          if (
            error instanceof AppError &&
            ['not-authenticated', 'verification-required'].includes(error.code)
          ) {
            const current = this.catalog.get(account.id)
            if (current)
              this.catalog.save({
                ...current,
                status: error.code === 'not-authenticated' ? 'expired' : 'verification-required',
              })
            if (platform === 'douyin' && operation === 'search') return 'stop'
            return 'retry'
          }
          // Official-page failures require recovery in the same account, without replay.
          if (platform === 'douyin' && operation === 'search') return 'stop'
          return error instanceof AppError &&
            ['network-error', 'request-timeout'].includes(error.code)
            ? 'retry'
            : error instanceof RoutingError && ['timeout', 'cancelled'].includes(error.code)
              ? 'retry'
              : 'stop'
        },
      })
      completed.delete(result.value)
      return result.value
    } catch (error) {
      if (
        source.signal.isCancelled() ||
        (error instanceof RoutingError && error.code === 'cancelled')
      )
        throw new AppError('operation-cancelled', invalidation?.error.message)
      if (error instanceof AppError) throw error
      if (
        (error instanceof RoutingError && error.code === 'timeout') ||
        (failure instanceof RoutingError && failure.code === 'timeout')
      )
        throw new AppError('request-timeout', '账号尝试超过时间预算。')
      if (failure) throw failure
      throw new AppError('upstream-error', '账号请求未完成，请重试。', {
        cause: error,
      })
    } finally {
      if (releaseUnused) for (const value of completed) releaseUnused(value)
      detach?.()
      void this.refresh().catch(() => {})
    }
  }
  /** Native leases also cover gaps between IPC calls and buffered playback. */
  async lease(accountId: string, reason: string, trackId?: string): Promise<() => void> {
    const usageId = crypto.randomUUID()
    const generation = this.accountGenerations.get(accountId)
    await invoke('acquire_account_usage', { accountId, usageId, reason })
    if (generation !== this.accountGenerations.get(accountId)) {
      void invoke('release_account_usage', { usageId }).catch(() => {})
      throw new AppError('operation-cancelled')
    }
    let released = false
    const uses = this.uses.get(accountId) ?? new Set<{ trackId?: string; release: () => void }>()
    this.uses.set(accountId, uses)
    const entry = {
      trackId,
      release: () => {
        if (released) return
        released = true
        uses.delete(entry)
        if (!uses.size) this.uses.delete(accountId)
        void invoke('release_account_usage', { usageId }).catch(() => {})
      },
    }
    uses.add(entry)
    return entry.release
  }
  async createPlugin(
    account: NativeAccount,
    cancellation?: CancellationSignal,
  ): Promise<MusicSourcePlugin> {
    const client = createNativeHttpClient(account.id)
    const http = {
      request: async (input: Parameters<typeof client.request>[0]) => {
        // Source operations and account leases both revoke the same native request.
        const signal = new CancellationSource()
        const signals = [input.cancellation, cancellation]
        const detach = signals.map((value) => value?.subscribe(() => signal.cancel()))
        if (signals.some((value) => value?.isCancelled())) signal.cancel()
        try {
          return await client.request({ ...input, cancellation: signal.signal })
        } finally {
          for (const unsubscribe of detach) unsubscribe?.()
        }
      },
    }
    const source = BUILT_IN_SOURCE_DIRECTORY.find(
      (entry) => entry.descriptor.id === account.platformId,
    )
    if (!source) throw new AppError('unsupported-operation', '此账号的音乐源尚未提供运行端实现。')
    return source.loadPlugin({ http, accountId: account.id, cancellation })
  }
}
