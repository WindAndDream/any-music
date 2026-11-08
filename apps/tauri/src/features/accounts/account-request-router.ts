import { AccountCatalog, AccountSelector, requestWithAccountPool } from '@any-music/account-pool'
import type { AccountOperationPolicy, AccountProfile } from '@any-music/account-pool'
import { AppError } from '@any-music/core'
import {
  DEFAULT_ATTEMPT_POLICY,
  ProxyPool,
  RoutingError,
  requestWithProxyPool,
  validateProxyAssignment,
} from '@any-music/network-routing'
import type {
  ProxyAssignment,
  ProxyProfile,
  RoutingCancellation,
  RoutingClock,
} from '@any-music/network-routing'

export interface RoutedAccountContext {
  account: Readonly<AccountProfile>
  proxy: Readonly<ProxyProfile> | undefined
  cancellation: RoutingCancellation
}

export interface AccountRequestRouterOptions {
  clock: RoutingClock
  catalog: AccountCatalog
  proxies: ProxyPool
  /** Companion/runtime capabilities must be confirmed; ordinary GM cookies are not isolation. */
  capabilities: { isolatedAccounts: boolean; explicitProxy: boolean }
  /** Only the runtime can identify a proxy CONNECT/authentication/handshake failure. */
  isProxyFailure(error: unknown): boolean
  random?: () => number
}

export interface RoutedAccountRequest<Value> {
  platformId: string
  operation: string
  replaySafe: boolean
  cancellation?: RoutingCancellation
  execute(context: RoutedAccountContext): Promise<Value>
}

const DIRECT_ASSIGNMENT: Readonly<ProxyAssignment> = Object.freeze({
  proxyIds: Object.freeze([]),
  selection: 'ordered',
  onProxyFailure: 'stop-account',
})

/**
 * Formal-app composition boundary for an isolated runtime. This is deliberately not installed in
 * the existing GM source factories until the companion transport and credential vault are ready.
 */
export class AccountRequestRouter {
  private readonly options: AccountRequestRouterOptions
  private readonly selector: AccountSelector
  private readonly assignments = new Map<string, Readonly<ProxyAssignment>>()

  constructor(options: AccountRequestRouterOptions) {
    this.options = options
    this.selector = new AccountSelector(options.random)
  }

  assignProxies(accountId: string, input: ProxyAssignment): void {
    if (!this.options.catalog.get(accountId)) throw new AppError('not-found', '账号不存在。')
    const assignment = validateProxyAssignment(input)
    const profiles = new Set(this.options.proxies.list().map((profile) => profile.id))
    if (assignment.proxyIds.some((id) => !profiles.has(id)))
      throw new AppError('not-found', '代理配置不存在。')
    if (!this.assignments.has(accountId) && this.assignments.size >= 256) {
      // Prune removed identities instead of retaining an unbounded history of account IDs.
      for (const id of this.assignments.keys())
        if (!this.options.catalog.get(id)) this.assignments.delete(id)
      if (this.assignments.size >= 256)
        throw new AppError('limit-exceeded', '账号代理分配已达上限。')
    }
    this.assignments.set(accountId, Object.freeze(assignment))
  }

  removeAccount(accountId: string): void {
    this.assignments.delete(accountId)
    this.options.catalog.remove(accountId)
  }

  async request<Value>(request: RoutedAccountRequest<Value>): Promise<Value> {
    const { catalog, proxies, clock, capabilities } = this.options
    if (request.cancellation?.isCancelled()) throw new AppError('operation-cancelled')
    const policy: Readonly<AccountOperationPolicy> = catalog.getPolicy(
      request.platformId,
      request.operation,
    ) ?? { ...DEFAULT_ATTEMPT_POLICY, selection: 'shuffle' }
    if (
      !capabilities.isolatedAccounts &&
      catalog
        .eligible(request.platformId, policy)
        .some((account) => account.authentication === 'credential')
    ) {
      throw new AppError(
        'unsupported-operation',
        '当前运行端尚未提供独立账号请求，请连接本地账号服务。',
      )
    }
    let lastError: unknown
    try {
      const result = await requestWithAccountPool({
        catalog,
        selector: this.selector,
        platformId: request.platformId,
        operation: request.operation,
        policy,
        clock,
        replaySafe: request.replaySafe,
        cancellation: request.cancellation,
        execute: (account, cancellation) => {
          const assignment = this.assignments.get(account.id) ?? DIRECT_ASSIGNMENT
          if (assignment.proxyIds.length && !capabilities.explicitProxy) {
            throw new AppError(
              'unsupported-operation',
              '当前运行端不支持指定代理，请连接本地账号服务。',
            )
          }
          return requestWithProxyPool({
            pool: proxies,
            assignment,
            policy,
            clock,
            replaySafe: request.replaySafe,
            supportsExplicitProxy: capabilities.explicitProxy,
            cancellation,
            classifyFailure: (error) => (this.options.isProxyFailure(error) ? 'proxy' : 'other'),
            execute: (proxy, signal) => request.execute({ account, proxy, cancellation: signal }),
          })
        },
        onFailure: (error, account) => {
          if (error instanceof RoutingError && error.code === 'cancelled') return 'retry'
          if (error instanceof RoutingError && error.code === 'timeout') {
            // An individual deadline may fail over; the enclosing total deadline still governs all accounts.
            lastError = new AppError('request-timeout')
            return 'retry'
          }
          lastError = error
          const current = catalog.get(account.id)
          if (!current || current.credentialKey !== account.credentialKey) return 'retry'
          if (error instanceof AppError) {
            if (error.code === 'not-authenticated' || error.code === 'verification-required') {
              catalog.save({
                ...current,
                status: error.code === 'not-authenticated' ? 'expired' : 'verification-required',
              })
              return 'retry'
            }
          }
          if (this.options.isProxyFailure(error)) {
            if (this.assignments.get(account.id)?.onProxyFailure === 'stop-account')
              catalog.save({ ...current, status: 'network-blocked' })
            return 'retry'
          }
          // Proven proxy failures take precedence over the generic network AppError category.
          if (
            error instanceof AppError &&
            (error.code === 'network-error' || error.code === 'request-timeout')
          )
            return 'retry'
          return 'stop'
        },
      })
      return result.value
    } catch (error) {
      if (error instanceof RoutingError && error.code === 'cancelled')
        throw new AppError('operation-cancelled')
      if (error instanceof RoutingError && error.code === 'timeout')
        throw new AppError('request-timeout')
      if (error instanceof RoutingError && error.code === 'no-candidates')
        throw new AppError(
          'not-authenticated',
          '没有可用账号，请检查账号范围、登录状态和启用设置。',
        )
      if (lastError instanceof AppError) throw lastError
      throw new AppError('upstream-error', '账号请求未能完成，请检查账号或代理状态后重试。', {
        cause: lastError ?? error,
      })
    }
  }
}
