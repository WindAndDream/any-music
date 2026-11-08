import { createAppErrorState, formatAppErrorMessage, toAppErrorState } from '@any-music/core'
import type {
  AppErrorCode,
  AppErrorState,
  MusicSourcePlugin,
  Track,
  TrackListing,
  TrackListingContinuation,
  TrackPage,
} from '@any-music/core'
import { computed, readonly, shallowRef, toValue, triggerRef } from 'vue'
import type { MaybeRefOrGetter } from 'vue'

import type { CatalogResultSnapshot } from './catalog-result-snapshot'

/** 所有音乐源的搜索与 URL 导入共享惰性分页管线，切换来源时旧迭代器立即失效。 */
export function useTrackCatalog(pluginSource: MaybeRefOrGetter<MusicSourcePlugin>) {
  const tracks = shallowRef<readonly Track[]>([])
  const title = shallowRef('尚未加载音乐')
  const sourceUrl = shallowRef<string>()
  const total = shallowRef<number>()
  const hasMore = shallowRef(false)
  const isLoading = shallowRef(false)
  const loadedPageCount = shallowRef(0)
  const continuation = shallowRef<TrackListingContinuation>()
  const error = shallowRef<AppErrorState>()
  const errorMessage = computed(() => (error.value ? formatAppErrorMessage(error.value) : ''))
  const errorCode = computed<AppErrorCode | undefined>(() => error.value?.code)
  // Recovery errors belong to the action, not to the original request's authentication state.
  const verificationError = shallowRef<AppErrorState>()
  const verificationErrorMessage = computed(() =>
    verificationError.value ? formatAppErrorMessage(verificationError.value) : '',
  )
  const verificationPhase = shallowRef<
    | 'idle'
    | 'opening'
    | 'waiting'
    | 'confirming'
    | 'restoring'
    | 'failed'
    | 'cancelled'
    | 'complete'
  >('idle')
  const failureOperation = shallowRef<'search' | 'import' | 'pagination' | 'restore'>('search')
  const acceptsCredentialRecovery = shallowRef(false)
  const originAccount = shallowRef<CatalogResultSnapshot['account']>()
  const activeListing = shallowRef<TrackListing>()
  const account = computed(() => activeListing.value?.account)
  const hasAccountIdentity = computed(() =>
    Boolean(activeListing.value && 'account' in activeListing.value),
  )
  const requiresVerification = shallowRef(false)
  const canVerify = computed(
    () => requiresVerification.value && Boolean(activeListing.value?.verify),
  )
  const isVerifying = computed(() =>
    ['opening', 'waiting', 'confirming', 'restoring'].includes(verificationPhase.value),
  )
  let verification: AbortController | undefined

  let iterator: AsyncIterator<TrackPage> | undefined
  let pendingPage: Promise<IteratorResult<TrackPage>> | undefined
  let isPaused = false
  let needsReload = false
  let listingController: AbortController | undefined
  let generation = 0
  const removedTrackIds = new Set<string>()

  async function search(query: string) {
    return begin(() => toValue(pluginSource).search({ query }), 'search')
  }

  async function importUrl(url: string) {
    return begin(() => toValue(pluginSource).importFromUrl({ url }), 'import')
  }

  async function begin(createListing: () => TrackListing, operation: 'search' | 'import') {
    failureOperation.value = operation
    try {
      await start(createListing())
    } catch (cause) {
      setError(cause)
    }
  }

  async function start(listing: TrackListing, operation = failureOperation.value) {
    restoredListing = undefined
    cancelVerification()
    failureOperation.value = operation
    if (activeListing.value !== listing) acceptsCredentialRecovery.value = false
    verificationPhase.value = 'idle'
    verificationError.value = undefined
    activeListing.value = listing
    originAccount.value = undefined
    closeIterator()
    generation += 1
    isPaused = false
    needsReload = false
    // 新查询拥有独立世代；旧请求的 finally 不会再修改本世代的 loading。
    isLoading.value = false
    tracks.value = []
    removedTrackIds.clear()
    title.value = listing.title
    sourceUrl.value = listing.sourceUrl
    total.value = listing.estimatedTotal
    hasMore.value = true
    loadedPageCount.value = 0
    continuation.value = undefined
    error.value = undefined
    requiresVerification.value = false
    openPages(listing)
    const activeGeneration = generation
    await loadNext(activeGeneration)
    // 惰性音乐源到首次 next() 才知道搜索落地页；失败页也需把这个恢复入口带到 UI。
    if (activeGeneration === generation) sourceUrl.value = listing.sourceUrl
    if (activeGeneration === generation) acceptsCredentialRecovery.value = false
  }

  function openPages(listing: TrackListing, position?: TrackListingContinuation): void {
    listingController = new AbortController()
    const signal = listingController.signal
    const pages = listing.pages({
      ...(position ? { continuation: position, startPage: position.nextPage } : {}),
      cancellation: {
        isCancelled: () => signal.aborted,
        subscribe(listener) {
          signal.addEventListener('abort', listener, { once: true })
          return () => signal.removeEventListener('abort', listener)
        },
      },
    })
    iterator = pages[Symbol.asyncIterator]()
  }

  /** Restore metadata without constructing a source listing or consuming pages. */
  function restore(snapshot: CatalogResultSnapshot, createListing: () => TrackListing): void {
    reset()
    originAccount.value = snapshot.account
    tracks.value = snapshot.tracks
    loadedPageCount.value = snapshot.loadedPageCount
    total.value = snapshot.total
    sourceUrl.value = snapshot.sourceUrl
    hasMore.value = snapshot.hasMore
    continuation.value = snapshot.continuation
    error.value = snapshot.error
    requiresVerification.value = snapshot.error?.code === 'verification-required'
    failureOperation.value = 'restore'
    if (snapshot.hasMore && !snapshot.continuation && !snapshot.error) {
      error.value = createAppErrorState(
        'pagination-unavailable',
        '已保留上次结果。此来源不支持跨重启续载，请手动刷新列表获取最新内容。',
      )
      hasMore.value = false
    }
    restoredListing = createListing
  }

  function prepareVerification(): void {
    if (requiresVerification.value && !activeListing.value && restoredListing) {
      // Recreate only the lightweight recovery closure. No iterator, account
      // lease or source request starts when the user opens error details.
      try {
        activeListing.value = restoredListing()
      } catch (cause) {
        setError(cause)
      }
    }
  }

  let restoredListing: (() => TrackListing) | undefined

  function reset(nextTitle = '尚未加载音乐') {
    restoredListing = undefined
    cancelVerification()
    acceptsCredentialRecovery.value = false
    verificationPhase.value = 'idle'
    verificationError.value = undefined
    activeListing.value = undefined
    originAccount.value = undefined
    closeIterator()
    generation += 1
    isPaused = false
    needsReload = false
    tracks.value = []
    removedTrackIds.clear()
    title.value = nextTitle
    sourceUrl.value = undefined
    total.value = undefined
    hasMore.value = false
    isLoading.value = false
    loadedPageCount.value = 0
    continuation.value = undefined
    error.value = undefined
    requiresVerification.value = false
  }

  async function loadNext(expectedGeneration = generation) {
    if (needsReload && !isPaused && activeListing.value) return reload()
    if (
      !isPaused &&
      !isLoading.value &&
      hasMore.value &&
      !error.value &&
      restoredListing &&
      continuation.value
    ) {
      try {
        const listing = restoredListing()
        activeListing.value = listing
        openPages(listing, continuation.value)
        restoredListing = undefined
      } catch (cause) {
        setError(cause)
        return
      }
    }
    if (isPaused || !iterator || isLoading.value || !hasMore.value) return
    isLoading.value = true
    if (loadedPageCount.value > 0) failureOperation.value = 'pagination'
    error.value = undefined

    try {
      // 已发出的分页只能由来源完成；停用期间保留它，重新启用时消费同一页，避免丢失游标。
      pendingPage ??= iterator.next()
      const result = await pendingPage
      if (expectedGeneration !== generation) return
      pendingPage = undefined
      if (result.done) {
        hasMore.value = false
        return
      }

      const page = result.value
      const identity = activeListing.value?.account
      if (!originAccount.value && identity?.id) {
        originAccount.value = {
          id: identity.id,
          name: identity.name,
          customName: identity.customName,
        }
      }
      const knownIds = new Set(tracks.value.map(({ id }) => id))
      tracks.value = [
        ...tracks.value,
        ...page.items.filter((track) => {
          if (removedTrackIds.has(track.id) || knownIds.has(track.id)) return false
          knownIds.add(track.id)
          return true
        }),
      ]
      total.value = page.total
      hasMore.value = page.hasMore
      continuation.value = page.continuation
      loadedPageCount.value = Math.max(loadedPageCount.value, page.pageNumber)
    } catch (cause) {
      if (expectedGeneration !== generation) return
      pendingPage = undefined
      setError(cause)
    } finally {
      if (expectedGeneration === generation) {
        isLoading.value = false
        // 运行端首个 next() 后才确定账号，重新读取 listing 上的公开投影。
        triggerRef(activeListing)
      }
    }
  }

  /** 停用只停止消费分页，保留歌曲与游标；晚到的结果/错误不会进入当前视图。 */
  function pause(): void {
    cancelVerification()
    acceptsCredentialRecovery.value = false
    if (isPaused) return
    isPaused = true
    generation += 1
    isLoading.value = false
  }

  async function resume(): Promise<void> {
    if (!isPaused) return
    isPaused = false
    // 只接收停用前已经发出的请求；启用开关本身不会请求新的页面。
    if (pendingPage) await loadNext()
  }

  /** Source suspension drops the old iterator while keeping already displayed records. */
  function suspend(): void {
    pause()
    closeIterator()
  }

  function closeIterator(): void {
    listingController?.abort()
    listingController = undefined
    void iterator?.return?.().catch(() => undefined)
    iterator = undefined
    pendingPage = undefined
  }

  /** 身份失效不能继续复用旧游标；空闲列表等下一次加载，进行中的操作明确失败。 */
  function invalidate(cause: AppErrorState, reloadOnNext = false): void {
    const hadMore = hasMore.value
    cancelVerification()
    acceptsCredentialRecovery.value = false
    closeIterator()
    generation += 1
    isLoading.value = false
    needsReload = reloadOnNext
    if (reloadOnNext) {
      error.value = undefined
      hasMore.value = hadMore
    } else {
      error.value = cause
      hasMore.value = false
    }
    requiresVerification.value = false
    verificationError.value = undefined
    triggerRef(activeListing)
  }

  async function reload(): Promise<void> {
    if (isVerifying.value) return
    failureOperation.value = 'restore'
    if (activeListing.value) await start(activeListing.value)
  }

  function setError(cause: unknown) {
    error.value = toAppErrorState(cause, 'upstream-error', '加载音乐列表失败。')
    requiresVerification.value = error.value.code === 'verification-required'
    hasMore.value = false
  }

  function cancelVerification(): void {
    if (verification && acceptsCredentialRecovery.value) {
      error.value = createAppErrorState(
        'operation-cancelled',
        '验证已完成，列表加载已取消，可点击“重试”重新加载。',
      )
      requiresVerification.value = false
      failureOperation.value = 'restore'
    }
    if (verification) verificationPhase.value = 'cancelled'
    verification?.abort()
    verification = undefined
  }

  /** Recovery reuses the listing closure and therefore the identity that required verification. */
  async function verify(): Promise<void> {
    prepareVerification()
    const listing = activeListing.value
    if (!canVerify.value || !listing?.verify || isVerifying.value || isLoading.value) return
    const controller = new AbortController()
    verification = controller
    verificationError.value = undefined
    verificationPhase.value = 'opening'
    const expected = generation
    try {
      await listing.verify({
        onProgress(phase) {
          if (!controller.signal.aborted && expected === generation) {
            verificationPhase.value = phase
            if (phase === 'restoring') acceptsCredentialRecovery.value = true
          }
        },
        cancellation: {
          isCancelled: () => controller.signal.aborted,
          subscribe(listener) {
            controller.signal.addEventListener('abort', listener, { once: true })
            return () => controller.signal.removeEventListener('abort', listener)
          },
        },
      })
      if (controller.signal.aborted || expected !== generation) return
      verification = undefined
      failureOperation.value = 'restore'
      await start(listing)
      if (generation === expected + 1 && !error.value) verificationPhase.value = 'complete'
    } catch (cause) {
      if (!controller.signal.aborted && expected === generation) {
        if (acceptsCredentialRecovery.value) {
          // Security already completed. A snapshot failure needs request recovery, not another CAPTCHA.
          failureOperation.value = 'restore'
          setError(cause)
          verificationPhase.value = 'failed'
          triggerRef(activeListing)
          return
        }
        verificationError.value = toAppErrorState(
          cause,
          'upstream-error',
          '验证操作未完成，请重试。',
        )
        verificationPhase.value =
          verificationError.value.code === 'operation-cancelled' ? 'cancelled' : 'failed'
        triggerRef(activeListing)
      }
    } finally {
      if (verification === controller) verification = undefined
    }
  }

  /** 结果删除只影响当前查询运行时，并阻止后续分页把同 ID 曲目重新追加回来。 */
  function removeTracks(trackIds: readonly string[]): void {
    if (trackIds.length === 0) return
    for (const trackId of trackIds) removedTrackIds.add(trackId)
    tracks.value = tracks.value.filter((track) => !removedTrackIds.has(track.id))
  }

  return {
    tracks: readonly(tracks),
    account,
    originAccount: readonly(originAccount),
    hasAccountIdentity,
    title: readonly(title),
    sourceUrl: readonly(sourceUrl),
    total: readonly(total),
    hasMore: readonly(hasMore),
    isLoading: readonly(isLoading),
    loadedPageCount: readonly(loadedPageCount),
    continuation: readonly(continuation),
    error: readonly(error),
    errorMessage: readonly(errorMessage),
    errorCode: readonly(errorCode),
    failureOperation: readonly(failureOperation),
    verificationPhase: readonly(verificationPhase),
    verificationError: readonly(verificationError),
    verificationErrorMessage: readonly(verificationErrorMessage),
    acceptsCredentialRecovery: readonly(acceptsCredentialRecovery),
    canVerify: readonly(canVerify),
    isVerifying: readonly(isVerifying),
    verify,
    prepareVerification,
    cancelVerification,
    search,
    importUrl,
    loadNext,
    removeTracks,
    pause,
    resume,
    suspend,
    reset,
    restore,
    invalidate,
    reload,
  }
}
