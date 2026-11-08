import { AppError } from '@any-music/core'
import type { HttpClient, HttpRequest } from '@any-music/core'
import { describe, expect, it, vi } from 'vitest'

import {
  DouyinApi,
  DouyinRiskControlError,
  isDouyinHttpStatusError,
  parseDouyinJsonBody,
  isDouyinSearchVerificationComplete,
} from '../src/douyin-api'
import type { DouyinWebRequestState } from '../src/douyin-request-state'

const FIXED_REQUEST_STATE: DouyinWebRequestState = {
  userAgent:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
  browserFingerprint: '1536|742|1536|864|0|0|0|0|1920|1080|1920|1040|1536|742|24|24|Win32',
  browserLanguage: 'zh-CN',
  browserPlatform: 'Win32',
  browserName: 'Chrome',
  browserVersion: '140.0.0.0',
  browserOnline: 'true',
  cookieEnabled: 'true',
  engineName: 'Blink',
  engineVersion: '140.0.0.0',
  osName: 'Windows',
  osVersion: '10',
  cpuCoreCount: '16',
  deviceMemory: '8',
  screenWidth: '1920',
  screenHeight: '1080',
  downlink: '8.4',
  effectiveType: '4g',
  roundTripTime: '50',
  supportDash: '1',
  supportH265: '0',
  pcLibraDivert: 'Windows',
  webId: '7123456789012345678',
  uifid: 'same-site-uifid',
  verifyFp: 'verify_m1234567_01234567_0123_4123_8123_012345678901',
  msToken: 'same-site-ms-token',
}

const verificationResponse = (body: string, status = 200) => ({
  status,
  statusText: '',
  headers: '',
  body,
})

describe('watch history protocol', () => {
  it('includes credentials and carries the exact history cursor through the injected HTTP port', async () => {
    const request = vi
      .fn()
      .mockResolvedValue(
        verificationResponse(JSON.stringify({ status_code: 0, aweme_list: [], has_more: 0 })),
      )
    const api = new DouyinApi({ request }, () => FIXED_REQUEST_STATE)
    await api.getSelfHistory(1723456789123, 20)
    expect(request).toHaveBeenCalledOnce()
    const input = request.mock.calls[0]![0]
    const url = new URL(input.url)
    expect(input).toMatchObject({ method: 'GET', credentials: 'include' })
    expect(url.origin + url.pathname).toBe('https://www-hj.douyin.com/aweme/v1/web/history/read/')
    expect(url.searchParams.get('max_cursor')).toBe('1723456789123')
    expect(url.searchParams.get('count')).toBe('20')
    expect(url.searchParams.has('sec_user_id')).toBe(false)
  })
})

describe('official-page catalog injection', () => {
  it('keeps an explicit verification link distinct from HTTP/business authentication rejection', async () => {
    const api = new DouyinApi(
      { request: vi.fn() },
      () => FIXED_REQUEST_STATE,
      undefined,
      undefined,
      {
        getSelfProfile: async () =>
          verificationResponse(
            JSON.stringify({ status_code: 8, verify_url: 'https://www.douyin.com/verify' }),
            401,
          ),
        openSearch: vi.fn(),
      },
    )
    await expect(api.getSelfProfile()).rejects.toMatchObject({ code: 'verification-required' })
  })
  it('requires a successful search payload, including framed streams, before closing verification', () => {
    const response = verificationResponse
    const payload = JSON.stringify({
      status_code: 0,
      data: [{ type: 1 }],
      has_more: 1,
      result_status: 5,
    })
    expect(
      isDouyinSearchVerificationComplete(
        response(
          `${new TextEncoder().encode(payload).length.toString(16)}\r\n${payload}\r\n0\r\n\r\n`,
        ),
      ),
    ).toBe(true)
    expect(
      isDouyinSearchVerificationComplete(
        response(JSON.stringify({ status_code: 0, data: [], has_more: 0 })),
      ),
    ).toBe(true)
    for (const body of [
      '',
      '<html>验证</html>',
      '{"status_code":0}',
      '{"status_code":0,"data":[],"has_more":0,"result_status":5}',
      '{"status_code":0,"data":[],"hasMore":false,"result_status":2}',
      '{"status_code":2483,"data":[]}',
      '{"status_code":0,"data":[],"search_nil_info":{"search_nil_type":"verify_check"}}',
      '{"statusCode":0,"data":[],"searchNilInfo":{"searchNilType":"verify_check"}}',
    ])
      expect(isDouyinSearchVerificationComplete(response(body))).toBe(false)
    expect(isDouyinSearchVerificationComplete(response(payload, 403))).toBe(false)
  })
  it('parses browser response frames and never invokes native signing/HTTP for search or session', async () => {
    const request = vi.fn()
    const payload = JSON.stringify({ status_code: 0, data: [{ type: 1 }], cursor: 10, has_more: 1 })
    const bytes = new TextEncoder().encode(payload)
    const response = {
      status: 200,
      statusText: '',
      headers: '',
      body: new TextEncoder().encode(`${bytes.length.toString(16)}\r\n${payload}\r\n0\r\n\r\n`),
    }
    const load = vi.fn().mockResolvedValue(response)
    const close = vi.fn().mockResolvedValue(undefined)
    const getSelfProfile = vi.fn().mockResolvedValue({
      ...response,
      body: JSON.stringify({ status_code: 0, user: { uid: 'account-a' } }),
    })
    const state = vi.fn(() => FIXED_REQUEST_STATE)
    const api = new DouyinApi({ request }, state, undefined, undefined, {
      getSelfProfile,
      openSearch: () => ({ load, close }),
    })
    await expect(api.getSelfProfile()).resolves.toMatchObject({ user: { uid: 'account-a' } })
    const reader = api.openSearch('音乐', 10)
    await expect(reader.load(0)).resolves.toMatchObject({ data: [{ type: 1 }], cursor: 10 })
    await reader.close()
    expect(close).toHaveBeenCalledOnce()
    expect(request).not.toHaveBeenCalled()
    expect(state).not.toHaveBeenCalled()
  })
})

describe('Douyin transport failures', () => {
  it.each(['video', 'note'] as const)(
    'reads fresh browser %s detail without native HTTP or local signing',
    async (pageKind) => {
      const request = vi.fn()
      const state = vi.fn(() => FIXED_REQUEST_STATE)
      const getAwemeDetail = vi.fn().mockResolvedValue({
        status: 200,
        statusText: '',
        headers: '',
        body: `<script>self.__pace_f.push(${JSON.stringify([
          1,
          `0:${JSON.stringify({
            awemeId: '123',
            video: { playAddr: { urlList: ['https://media.example/fresh.mp4'] } },
          })}\n`,
        ])})</script>`,
      })
      const api = new DouyinApi({ request }, state, undefined, undefined, {
        getSelfProfile: vi.fn(),
        openSearch: vi.fn(),
        getAwemeDetail,
      })
      await expect(api.getAwemeDetail('123', pageKind)).resolves.toMatchObject({ awemeId: '123' })
      expect(getAwemeDetail).toHaveBeenCalledExactlyOnceWith('123', pageKind)
      expect(request).not.toHaveBeenCalled()
      expect(state).not.toHaveBeenCalled()
    },
  )
  it('rejects browser API detail for another work', async () => {
    const api = new DouyinApi({ request: vi.fn() }, vi.fn(), undefined, undefined, {
      getSelfProfile: vi.fn(),
      openSearch: vi.fn(),
      getAwemeDetail: vi.fn().mockResolvedValue({
        status: 200,
        body: '{"status_code":0,"aweme_detail":{"aweme_id":"456"}}',
      }),
    })
    await expect(api.getAwemeDetail('123')).rejects.toMatchObject({ code: 'invalid-response' })
  })
  it('keeps offline search distinct from a Douyin business failure', async () => {
    const httpClient: HttpClient = {
      request: () => Promise.reject(new AppError('network-error', '网络连接已中断。')),
    }

    await expect(
      new DouyinApi(httpClient, () => FIXED_REQUEST_STATE).searchAwemes('音乐', 0, 10),
    ).rejects.toMatchObject({ code: 'network-error' })
  })
})

describe('parseDouyinJsonBody', () => {
  it('parses ordinary API JSON', () => {
    expect(parseDouyinJsonBody('{"status_code":0,"data":[]}')).toMatchObject({
      status_code: 0,
      data: [],
    })
  })

  it('reassembles search stream frames by UTF-8 bytes', () => {
    const json = '{"status_code":0,"data":[{"desc":"古风音乐"}],"has_more":1,"cursor":18}'
    // 人为把帧切在“古”的 UTF-8 三字节中间，防止实现错误地按 JS 字符数切片。
    const bytes = new TextEncoder().encode(json)
    const chineseOffset = bytes.findIndex((byte) => byte > 127)
    const framed = encodeFrames([
      bytes.slice(0, chineseOffset + 1),
      bytes.slice(chineseOffset + 1, chineseOffset + 7),
      bytes.slice(chineseOffset + 7),
    ])
    expect(parseDouyinJsonBody(framed)).toMatchObject({
      status_code: 0,
      data: [{ desc: '古风音乐' }],
      has_more: 1,
      cursor: 18,
    })
  })

  it('merges independent search result messages and ignores ack frames', () => {
    const encoder = new TextEncoder()
    const framed = encodeFrames([
      encoder.encode(
        '{"status_code":0,"data":[{"aweme_info":{"aweme_id":"1"}}],"cursor":10,"has_more":1,"result_status":2}',
      ),
      encoder.encode('{"ack":-1}'),
      encoder.encode(
        '{"status_code":0,"data":[{"aweme_info":{"aweme_id":"2"}}],"cursor":10,"has_more":1,"result_status":5}',
      ),
    ])

    expect(parseDouyinJsonBody(framed)).toMatchObject({
      status_code: 0,
      data: [{ aweme_info: { aweme_id: '1' } }, { aweme_info: { aweme_id: '2' } }],
      cursor: 10,
      has_more: 1,
      result_status: 5,
    })
  })

  it('does not fabricate an empty result list from metadata and acknowledgement frames', () => {
    const frames = [
      { status_code: 0, time_cost: {} },
      { status_code: 0, has_more: 0 },
      { ack: -1 },
    ].map((document) => new TextEncoder().encode(JSON.stringify(document)))
    expect(parseDouyinJsonBody(encodeFrames(frames))).not.toHaveProperty('data')
  })

  it('retains pagination from earlier search frames when later messages omit it', () => {
    const framed = encodeFrames(
      [
        { status_code: 0, data: [], cursor: 10, has_more: 1, result_status: 2 },
        { status_code: 0, data: [{ aweme_info: { aweme_id: '1' } }], result_status: 5 },
        { status_code: 0, time_cost: {} },
        { ack: -1 },
      ].map((document) => new TextEncoder().encode(JSON.stringify(document))),
    )

    expect(parseDouyinJsonBody(framed)).toMatchObject({
      status_code: 0,
      data: [{ aweme_info: { aweme_id: '1' } }],
      cursor: 10,
      has_more: 1,
      result_status: 5,
    })
  })

  it('honors an explicit final pagination value instead of retaining an earlier has_more', () => {
    const framed = encodeFrames(
      [
        { status_code: 0, data: [{ aweme_info: { aweme_id: '1' } }], cursor: 10, has_more: 1 },
        { status_code: 0, data: [], cursor: 20, has_more: 0 },
        { status_code: 0, time_cost: {} },
      ].map((document) => new TextEncoder().encode(JSON.stringify(document))),
    )

    expect(parseDouyinJsonBody(framed)).toMatchObject({
      data: [{ aweme_info: { aweme_id: '1' } }],
      cursor: 20,
      has_more: 0,
    })
  })

  it('uses the search-specific sorted parameter and security envelope', async () => {
    const requests: HttpRequest[] = []
    const client: HttpClient = {
      async request(request) {
        requests.push(request)
        return {
          status: 200,
          statusText: 'OK',
          headers: 'content-type: application/json',
          body: new TextEncoder().encode('{"status_code":0,"data":[],"has_more":0}'),
        }
      },
    }

    await new DouyinApi(client, () => FIXED_REQUEST_STATE).searchAwemes('音乐', 0, 10)

    const searchUrl = new URL(requests[0]?.url)
    // 喜欢与收藏使用独立的受保护接口；搜索必须始终保留网页搜索流契约。
    expect(searchUrl.origin).toBe('https://www.douyin.com')
    expect(searchUrl.pathname).toBe('/aweme/v1/web/general/search/stream/')
    const params = searchUrl.searchParams
    expect([...params.keys()]).toEqual([
      'aid',
      'browser_language',
      'browser_name',
      'browser_online',
      'browser_platform',
      'browser_version',
      'channel',
      'cookie_enabled',
      'count',
      'cpu_core_num',
      'device_memory',
      'device_platform',
      'disable_rs',
      'downlink',
      'effective_type',
      'enable_history',
      'engine_name',
      'engine_version',
      'from_group_id',
      'is_filter_search',
      'keyword',
      'list_type',
      'need_filter_settings',
      'offset',
      'os_name',
      'os_version',
      'pc_client_type',
      'pc_libra_divert',
      'pc_search_top_1_params',
      'platform',
      'query_correct_type',
      'round_trip_time',
      'screen_height',
      'screen_width',
      'search_channel',
      'search_source',
      'support_dash',
      'support_h265',
      'uifid',
      'update_version_code',
      'version_code',
      'version_name',
      'webid',
      'msToken',
      'a_bogus',
      'verifyFp',
      'fp',
    ])
    expect(Object.fromEntries(params)).toMatchObject({
      disable_rs: '0',
      pc_search_top_1_params: '{"enable_ai_search_top_1":1}',
      update_version_code: '0',
      version_code: '190600',
      version_name: '19.6.0',
    })
    expect(params.has('publish_video_strategy_type')).toBe(false)
    expect(params.has('timestamp')).toBe(false)
    expect(params.has('x-secsdk-web-signature')).toBe(false)
  })

  it('prefers the isolated page BDMS signature while keeping GM as the transport', async () => {
    const requests: HttpRequest[] = []
    const client: HttpClient = {
      async request(request) {
        requests.push(request)
        return {
          status: 200,
          statusText: 'OK',
          headers: 'content-type: application/json',
          body: new TextEncoder().encode('{"status_code":0,"data":[],"has_more":0}'),
        }
      },
    }
    const signingRequests: Array<{ url: string; method: string; body?: string }> = []
    const api = new DouyinApi(
      client,
      () => FIXED_REQUEST_STATE,
      async (request) => {
        signingRequests.push(request)
        return {
          msToken: 'page-ms-token',
          aBogus: 'page-a-bogus',
          ...(request.url.includes('/aweme/v1/web/aweme/listcollection/')
            ? {
                timestamp: '1234567890',
                webSignature: 'page-web-signature',
                webExpire: '1234567990',
              }
            : {}),
        }
      },
    )

    await api.searchAwemes('音乐', 0, 10)
    await api.getCollectedAwemes(0, 10)

    expect(requests).toHaveLength(2)
    expect(new URL(requests[0]?.url).searchParams).toMatchObject(expect.any(URLSearchParams))
    expect(new URL(requests[0]?.url).searchParams.get('msToken')).toBe('page-ms-token')
    expect(new URL(requests[0]?.url).searchParams.get('a_bogus')).toBe('page-a-bogus')
    expect(requests[0]?.credentials).toBe('include')
    expect(signingRequests[0]?.url).not.toContain('msToken=')
    expect(signingRequests[0]?.url).not.toContain('a_bogus=')
    expect(signingRequests[1]).toMatchObject({
      method: 'POST',
      body: 'count=10&cursor=0',
    })
    expect(new URL(signingRequests[1]!.url).searchParams.get('verifyFp')).toBe(
      FIXED_REQUEST_STATE.verifyFp,
    )
    expect(new URL(requests[1]!.url).searchParams.get('timestamp')).toBe('1234567890')
    expect(new URL(requests[1]!.url).searchParams.get('x-secsdk-web-signature')).toBe(
      'page-web-signature',
    )
    expect(requests[1]?.headers).toMatchObject({
      'x-secsdk-web-signature': 'page-web-signature',
      'x-secsdk-web-expire': '1234567990',
    })
  })

  it('uses the current quick-player and Web SecSDK envelope for work detail', async () => {
    const requests: HttpRequest[] = []
    const client: HttpClient = {
      async request(request) {
        requests.push(request)
        return {
          status: 200,
          statusText: 'OK',
          headers: 'content-type: application/json',
          body: new TextEncoder().encode('{"status_code":0,"aweme_detail":{"aweme_id":"work-1"}}'),
        }
      },
    }
    const api = new DouyinApi(
      client,
      () => FIXED_REQUEST_STATE,
      async () => ({
        msToken: 'page-ms-token',
        aBogus: 'page-a-bogus',
        timestamp: '1234567890',
        webSignature: 'page-web-signature',
        webExpire: '1234567990',
      }),
    )

    await api.getAwemeDetail('work-1')

    const request = requests[0]!
    const params = new URL(request.url).searchParams
    expect(Object.fromEntries(params)).toMatchObject({
      aweme_id: 'work-1',
      request_source: '600',
      origin_type: 'quick_player',
      webcast_sdk_version: '170400',
      webcast_version_code: '170400',
      timestamp: '1234567890',
      'x-secsdk-web-signature': 'page-web-signature',
    })
    expect(request.headers).toMatchObject({
      'x-secsdk-web-signature': 'page-web-signature',
      'x-secsdk-web-expire': '1234567990',
    })
  })

  it('overlays target-domain cookie state before signing a cross-site request', async () => {
    const requests: HttpRequest[] = []
    const client: HttpClient = {
      async request(request) {
        requests.push(request)
        return {
          status: 200,
          statusText: 'OK',
          headers: 'content-type: application/json',
          body: new TextEncoder().encode('{"status_code":0,"data":[],"has_more":0}'),
        }
      },
    }
    let signingUrl = ''
    const crossSiteState = { ...FIXED_REQUEST_STATE, uifid: '', verifyFp: 'fallback-verify-fp' }
    const api = new DouyinApi(
      client,
      () => crossSiteState,
      async (request) => {
        signingUrl = request.url
        return { msToken: '', aBogus: 'sandbox-a-bogus' }
      },
      async () => ({ uifid: 'cookie-uifid', verifyFp: 'cookie-verify-fp' }),
    )

    await api.searchAwemes('音乐', 0, 10)

    expect(new URL(signingUrl).searchParams).toMatchObject(expect.any(URLSearchParams))
    expect(new URL(signingUrl).searchParams.get('uifid')).toBe('cookie-uifid')
    expect(new URL(requests[0]!.url).searchParams.get('verifyFp')).toBe('cookie-verify-fp')
    expect(requests[0]?.headers).toMatchObject({ UIFID: 'cookie-uifid' })
  })

  it('routes account-only lists through the hosts and parameters used by the current web page', async () => {
    const requests: HttpRequest[] = []
    const client: HttpClient = {
      async request(request) {
        requests.push(request)
        return {
          status: 200,
          statusText: 'OK',
          headers: 'content-type: application/json',
          body: new TextEncoder().encode(
            '{"status_code":0,"aweme_list":[],"cursor":0,"has_more":0}',
          ),
        }
      },
    }
    const api = new DouyinApi(client, () => FIXED_REQUEST_STATE)
    await api.getUserFavorites('self-sec-uid', 0, 18)
    await api.getSelfRecommendations('self-sec-uid', 0, 18)
    await api.getCollectedAwemes(0, 10)
    await api.getCollectedAwemes(123, 10)

    expect(requests).toHaveLength(4)
    expect(requests[0]).toMatchObject({
      method: 'GET',
      credentials: 'include',
      responseType: 'bytes',
    })
    expect(requests[0]?.url).toMatch(
      /^https:\/\/www-hj\.douyin\.com\/aweme\/v1\/web\/aweme\/favorite\/\?/,
    )
    expect(new URL(requests[0]?.url).searchParams.get('cut_version')).toBe('1')
    const favoriteParams = new URL(requests[0]?.url).searchParams
    expect([...favoriteParams.keys()]).toEqual([
      'device_platform',
      'aid',
      'channel',
      'sec_user_id',
      'max_cursor',
      'min_cursor',
      'whale_cut_token',
      'cut_version',
      'count',
      'publish_video_strategy_type',
      'update_version_code',
      'pc_client_type',
      'pc_libra_divert',
      'support_h265',
      'support_dash',
      'cpu_core_num',
      'version_code',
      'version_name',
      'cookie_enabled',
      'screen_width',
      'screen_height',
      'browser_language',
      'browser_platform',
      'browser_name',
      'browser_version',
      'browser_online',
      'engine_name',
      'engine_version',
      'os_name',
      'os_version',
      'device_memory',
      'platform',
      'downlink',
      'effective_type',
      'round_trip_time',
      'webid',
      'uifid',
      'verifyFp',
      'fp',
      'msToken',
      'a_bogus',
      'timestamp',
      'x-secsdk-web-signature',
    ])
    expect(Object.fromEntries(favoriteParams)).toMatchObject({
      browser_version: '140.0.0.0',
      cpu_core_num: '16',
      downlink: '8.4',
      webid: FIXED_REQUEST_STATE.webId,
      uifid: FIXED_REQUEST_STATE.uifid,
      verifyFp: FIXED_REQUEST_STATE.verifyFp,
      fp: FIXED_REQUEST_STATE.verifyFp,
      msToken: FIXED_REQUEST_STATE.msToken,
      update_version_code: '170400',
      version_code: '170400',
      version_name: '17.4.0',
      timestamp: '',
      'x-secsdk-web-signature': '',
    })

    expect(requests[1]).toMatchObject({
      method: 'GET',
      credentials: 'include',
      responseType: 'bytes',
    })
    expect(requests[1]?.url).toMatch(
      /^https:\/\/www\.douyin\.com\/aweme\/v1\/web\/familiar\/recommend\/feed\/\?/,
    )
    const recommendationParams = new URL(requests[1]?.url).searchParams
    expect(recommendationParams.get('from')).toBe('1')
    expect(recommendationParams.get('whale_cut_token')).toBe('')
    expect([...recommendationParams.keys()].slice(-4)).toEqual([
      'verifyFp',
      'fp',
      'msToken',
      'a_bogus',
    ])
    expect(recommendationParams.has('publish_video_strategy_type')).toBe(false)
    expect(recommendationParams.has('timestamp')).toBe(false)

    expect(requests[2]).toMatchObject({
      method: 'POST',
      body: 'count=10&cursor=0',
      credentials: 'include',
      responseType: 'bytes',
    })
    expect(requests[2]?.url).toMatch(
      /^https:\/\/www-hj\.douyin\.com\/aweme\/v1\/web\/aweme\/listcollection\/\?/,
    )
    expect([...new URL(requests[2]?.url).searchParams.keys()]).toEqual([
      'device_platform',
      'aid',
      'channel',
      'publish_video_strategy_type',
      'pc_client_type',
      'pc_libra_divert',
      'update_version_code',
      'support_h265',
      'support_dash',
      'version_code',
      'version_name',
      'cookie_enabled',
      'screen_width',
      'screen_height',
      'browser_language',
      'browser_platform',
      'browser_name',
      'browser_version',
      'browser_online',
      'engine_name',
      'engine_version',
      'os_name',
      'os_version',
      'cpu_core_num',
      'device_memory',
      'platform',
      'downlink',
      'effective_type',
      'round_trip_time',
      'webid',
      'uifid',
      'verifyFp',
      'fp',
      'msToken',
      'a_bogus',
      'timestamp',
      'x-secsdk-web-signature',
    ])
    expect(Object.fromEntries(new URL(requests[2]?.url).searchParams)).toMatchObject({
      update_version_code: '170400',
      version_code: '170400',
      version_name: '17.4.0',
    })
    expect(requests[3]).toMatchObject({ method: 'POST', body: 'count=10&cursor=123' })
    expect(requests[3]?.url).toMatch(
      /^https:\/\/www-hj\.douyin\.com\/aweme\/v1\/web\/aweme\/listcollection\/\?/,
    )
    expect(requests.every((request) => new URL(request.url).searchParams.has('a_bogus'))).toBe(true)
    expect(
      requests.every(
        (request) => request.headers?.['User-Agent'] === FIXED_REQUEST_STATE.userAgent,
      ),
    ).toBe(true)
  })

  it('distinguishes business risk code 2483 from ordinary HTTP rejection', async () => {
    const responses = [
      {
        status: 403,
        statusText: 'Forbidden',
        headers: 'content-type: application/json',
        body: new TextEncoder().encode('{"status_code":2483,"status_msg":"risk"}'),
      },
      {
        status: 403,
        statusText: 'Forbidden',
        headers: 'content-type: text/html',
        body: new TextEncoder().encode('<html>forbidden</html>'),
      },
      {
        status: 429,
        statusText: 'Too Many Requests',
        headers: '',
        body: new TextEncoder().encode('busy'),
      },
    ]
    const client: HttpClient = {
      async request() {
        return responses.shift()!
      },
    }
    const api = new DouyinApi(client, () => FIXED_REQUEST_STATE)

    const riskControlRequest = api.getCollectedAwemes(0, 10)
    await expect(riskControlRequest).rejects.toBeInstanceOf(DouyinRiskControlError)
    await expect(riskControlRequest).rejects.toMatchObject({
      code: 'verification-required',
      statusCode: 'AM-3005',
    })
    const accessDeniedRequest = api.getCollectedAwemes(0, 10)
    await expect(accessDeniedRequest).rejects.toMatchObject({ code: 'access-denied' })
    await expect(accessDeniedRequest).rejects.toSatisfy((error: unknown) =>
      isDouyinHttpStatusError(error, 403),
    )
    await expect(api.getCollectedAwemes(0, 10)).rejects.toMatchObject({ code: 'rate-limited' })
  })
})

function encodeFrames(chunks: readonly Uint8Array[]): Uint8Array {
  const encoder = new TextEncoder()
  const frames: Uint8Array[] = []
  for (const chunk of chunks) {
    frames.push(encoder.encode(`${chunk.length.toString(16)}\r\n`), chunk, encoder.encode('\r\n'))
  }
  frames.push(encoder.encode('0\r\n\r\n'))
  const total = frames.reduce((sum, frame) => sum + frame.length, 0)
  const joined = new Uint8Array(total)
  let offset = 0
  for (const frame of frames) {
    joined.set(frame, offset)
    offset += frame.length
  }
  return joined
}
