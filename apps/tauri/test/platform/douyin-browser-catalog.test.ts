import type { Track } from '@any-music/core'
import { CancellationSource } from '@any-music/network-routing'
import { DouyinApi, DouyinMusicSourcePlugin } from '@any-music/plugin-source-douyin/runtime'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createDouyinBrowserCatalog } from '@/platform/douyin-browser-catalog'

const native = vi.hoisted(() => ({ invoke: vi.fn() }))
vi.mock('@tauri-apps/api/core', () => ({ invoke: native.invoke }))
beforeEach(() => {
  native.invoke.mockReset()
})

describe('account-owned Douyin catalog IPC', () => {
  it.each([
    ['verification-required', 'verification-required'],
    ['not-authenticated', 'not-authenticated'],
    ['pagination-unavailable', undefined],
  ] as const)(
    'checks an empty first page against its native browser before accepting no results: %s',
    async (reported, code) => {
      native.invoke.mockImplementation(async (command) => {
        if (command === 'report_douyin_search_failure') return reported
        if (command === 'douyin_catalog_request')
          return framedResponse([{ status_code: 0, data: [], has_more: 0 }])
      })
      const request = vi.fn()
      const listing = new DouyinMusicSourcePlugin(
        new DouyinApi(
          { request },
          vi.fn(),
          undefined,
          undefined,
          createDouyinBrowserCatalog('account-a'),
        ),
      ).search({ query: '动漫歌曲' })
      const pages = listing.pages()[Symbol.asyncIterator]()
      if (code) await expect(pages.next()).rejects.toMatchObject({ code })
      else
        await expect(pages.next()).resolves.toMatchObject({ value: { items: [], hasMore: false } })
      await pages.return?.()
      expect(native.invoke.mock.calls.map(([command]) => command)).toEqual([
        'douyin_catalog_request',
        'report_douyin_search_failure',
        'close_douyin_listing',
      ])
      const input = native.invoke.mock.calls[0]![1]
      expect(input).toMatchObject({ accountId: 'account-a', query: '动漫歌曲', offset: 0 })
      expect(native.invoke.mock.calls[1]![1]).toMatchObject({
        accountId: input.accountId,
        listingId: input.listingId,
        code: 'pagination-unavailable',
      })
      expect(request).not.toHaveBeenCalled()
    },
  )

  it('cancels an empty first-page inspection without caching its late result and allows retry', async () => {
    let inspected!: (code: string) => void
    native.invoke.mockImplementation(async (command) => {
      if (command === 'douyin_catalog_request')
        return framedResponse([{ status_code: 0, data: [], has_more: 0 }])
      if (command === 'report_douyin_search_failure')
        return new Promise<string>((resolve) => {
          inspected = resolve
        })
    })
    const stop = new CancellationSource()
    const request = vi.fn()
    const plugin = new DouyinMusicSourcePlugin(
      new DouyinApi(
        { request },
        vi.fn(),
        undefined,
        undefined,
        createDouyinBrowserCatalog('account-a', stop.signal),
      ),
    )
    const pages = plugin.search({ query: '动漫歌曲' }).pages()[Symbol.asyncIterator]()
    const pending = expect(pages.next()).rejects.toMatchObject({ code: 'operation-cancelled' })
    await vi.waitFor(() => expect(inspected).toBeTypeOf('function'))
    stop.cancel()
    inspected('pagination-unavailable')
    await pending
    const report = native.invoke.mock.calls.find(
      ([command]) => command === 'report_douyin_search_failure',
    )![1]
    expect(native.invoke).toHaveBeenCalledWith('cancel_request', { requestId: report.requestId })
    expect(native.invoke.mock.calls.at(-1)).toEqual([
      'close_douyin_listing',
      { accountId: 'account-a', listingId: report.listingId },
    ])
    native.invoke.mockImplementation(async (command) => {
      if (command === 'douyin_catalog_request')
        return framedResponse([{ status_code: 0, data: [workCard('retry')], has_more: 0 }])
    })
    const retryPlugin = new DouyinMusicSourcePlugin(
      new DouyinApi(
        { request },
        vi.fn(),
        undefined,
        undefined,
        createDouyinBrowserCatalog('account-a'),
      ),
    )
    const retry = retryPlugin.search({ query: '动漫歌曲' }).pages()[Symbol.asyncIterator]()
    await expect(retry.next()).resolves.toMatchObject({
      value: { items: [{ id: 'douyin:video:retry' }] },
    })
    await retry.return?.()
    const loads = native.invoke.mock.calls.filter(
      ([command]) => command === 'douyin_catalog_request',
    )
    expect(loads).toHaveLength(2)
    expect(loads[1]![1]).toMatchObject({ accountId: 'account-a', offset: 0 })
    expect(loads[1]![1].listingId).not.toBe(report.listingId)
    expect(request).not.toHaveBeenCalled()
  })

  it.each([
    ['verification-required', 5, 'verification-required'],
    ['not-authenticated', 5, 'not-authenticated'],
    ['pagination-unavailable', 5, 'pagination-unavailable'],
    ['pagination-unavailable', 0, undefined],
  ] as const)(
    'classifies an empty later page through the owning browser before closing it: %s/%s',
    async (reported, result_status, code) => {
      native.invoke.mockImplementation(async (command, input) => {
        if (command === 'report_douyin_search_failure') return reported
        if (command === 'douyin_catalog_request')
          return framedResponse([
            input.offset === 0
              ? { status_code: 0, data: [workCard('first')], has_more: 1, cursor: 70 }
              : { status_code: 0, result_status, data: [], has_more: 0, cursor: 80 },
          ])
      })
      const request = vi.fn()
      const plugin = new DouyinMusicSourcePlugin(
        new DouyinApi(
          { request },
          vi.fn(),
          undefined,
          undefined,
          createDouyinBrowserCatalog('account-a'),
        ),
      )
      const pages = plugin.search({ query: '音乐' }).pages()[Symbol.asyncIterator]()
      await expect(pages.next()).resolves.toMatchObject({ value: { hasMore: true } })
      if (code) await expect(pages.next()).rejects.toMatchObject({ code })
      else
        await expect(pages.next()).resolves.toMatchObject({ value: { items: [], hasMore: false } })
      await pages.return?.()
      expect(native.invoke.mock.calls.map(([command]) => command)).toEqual([
        'douyin_catalog_request',
        'douyin_catalog_request',
        'report_douyin_search_failure',
        'close_douyin_listing',
      ])
      const loads = native.invoke.mock.calls.filter(
        ([command]) => command === 'douyin_catalog_request',
      )
      expect(loads.map(([, input]) => input.offset)).toEqual([0, 70])
      expect(native.invoke.mock.calls[2]?.[1]).toMatchObject({
        accountId: 'account-a',
        listingId: loads[0]?.[1].listingId,
        code: 'pagination-unavailable',
      })
      expect(request).not.toHaveBeenCalled()
    },
  )
  it.each([
    ['https://www.douyin.com/user/self?showTab=record', 'self-history', undefined],
    ['https://www.douyin.com/user/self?showTab=like', 'self-favorites', undefined],
    [
      'https://www.douyin.com/user/self?showTab=favorite_collection',
      'self-collected-videos',
      undefined,
    ],
    ['https://www.douyin.com/collection/123/1', 'mix', '123'],
  ])('imports %s lazily through one account and cursor chain', async (url, importKind, mixId) => {
    native.invoke.mockImplementation(async (command, input) => {
      if (command !== 'douyin_catalog_request') return
      return framedResponse([
        {
          status_code: 0,
          aweme_list: [workCard(String(input.offset + 1)).aweme_info],
          has_more: input.offset === 0 ? 1 : 0,
          cursor: 18,
        },
      ])
    })
    const request = vi.fn()
    const state = vi.fn()
    const plugin = new DouyinMusicSourcePlugin(
      new DouyinApi(
        { request },
        state,
        undefined,
        undefined,
        createDouyinBrowserCatalog('account-a'),
      ),
    )
    const listing = plugin.importFromUrl({ url })
    expect(native.invoke).not.toHaveBeenCalled()
    const pages = listing.pages()[Symbol.asyncIterator]()
    expect((await pages.next()).value!.items[0]!.source.resourceId).toBe('1')
    expect(native.invoke).toHaveBeenCalledOnce()
    expect((await pages.next()).value!.items[0]!.source.resourceId).toBe('19')
    await pages.return?.()
    const calls = native.invoke.mock.calls.filter(
      ([command]) => command === 'douyin_catalog_request',
    )
    expect(calls).toHaveLength(2)
    expect(calls[0]![1]).toMatchObject({ accountId: 'account-a', importKind, offset: 0 })
    expect(calls[1]![1]).toMatchObject({
      accountId: 'account-a',
      importKind,
      offset: 18,
      listingId: calls[0]![1].listingId,
    })
    expect(calls[0]![1].mixId).toBe(mixId)
    expect(native.invoke).toHaveBeenLastCalledWith('close_douyin_listing', {
      accountId: 'account-a',
      listingId: calls[0]![1].listingId,
    })
    expect(request).not.toHaveBeenCalled()
    expect(state).not.toHaveBeenCalled()
  })

  it('expands a video into its mix through the same account without fetching per-work detail', async () => {
    native.invoke.mockImplementation(async (command, input) => {
      if (command !== 'douyin_catalog_request') return
      return framedResponse([
        input.awemeId
          ? {
              status_code: 0,
              aweme_detail: {
                ...workCard(input.awemeId).aweme_info,
                mix_info: { mix_id: '7687608991332960299' },
              },
            }
          : {
              status_code: 0,
              aweme_list: [workCard('1').aweme_info, workCard('2').aweme_info],
              has_more: 1,
              cursor: 6,
            },
      ])
    })
    const request = vi.fn()
    const plugin = new DouyinMusicSourcePlugin(
      new DouyinApi(
        { request },
        vi.fn(),
        undefined,
        undefined,
        createDouyinBrowserCatalog('account-a'),
      ),
    )
    const listing = plugin.importFromUrl({
      url: 'https://www.douyin.com/video/7667482938171202417',
    })
    expect(native.invoke).not.toHaveBeenCalled()
    const pages = listing.pages()[Symbol.asyncIterator]()
    expect(
      (await pages.next()).value!.items.map((track: Track) => track.source.resourceId),
    ).toEqual(['1', '2'])
    const calls = native.invoke.mock.calls.filter(
      ([command]) => command === 'douyin_catalog_request',
    )
    expect(calls).toHaveLength(2)
    expect(calls[0]![1]).toMatchObject({ accountId: 'account-a', awemeId: '7667482938171202417' })
    expect(calls[1]![1]).toMatchObject({
      accountId: 'account-a',
      importKind: 'mix',
      mixId: '7687608991332960299',
      offset: 0,
    })
    await pages.return?.()
    expect(native.invoke).toHaveBeenLastCalledWith('close_douyin_listing', {
      accountId: 'account-a',
      listingId: calls[1]![1].listingId,
    })
    expect(request).not.toHaveBeenCalled()
  })

  it('reads a collected mix directory and closes each mix before opening the next', async () => {
    native.invoke.mockImplementation(async (command, input) => {
      if (command !== 'douyin_catalog_request') return
      return framedResponse([
        input.importKind === 'self-collected-mixes'
          ? {
              status_code: 0,
              mix_infos: [
                { mix_id: '123', mix_name: '合集一' },
                { mix_id: '456', mix_name: '合集二' },
              ],
              has_more: 0,
            }
          : { status_code: 0, aweme_list: [workCard(input.mixId).aweme_info], has_more: 0 },
      ])
    })
    const request = vi.fn()
    const plugin = new DouyinMusicSourcePlugin(
      new DouyinApi(
        { request },
        vi.fn(),
        undefined,
        undefined,
        createDouyinBrowserCatalog('account-a'),
      ),
    )
    const listing = plugin.importFromUrl({
      url: 'https://www.douyin.com/user/self?showTab=favorite_collection&showSubTab=compilation',
    })
    const pages = listing.pages()[Symbol.asyncIterator]()
    expect((await pages.next()).value!.items[0]!.sourceTags).toContain('合集：合集一')
    expect(
      native.invoke.mock.calls.filter(([command]) => command === 'douyin_catalog_request'),
    ).toHaveLength(2)
    expect((await pages.next()).value!.items[0]!.sourceTags).toContain('合集：合集二')
    await pages.return?.()
    expect(native.invoke.mock.calls.map(([command]) => command)).toEqual([
      'douyin_catalog_request',
      'douyin_catalog_request',
      'close_douyin_listing',
      'douyin_catalog_request',
      'close_douyin_listing',
      'close_douyin_listing',
    ])
    expect(request).not.toHaveBeenCalled()
  })

  it.each([
    [{ status_code: 2198 }, 'access-denied'],
    [{ status_code: 2483 }, 'verification-required'],
    [{ status_code: 10002 }, 'not-authenticated'],
    [{ status_code: 0 }, 'invalid-response'],
  ])(
    'preserves protected-list errors and closes its target without native HTTP replay',
    async (data, code) => {
      native.invoke.mockImplementation(async (command) =>
        command === 'douyin_catalog_request' ? framedResponse([data]) : undefined,
      )
      const request = vi.fn()
      const plugin = new DouyinMusicSourcePlugin(
        new DouyinApi(
          { request },
          vi.fn(),
          undefined,
          undefined,
          createDouyinBrowserCatalog('account-a'),
        ),
      )
      const listing = plugin.importFromUrl({ url: 'https://www.douyin.com/user/self?showTab=like' })
      const pages = listing.pages()[Symbol.asyncIterator]()
      await expect(pages.next()).rejects.toMatchObject({ code })
      expect(native.invoke.mock.calls.map(([command]) => command)).toEqual([
        'douyin_catalog_request',
        'close_douyin_listing',
      ])
      expect(request).not.toHaveBeenCalled()
    },
  )

  it.each(['self-history', 'self-collected-videos'] as const)(
    'aborts a pending %s import before closing and rejects its late success',
    async (kind) => {
      let resolve!: (bytes: ArrayBuffer) => void
      native.invoke.mockImplementation((command) =>
        command === 'douyin_catalog_request'
          ? new Promise<ArrayBuffer>((yes) => {
              resolve = yes
            })
          : Promise.resolve(),
      )
      const reader = createDouyinBrowserCatalog('account-a').openImport!({
        kind,
      })
      const pending = reader.load(0)
      const assertion = expect(pending).rejects.toMatchObject({ code: 'operation-cancelled' })
      const requestId = native.invoke.mock.calls[0]![1].requestId
      await reader.close()
      resolve(framedResponse([{ status_code: 0, aweme_list: [], has_more: 0 }]))
      await assertion
      expect(native.invoke.mock.calls.map(([command]) => command)).toEqual([
        'douyin_catalog_request',
        'cancel_request',
        'close_douyin_listing',
      ])
      expect(native.invoke.mock.calls[1]![1]).toEqual({ requestId })
      await expect(reader.load(18)).rejects.toMatchObject({ code: 'operation-cancelled' })
      expect(native.invoke).toHaveBeenCalledTimes(3)
    },
  )

  it('rejects a concatenated import link before any native request', () => {
    const plugin = new DouyinMusicSourcePlugin(
      new DouyinApi(
        { request: vi.fn() },
        vi.fn(),
        undefined,
        undefined,
        createDouyinBrowserCatalog('account-a'),
      ),
    )
    expect(() =>
      plugin.importFromUrl({
        url: 'https://www.douyin.com/user/self?showTab=fhttps://www.douyin.com/user/self?showSubTab=video&showTab=likeavorite_collection',
      }),
    ).toThrow(expect.objectContaining({ code: 'invalid-input' }))
    expect(native.invoke).not.toHaveBeenCalled()
  })
  it('re-resolves a search result through the same account browser on every playback', async () => {
    let details = 0
    native.invoke.mockImplementation(async (command: string, input) => {
      if (command === 'close_douyin_listing') return
      if (input.awemeId) {
        details += 1
        return framedResponse([
          {
            status_code: 0,
            aweme_detail: {
              aweme_id: '123',
              video: { play_addr: { url_list: [`https://media.example/fresh-${details}.mp4`] } },
            },
          },
        ])
      }
      return framedResponse([{ status_code: 0, data: [workCard('123')], has_more: 0 }])
    })
    const request = vi.fn()
    const state = vi.fn()
    const plugin = new DouyinMusicSourcePlugin(
      new DouyinApi(
        { request },
        state,
        undefined,
        undefined,
        createDouyinBrowserCatalog('account-a'),
      ),
    )
    const pages = plugin.search({ query: '音乐' }).pages()[Symbol.asyncIterator]()
    const track = (await pages.next()).value!.items[0]!
    await pages.return?.()
    await expect(plugin.resolveMedia(track)).resolves.toMatchObject({
      url: 'https://media.example/fresh-1.mp4',
    })
    await expect(plugin.resolveMedia(track)).resolves.toMatchObject({
      url: 'https://media.example/fresh-2.mp4',
    })
    const calls = native.invoke.mock.calls.filter(
      ([command]) => command === 'douyin_catalog_request',
    )
    expect(calls).toHaveLength(3)
    for (const [, input] of calls) expect(input.accountId).toBe('account-a')
    for (const [, input] of calls.slice(1)) {
      expect(input).toMatchObject({ awemeId: '123', pageKind: 'video' })
      expect(input.listingId).toBeUndefined()
      expect(input.query).toBeUndefined()
    }
    expect(calls[1]![1].requestId).not.toBe(calls[2]![1].requestId)
    expect(JSON.stringify(track)).not.toContain('media.example')
    expect(request).not.toHaveBeenCalled()
    expect(state).not.toHaveBeenCalled()
  })
  it.each([
    [{ status_code: 2198 }, 'access-denied'],
    [{ status_code: 2483 }, 'verification-required'],
    [{ status_code: 10002 }, 'not-authenticated'],
  ])('preserves browser detail rejection without replaying native HTTP', async (document, code) => {
    native.invoke.mockResolvedValue(framedResponse([document]))
    const request = vi.fn()
    const plugin = new DouyinMusicSourcePlugin(
      new DouyinApi(
        { request },
        vi.fn(),
        undefined,
        undefined,
        createDouyinBrowserCatalog('account-a'),
      ),
    )
    const track = { source: { pluginId: 'douyin', resourceId: '123', mediaKind: 'video' } } as Track
    await expect(plugin.resolveMedia(track)).rejects.toMatchObject({ code })
    expect(native.invoke).toHaveBeenCalledOnce()
    expect(request).not.toHaveBeenCalled()
  })
  it('cancels detail IPC and permits a new request after rejecting its late success', async () => {
    let resolve!: (bytes: ArrayBuffer) => void
    native.invoke.mockImplementation((command: string) =>
      command === 'douyin_catalog_request'
        ? new Promise<ArrayBuffer>((yes) => {
            resolve = yes
          })
        : Promise.resolve(),
    )
    const cancellation = new CancellationSource()
    const pending = createDouyinBrowserCatalog('account-a', cancellation.signal).getAwemeDetail!(
      '123',
      'note',
    )
    const assertion = expect(pending).rejects.toMatchObject({ code: 'operation-cancelled' })
    const requestId = native.invoke.mock.calls[0]![1].requestId
    cancellation.cancel()
    resolve(framedResponse([{ status_code: 0 }]))
    await assertion
    expect(native.invoke).toHaveBeenCalledWith('cancel_request', { requestId })
    native.invoke.mockResolvedValue(framedResponse([{ status_code: 0 }]))
    await expect(
      createDouyinBrowserCatalog('account-a').getAwemeDetail!('123', 'note'),
    ).resolves.toMatchObject({ status: 200 })
    expect(native.invoke.mock.calls.at(-1)![1]).toMatchObject({
      accountId: 'account-a',
      awemeId: '123',
      pageKind: 'note',
    })
    expect(native.invoke.mock.calls.at(-1)![1].requestId).not.toBe(requestId)
  })
  it.each([
    [{ status_code: 8 }, 'not-authenticated', 'verification-required'],
    [{ status_code: 10002 }, 'not-authenticated', 'not-authenticated'],
    [{ status_code: 2483 }, 'verification-required', 'verification-required'],
    [
      { status_code: 0, search_nil_info: { search_nil_type: 'verify_check' } },
      'verification-required',
      'verification-required',
    ],
  ])(
    'reconciles a parsed search rejection with the same native listing before closing it',
    async (document, reported, finalCode) => {
      native.invoke.mockImplementation(async (command: string) => {
        if (command === 'douyin_catalog_request') return framedResponse([document])
        if (command === 'report_douyin_search_failure') return finalCode
      })
      const api = new DouyinApi(
        { request: vi.fn() },
        vi.fn(),
        undefined,
        undefined,
        createDouyinBrowserCatalog('account-a'),
      )
      const listing = new DouyinMusicSourcePlugin(api).search({ query: '音乐' })
      const pages = listing.pages()[Symbol.asyncIterator]()
      await expect(pages.next()).rejects.toMatchObject({ code: finalCode })
      expect(native.invoke.mock.calls.map(([command]) => command)).toEqual([
        'douyin_catalog_request',
        'report_douyin_search_failure',
        'close_douyin_listing',
      ])
      const first = native.invoke.mock.calls[0]?.[1]
      expect(native.invoke.mock.calls[1]?.[1]).toMatchObject({
        accountId: first.accountId,
        listingId: first.listingId,
        code: reported,
      })
    },
  )
  it('cancels pending failure reporting and does not publish a late account status', async () => {
    let resolve!: (code: string) => void
    native.invoke.mockImplementation((command: string) =>
      command === 'report_douyin_search_failure'
        ? new Promise<string>((yes) => {
            resolve = yes
          })
        : Promise.resolve(),
    )
    const listing = createDouyinBrowserCatalog('account-a').openSearch('音乐')
    const pending = listing.reportFailure!('verification-required')
    const assertion = expect(pending).rejects.toMatchObject({ code: 'operation-cancelled' })
    await listing.close()
    const requestId = native.invoke.mock.calls[0]?.[1].requestId
    expect(native.invoke).toHaveBeenCalledWith('cancel_request', { requestId })
    resolve('verification-required')
    await assertion
  })
  it.each([
    {
      name: 'missing list',
      documents: [{ status_code: 0 }, { ack: -1 }],
      code: 'invalid-response',
    },
    { name: 'empty list', documents: [{ status_code: 0, data: [], has_more: 0 }], code: undefined },
    {
      name: 'verification',
      documents: [{ status_code: 0, search_nil_info: { search_nil_type: 'verify_check' } }],
      code: 'verification-required',
    },
  ])(
    'distinguishes $name after a native search request and permits a fresh first-page retry',
    async ({ documents, code }) => {
      native.invoke.mockImplementation((command: string, args) =>
        Promise.resolve(
          command === 'report_douyin_search_failure'
            ? args.code
            : command === 'close_douyin_listing'
              ? undefined
              : framedResponse(documents),
        ),
      )
      const request = vi.fn()
      const api = new DouyinApi(
        { request },
        vi.fn(),
        undefined,
        undefined,
        createDouyinBrowserCatalog('account-a'),
      )
      const listing = new DouyinMusicSourcePlugin(api).search({ query: '周杰伦' })
      const first = listing.pages()[Symbol.asyncIterator]()
      if (code) await expect(first.next()).rejects.toMatchObject({ code })
      else
        await expect(first.next()).resolves.toMatchObject({ value: { items: [], hasMore: false } })
      await first.return?.()
      expect(native.invoke.mock.calls.map(([command]) => command)).toEqual([
        'douyin_catalog_request',
        ...(code === 'verification-required' || !code ? ['report_douyin_search_failure'] : []),
        'close_douyin_listing',
      ])

      native.invoke.mockImplementation((command: string) =>
        Promise.resolve(
          command === 'close_douyin_listing'
            ? undefined
            : framedResponse([{ status_code: 0, data: [workCard('retry')], has_more: 0 }]),
        ),
      )
      const retry = listing.pages()[Symbol.asyncIterator]()
      await expect(retry.next()).resolves.toMatchObject({
        value: { items: [{ id: 'douyin:video:retry' }], hasMore: false },
      })
      await retry.return?.()
      const calls = native.invoke.mock.calls.filter(
        ([command]) => command === 'douyin_catalog_request',
      )
      expect(calls).toHaveLength(2)
      for (const [, input] of calls)
        expect(input).toMatchObject({ accountId: 'account-a', query: '周杰伦', offset: 0 })
      expect(calls[0]?.[1].listingId).not.toBe(calls[1]?.[1].listingId)
      expect(request).not.toHaveBeenCalled()
    },
  )

  it('preserves a native failure to submit search instead of displaying an empty list', async () => {
    native.invoke.mockImplementation((command: string) =>
      command === 'douyin_catalog_request'
        ? Promise.reject('request-timeout:官方搜索页面加载超时（搜索尚未成功提交），请稍后重试。')
        : Promise.resolve(),
    )
    const api = new DouyinApi(
      { request: vi.fn() },
      vi.fn(),
      undefined,
      undefined,
      createDouyinBrowserCatalog('account-a'),
    )
    const listing = new DouyinMusicSourcePlugin(api).search({ query: '周杰伦' })
    await expect(listing.pages()[Symbol.asyncIterator]().next()).rejects.toMatchObject({
      code: 'request-timeout',
      message: expect.stringContaining('搜索尚未成功提交'),
    })
    expect(native.invoke.mock.calls.map(([command]) => command)).toEqual([
      'douyin_catalog_request',
      'close_douyin_listing',
    ])
  })

  it('keeps the next native cursor available after a one-work frame and a metadata-only trailer', async () => {
    native.invoke.mockImplementation((command: string, args: { offset: number }) => {
      if (command === 'close_douyin_listing') return Promise.resolve()
      expect(command).toBe('douyin_catalog_request')
      return Promise.resolve(
        args.offset === 0
          ? framedResponse([
              { status_code: 0, data: [workCard('first')], cursor: 10, has_more: 1 },
              { status_code: 0, time_cost: {} },
              { ack: -1 },
            ])
          : framedResponse([
              { status_code: 0, data: [workCard('second')], cursor: 20, has_more: 0 },
            ]),
      )
    })
    const request = vi.fn()
    const requestState = vi.fn()
    const api = new DouyinApi(
      { request },
      requestState,
      undefined,
      undefined,
      createDouyinBrowserCatalog('account-a'),
    )
    const listing = new DouyinMusicSourcePlugin(api).search({ query: '华语' })
    const pages = listing.pages()[Symbol.asyncIterator]()

    expect(native.invoke).not.toHaveBeenCalled()
    await expect(pages.next()).resolves.toMatchObject({
      value: { items: [{ id: 'douyin:video:first' }], hasMore: true },
    })
    expect(native.invoke).toHaveBeenCalledOnce()
    await expect(pages.next()).resolves.toMatchObject({
      value: { items: [{ id: 'douyin:video:second' }], hasMore: false },
    })
    const calls = native.invoke.mock.calls
    expect(calls[0]?.[1]).toMatchObject({ accountId: 'account-a', query: '华语', offset: 0 })
    expect(calls[1]?.[1]).toMatchObject({ listingId: calls[0]?.[1].listingId, offset: 10 })
    await expect(pages.next()).resolves.toMatchObject({ done: true })
    expect(calls.map(([command]) => command)).toEqual([
      'douyin_catalog_request',
      'douyin_catalog_request',
      'close_douyin_listing',
    ])
    expect(request).not.toHaveBeenCalled()
    expect(requestState).not.toHaveBeenCalled()
  })

  it('isolates identical searches by account and iterator and closes each target once', async () => {
    native.invoke.mockResolvedValue(Uint8Array.from([0, 200, 123, 125]).buffer)
    const first = createDouyinBrowserCatalog('account-a').openSearch('音乐')
    const second = createDouyinBrowserCatalog('account-a').openSearch('音乐')
    const otherAccount = createDouyinBrowserCatalog('account-b').openSearch('音乐')
    await first.load(0)
    await first.load(10)
    await second.load(0)
    await otherAccount.load(0)
    const calls = native.invoke.mock.calls.map(([, args]) => args)
    expect(calls[0]).toMatchObject({ accountId: 'account-a', query: '音乐', offset: 0 })
    expect(calls[1]?.listingId).toBe(calls[0]?.listingId)
    expect(new Set([calls[0]?.listingId, calls[2]?.listingId, calls[3]?.listingId]).size).toBe(3)
    expect(calls[3]?.accountId).toBe('account-b')
    await first.close()
    await first.close()
    expect(
      native.invoke.mock.calls.filter(([command]) => command === 'close_douyin_listing'),
    ).toHaveLength(1)
    await expect(first.load(20)).rejects.toMatchObject({ code: 'operation-cancelled' })
  })
  it('cancels the native request and discards its late response', async () => {
    let resolve!: (value: unknown) => void
    native.invoke.mockImplementation((command: string) =>
      command === 'douyin_catalog_request'
        ? new Promise((yes) => {
            resolve = yes
          })
        : Promise.resolve(),
    )
    const cancellation = new CancellationSource()
    const source = createDouyinBrowserCatalog('account-a', cancellation.signal)
    const result = source.getSelfProfile()
    cancellation.cancel()
    resolve(Uint8Array.from([0, 200, 123, 125]).buffer)
    await expect(result).rejects.toMatchObject({ code: 'operation-cancelled' })
    const requestId = native.invoke.mock.calls[0]?.[1].requestId
    expect(native.invoke).toHaveBeenCalledWith('cancel_request', { requestId })
    await expect(source.getSelfProfile()).rejects.toMatchObject({ code: 'operation-cancelled' })
    expect(
      native.invoke.mock.calls.filter(([command]) => command === 'douyin_catalog_request'),
    ).toHaveLength(1)
  })

  it('closing a listing aborts its pending native load and rejects a late success', async () => {
    let resolve!: (value: unknown) => void
    native.invoke.mockImplementation((command: string) =>
      command === 'douyin_catalog_request'
        ? new Promise((yes) => {
            resolve = yes
          })
        : Promise.resolve(),
    )
    const listing = createDouyinBrowserCatalog('account-a').openSearch('音乐')
    const pending = listing.load(0)
    const rejected = expect(pending).rejects.toMatchObject({ code: 'operation-cancelled' })
    await listing.close()
    expect(native.invoke.mock.calls.map(([command]) => command)).toEqual([
      'douyin_catalog_request',
      'cancel_request',
      'close_douyin_listing',
    ])
    expect(native.invoke.mock.calls[1]?.[1].requestId).toBe(
      native.invoke.mock.calls[0]?.[1].requestId,
    )
    resolve(Uint8Array.from([0, 200, 123, 125]).buffer)
    await rejected
    await listing.close()
    await expect(listing.load(10)).rejects.toMatchObject({ code: 'operation-cancelled' })
    expect(native.invoke).toHaveBeenCalledTimes(3)
  })

  it('preserves raw response bytes without copying the IPC buffer', async () => {
    const bytes = Uint8Array.from([1, 173, 123, 125])
    native.invoke.mockResolvedValue(bytes.buffer)
    const listing = createDouyinBrowserCatalog('account-a').openSearch('音乐')
    const response = await listing.load(0)
    expect(response.status).toBe(429)
    expect(response.body).toEqual(Uint8Array.from([123, 125]))
    if (typeof response.body === 'string') throw new Error('Expected binary native response')
    expect(response.body.buffer).toBe(bytes.buffer)
  })

  it.each([[], [0], [0, 0], [2, 88]])(
    'rejects truncated or invalid native status packets %j',
    async (...values) => {
      native.invoke.mockResolvedValue(Uint8Array.from(values).buffer)
      await expect(createDouyinBrowserCatalog('account-a').getSelfProfile()).rejects.toMatchObject({
        code: 'invalid-response',
      })
    },
  )
})

function framedResponse(documents: object[]) {
  const body = documents
    .map((document) => {
      const json = JSON.stringify(document)
      return `${new TextEncoder().encode(json).length.toString(16)}\r\n${json}\r\n`
    })
    .join('')
  const payload = new TextEncoder().encode(`${body}0\r\n\r\n`)
  const bytes = new Uint8Array(payload.length + 2)
  bytes.set([0, 200])
  bytes.set(payload, 2)
  return bytes.buffer
}

function workCard(id: string) {
  return { type: 1, doc_type: 153, aweme_info: { aweme_id: id, video: { duration: 1_000 } } }
}
