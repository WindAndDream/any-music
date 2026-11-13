import type {
  MediaResolveOptions,
  MusicSourcePlugin,
  Track,
  TrackListing,
  TrackPage,
} from '@any-music/core'
import { AppError, toAppErrorState } from '@any-music/core'
import { CancellationSource } from '@any-music/network-routing'
import type { ModuleForm } from '@any-music/plugin-center'
import { createDouyinSearchPageUrl, parseDouyinImportUrl } from '@any-music/plugin-source-douyin'
import { invoke } from '@tauri-apps/api/core'

import { verifyDouyinSearch } from '../../platform/douyin-search-verification'
import { AccountOperationError } from '../accounts/account-operation-error'
import type { AccountRuntime, NativeAccount } from '../accounts/account-runtime'
import { getAccountState } from '../accounts/account-state'
import { getBuiltInSourceDirectory } from './built-in-source-directory'

/** First-page competition chooses one identity; later pages remain in that account context. */
export function createBuiltInMusicSources(
  runtime: AccountRuntime,
  form: ModuleForm,
): readonly MusicSourcePlugin[] {
  return getBuiltInSourceDirectory(form).map(({ descriptor, validateImportUrl, loginUrl }) => {
    function listing(
      operation: 'search' | 'import',
      request: { query?: string; url?: string; pageSize?: number },
    ): TrackListing {
      if (request.url) validateImportUrl(request.url)
      if (operation === 'search' && !request.query?.trim())
        throw new AppError('invalid-input', '搜索关键词不能为空。')
      const target =
        descriptor.id === 'douyin' && request.url ? parseDouyinImportUrl(request.url) : undefined
      const query = request.query?.trim() ?? (target?.kind === 'search' ? target.query : undefined)
      let failedAccountId: string | undefined
      let verifiedAccountId: string | undefined
      let boundAccount: NativeAccount | undefined
      const attemptedAccounts = new Map<string, NativeAccount>()
      const failedAccounts = new Map<unknown, NativeAccount>()
      const verificationAccounts = new Map<unknown, string>()
      const rememberVerification = (error: unknown, accountId: string) => {
        if (error instanceof AppError && error.code === 'verification-required')
          verificationAccounts.set(error, accountId)
      }
      const result: TrackListing = {
        id: crypto.randomUUID(),
        title: operation === 'search' ? `搜索：${request.query}` : '导入音乐',
        sourceUrl:
          descriptor.id === 'douyin' && query ? createDouyinSearchPageUrl(query) : request.url,
        get account() {
          if (!boundAccount) return undefined
          const current = runtime.snapshot.value.accounts.find((a) => a.id === boundAccount?.id)
          const label = runtime.getAccountLabel(boundAccount.id)
          return {
            id: boundAccount.id,
            state: current ? getAccountState(current) : undefined,
            ...(!current || !current.enabled
              ? { name: '账号已移除，加载时更新', customName: label?.name ?? boundAccount.name }
              : {
                  name:
                    runtime.sessionUserNames.value.get(boundAccount.id) ??
                    (boundAccount.authentication === 'anonymous' ? '访客' : undefined),
                  customName: label?.name ?? current.name,
                }),
          }
        },
        get verify() {
          const policy = runtime.getPolicy(descriptor.id, operation)
          const verificationAccount = runtime.snapshot.value.accounts.find((account) =>
            failedAccountId
              ? account.id === failedAccountId
              : account.platformId === descriptor.id &&
                account.enabled &&
                getAccountState(account).verification === 'required' &&
                (policy.accountIds === undefined || policy.accountIds.includes(account.id)),
          )
          if (
            descriptor.id !== 'douyin' ||
            !query ||
            verifiedAccountId ||
            !verificationAccount?.enabled
          )
            return undefined
          return async (options: Parameters<NonNullable<TrackListing['verify']>>[0]) => {
            const accountId = verificationAccount.id
            await runtime.refresh()
            if (options?.cancellation?.isCancelled()) throw new AppError('operation-cancelled')
            if (
              !runtime.snapshot.value.accounts.some(
                (account) => account.id === accountId && account.enabled,
              )
            )
              throw new AppError(
                'account-unavailable',
                '验证账号已删除或停用，请检查账号设置后重试。',
              )
            // A restored error has no live attempt. Bind its explicitly chosen
            // recovery to the policy-scoped challenged account before opening it.
            failedAccountId = accountId
            boundAccount = verificationAccount
            try {
              await verifyDouyinSearch(accountId, query, options?.cancellation, options?.onProgress)
            } catch (error) {
              await runtime.refresh().catch(() => {})
              throw error
            }
            options?.onProgress?.('restoring')
            verifiedAccountId = accountId
            await runtime.refresh()
            if (options?.cancellation?.isCancelled()) throw new AppError('operation-cancelled')
          }
        },
        async *pages(options) {
          verificationAccounts.clear()
          attemptedAccounts.clear()
          failedAccounts.clear()
          let iterator: AsyncIterator<TrackPage> | undefined
          let lease: ReturnType<AccountRuntime['catalog']['acquire']>
          let source: TrackListing | undefined
          const candidates = new Set<{
            pages: AsyncIterator<TrackPage>
            signal: CancellationSource
            release: () => void
          }>()
          let pageSignal: CancellationSource | undefined
          const detachCancellation = options?.cancellation?.subscribe(() => pageSignal?.cancel())
          try {
            const winner = await runtime.run(
              descriptor.id,
              operation,
              async (account, _, attempt) => {
                attemptedAccounts.set(account.id, account)
                const signal = new CancellationSource()
                const detach = attempt.subscribe(() => signal.cancel())
                let pages: AsyncIterator<TrackPage> | undefined
                const release = await runtime.lease(
                  account.id,
                  operation === 'search' ? '搜索' : '导入',
                )
                try {
                  const plugin = await runtime.createPlugin(account, signal.signal)
                  const candidate =
                    operation === 'search'
                      ? plugin.search({ query: request.query!, pageSize: request.pageSize })
                      : plugin.importFromUrl({ url: request.url!, pageSize: request.pageSize })
                  pages = candidate.pages(options)[Symbol.asyncIterator]()
                  candidates.add({ pages, signal, release })
                  const first = await pages.next()
                  if (attempt.isCancelled()) throw new AppError('operation-cancelled')
                  return { account, pages, first, candidate, signal }
                } catch (error) {
                  release()
                  failedAccounts.set(error, account)
                  rememberVerification(error, account.id)
                  signal.cancel()
                  await pages?.return?.()
                  throw error
                } finally {
                  detach()
                }
              },
              options?.cancellation,
              verifiedAccountId ?? boundAccount?.id,
            )
            iterator = winner.pages
            boundAccount = winner.account
            // 验证身份只约束这次恢复；之后固定到实际获胜账号，包括原账号删除后的兜底。
            verifiedAccountId = undefined
            failedAccountId = undefined
            source = winner.candidate
            pageSignal = winner.signal
            if (options?.cancellation?.isCancelled()) pageSignal.cancel()
            lease = runtime.catalog.acquire(winner.account.id)
            for (const entry of candidates)
              if (entry.pages !== iterator) {
                entry.signal.cancel()
                entry.release()
                void Promise.resolve(entry.pages.return?.()).catch(() => {})
              }
            if (!lease) throw new AppError('operation-cancelled')
            const detachLease = lease.cancellation.subscribe(() => pageSignal?.cancel())
            result.title = source.title
            result.sourceUrl = source.sourceUrl
            result.estimatedTotal = source.estimatedTotal
            try {
              if (!winner.first.done) {
                for (const track of winner.first.value.items)
                  runtime.rememberTrackAccount(track, winner.account.id)
                yield winner.first.value
              }
              // Each next reads exactly one page and retains the winning account until the consumer stops.
              while (true) {
                if (lease.cancellation.isCancelled()) throw new AppError('operation-cancelled')
                // eslint-disable-next-line no-await-in-loop
                const next = await iterator.next().catch((error: unknown) => {
                  rememberVerification(error, winner.account.id)
                  throw error
                })
                if (next.done) return
                for (const track of next.value.items)
                  runtime.rememberTrackAccount(track, winner.account.id)
                yield next.value
              }
            } finally {
              detachLease()
            }
          } catch (error) {
            verifiedAccountId = undefined
            // Later pages run outside the first-page router; publish native account facts as well.
            if (source) await runtime.refresh().catch(() => {})
            // Concurrent attempts can finish cleanup in a different order; bind the error
            // actually returned by routing, not whichever account happened to fail last.
            failedAccountId =
              error instanceof AccountOperationError && error.code === 'verification-required'
                ? error.accountId
                : verificationAccounts.get(error)
            if (failedAccountId)
              boundAccount =
                attemptedAccounts.get(failedAccountId) ??
                runtime.snapshot.value.accounts.find((account) => account.id === failedAccountId)
            else if (error instanceof AccountOperationError)
              boundAccount = runtime.snapshot.value.accounts.find(
                (account) => account.id === error.accountId,
              )
            else boundAccount ??= failedAccounts.get(error)
            throw error
          } finally {
            detachCancellation?.()
            for (const entry of candidates) entry.release()
            for (const entry of candidates) entry.signal.cancel()
            await iterator?.return?.()
            lease?.release()
          }
        },
      }
      return result
    }
    return {
      descriptor,
      validateImportUrl,
      checkAvailability: async () => ({ status: 'available' as const, checkedAtMs: Date.now() }),
      getLoginUrl: () => loginUrl,
      getSession: () =>
        runtime
          .run(descriptor.id, 'session', async (account, plugin) => {
            const session = await plugin.getSession()
            const names = new Map(runtime.sessionUserNames.value)
            if (session.status === 'signed-in') names.set(account.id, session.user.name)
            else names.delete(account.id)
            runtime.sessionUserNames.value = names
            if (session.status === 'unavailable' || session.status === 'expired')
              throw new AppError(session.error.code, session.error.message)
            if (session.status !== 'signed-in') return session
            return {
              ...session,
              user: {
                ...session.user,
                // 命名跟随公开快照更新，保持平台用户名和账号身份不变。
                get customName() {
                  return (
                    runtime.snapshot.value.accounts.find((a) => a.id === account.id)?.name ??
                    account.name
                  )
                },
              },
            }
          })
          .catch((error) => ({
            status: 'unavailable' as const,
            error: toAppErrorState(error, 'upstream-error', '登录状态检查失败。'),
          })),
      search: (request) => listing('search', request),
      importFromUrl: (request) => listing('import', request),
      resolveMedia: (track: Track, options?: MediaResolveOptions) =>
        runtime.run(
          descriptor.id,
          'playback',
          async (account, plugin, signal) => {
            const release = await runtime.lease(account.id, '播放或下载', track.id)
            const urls: string[] = []
            let source: Awaited<ReturnType<MusicSourcePlugin['resolveMedia']>> | undefined
            let released = false
            const cleanup = () => {
              if (released) return
              released = true
              source?.release?.()
              if (urls.length) void invoke('release_media', { urls }).catch(() => {})
              release()
            }
            try {
              source = await plugin.resolveMedia(track, { ...options, cancellation: signal })
              if (source.type !== 'remote-url')
                return { ...source, accountId: account.id, release: cleanup }
              const headers = source.requestHeaders ?? {}
              const registered = await Promise.allSettled(
                [source.url, ...source.backupUrls].map((url) =>
                  invoke<string>('register_media', {
                    accountId: account.id,
                    url,
                    headers,
                    cacheIdentity: { trackId: track.id, qualityId: source!.quality.id },
                  }),
                ),
              )
              for (const result of registered)
                if (result.status === 'fulfilled') urls.push(result.value)
              const failure = registered.find((result) => result.status === 'rejected')
              if (failure?.status === 'rejected') throw failure.reason
              if (signal.isCancelled()) throw new AppError('operation-cancelled')
              return {
                ...source,
                accountId: account.id,
                url: urls[0]!,
                backupUrls: urls.slice(1),
                requestHeaders: undefined,
                release: cleanup,
              }
            } catch (cause) {
              cleanup()
              throw cause
            }
          },
          options?.cancellation,
          runtime.getTrackAccountId(track),
          (source) => source.release?.(),
          track.id,
        ),
    } satisfies MusicSourcePlugin
  })
}
