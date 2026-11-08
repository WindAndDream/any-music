import { describe, expect, it } from 'vitest'

import {
  createDouyinVerifyFp,
  createDouyinWebId,
  createDouyinWebRequestStateProvider,
} from '../src/douyin-request-state'
import type { DouyinRequestRuntime } from '../src/douyin-request-state'

describe('Douyin request state', () => {
  it('builds request fields from the current browser, device, network and same-site cookies', () => {
    const connection = { downlink: 6.25, effectiveType: '4g', rtt: 75 }
    const navigator = {
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
      language: 'zh-CN',
      platform: 'Win32',
      onLine: true,
      cookieEnabled: true,
      hardwareConcurrency: 20,
      deviceMemory: 16,
      connection,
    }
    const runtime = {
      navigator,
      screen: {
        width: 2560,
        height: 1440,
        availWidth: 2560,
        availHeight: 1392,
        colorDepth: 24,
        pixelDepth: 24,
      },
      document: {
        cookie:
          'UIFID=browser-uifid; s_v_web_id=verify_native_page; is_dash_user=1; hevc_supported=false',
      },
      location: { hostname: 'www.douyin.com' },
      localStorage: createStorage({
        SysInfo: '{"hash":"ignored","webid":"7123456789012345678"}',
        xmst: 'native-ms-token',
      }),
      innerWidth: 1920,
      innerHeight: 1080,
      outerWidth: 1936,
      outerHeight: 1176,
      screenX: 0,
      screenY: 0,
      now: () => 1_700_000_000_000,
      random: () => 0.25,
    } as unknown as DouyinRequestRuntime
    const getState = createDouyinWebRequestStateProvider(runtime)
    const first = getState()

    expect(first).toMatchObject({
      browserName: 'Chrome',
      browserVersion: '140.0.0.0',
      engineName: 'Blink',
      engineVersion: '140.0.0.0',
      osName: 'Windows',
      osVersion: '10',
      browserPlatform: 'Win32',
      cpuCoreCount: '20',
      deviceMemory: '16',
      screenWidth: '2560',
      screenHeight: '1440',
      downlink: '6.25',
      effectiveType: '4g',
      roundTripTime: '75',
      supportDash: '1',
      supportH265: '0',
      uifid: 'browser-uifid',
      verifyFp: 'verify_native_page',
      webId: '7123456789012345678',
      msToken: 'native-ms-token',
    })
    expect(first.browserFingerprint).toBe(
      '1920|1080|1936|1176|0|0|0|0|2560|1440|2560|1392|1920|1080|24|24|Win32',
    )
    connection.rtt = 120
    navigator.onLine = false
    const second = getState()
    expect(second.verifyFp).toBe(first.verifyFp)
    expect(second.webId).toBe(first.webId)
    expect(second.roundTripTime).toBe('120')
    expect(second.browserOnline).toBe('false')
  })

  it('does not copy Douyin identity cookies from an unrelated host', () => {
    const getState = createDouyinWebRequestStateProvider({
      document: { cookie: 'UIFID=must-not-cross-host' } as Document,
      location: { hostname: 'example.com' } as Location,
      now: () => 1,
      random: () => 0,
    })

    expect(getState().uifid).toBe('')
    expect(getState().msToken).toBe('')
  })

  it('uses Douyin device cookies when the browser hides the equivalent APIs', () => {
    const getState = createDouyinWebRequestStateProvider({
      document: {
        cookie:
          'device_web_cpu_core=12; device_web_memory_size=16; dy_swidth=1680; dy_sheight=1050',
      } as Document,
      location: { hostname: 'www.douyin.com' } as Location,
      now: () => 1,
      random: () => 0,
    })

    expect(getState()).toMatchObject({
      cpuCoreCount: '12',
      deviceMemory: '16',
      screenWidth: '1680',
      screenHeight: '1050',
    })
  })

  it('generates correctly shaped short-lived identity values at random boundaries', () => {
    expect(createDouyinVerifyFp(0, () => 0)).toMatch(
      /^verify_0_00000000_0000_4000_8000_000000000000$/,
    )
    expect(createDouyinWebId(() => 1)).toBe('9999999999999999999')
  })
})

function createStorage(values: Readonly<Record<string, string>>): Storage {
  return {
    get length() {
      return Object.keys(values).length
    },
    clear() {},
    getItem(key) {
      return values[key] ?? null
    },
    key(index) {
      return Object.keys(values)[index] ?? null
    },
    removeItem() {},
    setItem() {},
  }
}
