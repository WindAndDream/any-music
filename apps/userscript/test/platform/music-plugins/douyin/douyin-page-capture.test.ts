import { describe, expect, it, vi } from 'vitest'

import {
  DouyinFallbackProtectedPageSource,
  DouyinPageCaptureStore,
} from '@/platform/music-plugins/douyin/douyin-page-capture'

describe('Douyin protected page capture', () => {
  it('cancels a waiting local capture without opening a fallback page or retaining its timer', async () => {
    vi.useFakeTimers()
    try {
      const store = new DouyinPageCaptureStore(
        () => 'https://www.douyin.com/user/self?showSubTab=video&showTab=like',
      )
      const fallback = vi.fn()
      const source = new DouyinFallbackProtectedPageSource(store, fallback)
      const controller = new AbortController()
      const pending = source.getCapturedAwemePage('self-favorites', 0, {
        isCancelled: () => controller.signal.aborted,
        subscribe(listener) {
          controller.signal.addEventListener('abort', listener)
          return () => controller.signal.removeEventListener('abort', listener)
        },
      })
      controller.abort()
      await expect(pending).rejects.toMatchObject({ code: 'operation-cancelled' })
      expect(vi.getTimerCount()).toBe(0)
      expect(fallback).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })
  it('indexes liked-aweme responses by request cursor without retaining request security fields', async () => {
    const store = new DouyinPageCaptureStore(
      () => 'https://www.douyin.com/user/self?showSubTab=video&showTab=like',
    )
    store.capture(
      'https://www-hj.douyin.com/aweme/v1/web/aweme/favorite/?max_cursor=18&a_bogus=ephemeral',
      undefined,
      JSON.stringify({
        status_code: 0,
        aweme_list: [{ aweme_id: 'liked-1' }],
        has_more: 1,
        max_cursor: 36,
      }),
    )

    await expect(store.getCapturedAwemePage('self-favorites', 18)).resolves.toMatchObject({
      aweme_list: [{ aweme_id: 'liked-1' }],
      max_cursor: 36,
    })
  })

  it('reads the collection cursor from POST form data and ignores failed business responses', async () => {
    const store = new DouyinPageCaptureStore(
      () => 'https://www.douyin.com/user/self?showSubTab=video&showTab=favorite_collection',
    )
    const endpoint = 'https://www.douyin.com/aweme/v1/web/aweme/listcollection/'
    store.capture(
      endpoint,
      'count=18&cursor=12',
      JSON.stringify({ status_code: 2483, aweme_list: [{ aweme_id: 'blocked' }] }),
    )
    store.capture(
      endpoint,
      'count=18&cursor=12',
      JSON.stringify({
        status_code: 0,
        aweme_list: [{ aweme_id: 'collected-1' }],
        has_more: 0,
        cursor: 12,
      }),
    )

    await expect(store.getCapturedAwemePage('self-collected-videos', 12)).resolves.toMatchObject({
      aweme_list: [{ aweme_id: 'collected-1' }],
    })
  })

  it('captures recommendation responses by max cursor on the recommendation tab', async () => {
    const store = new DouyinPageCaptureStore(
      () => 'https://www.douyin.com/user/self?showTab=recommend',
    )
    store.capture(
      'https://www.douyin.com/aweme/v1/web/familiar/recommend/feed/?max_cursor=24',
      undefined,
      JSON.stringify({
        status_code: 0,
        aweme_list: [{ aweme_id: 'recommended-1' }],
        has_more: 1,
        max_cursor: 48,
      }),
    )

    await expect(store.getCapturedAwemePage('self-recommendations', 24)).resolves.toMatchObject({
      aweme_list: [{ aweme_id: 'recommended-1' }],
      max_cursor: 48,
    })
  })

  it('does not wait for a protected response when the current tab is unrelated', async () => {
    const store = new DouyinPageCaptureStore(() => 'https://example.com/')

    await expect(store.getCapturedAwemePage('self-favorites', 0)).resolves.toBeUndefined()
    expect(store.isCurrentPage('self-favorites')).toBe(false)
  })

  it('uses the fallback page only after the current-page source misses', async () => {
    const localStore = new DouyinPageCaptureStore(() => 'https://example.com/')
    const source = new DouyinFallbackProtectedPageSource(localStore, async (kind, cursor) => ({
      aweme_list: [{ aweme_id: `${kind}:${cursor}` }],
      has_more: 0,
    }))

    await expect(source.getCapturedAwemePage('self-collected-videos', 12)).resolves.toMatchObject({
      aweme_list: [{ aweme_id: 'self-collected-videos:12' }],
    })
  })
})
