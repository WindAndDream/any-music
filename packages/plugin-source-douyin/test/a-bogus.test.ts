import { describe, expect, it } from 'vitest'

import { createDouyinABogus } from '../src/a-bogus'
import { createSm3Hash } from '../src/sm3'

describe('Douyin a_bogus primitives', () => {
  it('matches the official SM3 vectors', () => {
    expect(createSm3Hash(new TextEncoder().encode('abc'))).toBe(
      '66c7f0f462eeedd9d1f2d46bdc10e4e24167c4875cf2f7a2297da02b8f4ba8e0',
    )
    expect(createSm3Hash(new TextEncoder().encode('abcd'.repeat(16)))).toBe(
      'debe9ff92275b8a138604889c18e5a4d6fdb70e5387e5765293dcba39c0c5732',
    )
  })

  it('stays byte-identical to the pinned upstream parity vector', () => {
    const query =
      'device_platform=webapp&aid=6383&channel=channel_pc_web&aweme_id=7372484719365098803&pc_client_type=1&version_code=290100&version_name=29.1.0&cookie_enabled=true&screen_width=1920&screen_height=1080&browser_language=zh-CN&browser_platform=Win32&browser_name=Chrome&browser_version=130.0.0.0&browser_online=true&engine_name=Blink&engine_version=130.0.0.0&os_name=Windows&os_version=10&cpu_core_num=12&device_memory=8&platform=PC&downlink=10&effective_type=4g&round_trip_time=0&msToken='
    expect(
      createDouyinABogus(query, 'GET', {
        randomOne: 0.1,
        randomTwo: 0.2,
        randomThree: 0.3,
        startTimeMs: 1_700_000_000_000,
        endTimeMs: 1_700_000_000_005,
      }),
    ).toBe(
      'DfmhQDgDDDDkDD6D56KLfY3q668VYmQI0SVkMD2fW-DOqL39HMYh9exoIBGvXY8jwG/-IeEjy4hbT3ohrQ2y0Hwf9W0L/25ksDSkKl5Q5xSSs1X9eghgJ04qmkt5SMx2RvB-rOXmqhZHKRbp09oHmhK4b1dzFgf3qJLzMj==',
    )
  })

  it('derives the UA digest dynamically while preserving the captured legacy vector', () => {
    const query = 'device_platform=webapp&aid=6383&msToken='
    const options = {
      randomOne: 0.1,
      randomTwo: 0.2,
      randomThree: 0.3,
      startTimeMs: 1_700_000_000_000,
      endTimeMs: 1_700_000_000_005,
    }
    const legacyUserAgent =
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/90.0.4430.212 Safari/537.36'
    const legacy = createDouyinABogus(query, 'GET', options)

    expect(createDouyinABogus(query, 'GET', { ...options, userAgent: legacyUserAgent })).toBe(
      legacy,
    )
    expect(
      createDouyinABogus(query, 'GET', {
        ...options,
        userAgent: legacyUserAgent.replace('Chrome/90.0.4430.212', 'Chrome/140.0.0.0'),
      }),
    ).not.toBe(legacy)
    expect(
      createDouyinABogus(query, 'GET', {
        ...options,
        browserFingerprint: '1920|1000|1920|1080|0|0|0|0|1920|1080|1920|1040|1920|1000|24|24|Win32',
      }),
    ).not.toBe(legacy)
  })

  it('includes the actual HTTP method in the signature payload', () => {
    const options = {
      randomOne: 0.1,
      randomTwo: 0.2,
      randomThree: 0.3,
      startTimeMs: 1_700_000_000_000,
      endTimeMs: 1_700_000_000_005,
    }

    expect(createDouyinABogus('aid=6383', 'POST', options)).not.toBe(
      createDouyinABogus('aid=6383', 'GET', options),
    )
  })
})
