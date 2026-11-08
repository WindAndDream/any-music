import { describe, expect, it, vi } from 'vitest'

vi.mock('$', () => ({ GM_cookie: { list: vi.fn() } }))

import { createDouyinTargetCookieStateProvider } from '@/platform/music-plugins/douyin/douyin-target-cookie-state'

describe('Douyin target cookie state', () => {
  it('reads only request-scoped identity fields from the Douyin cookie jar', async () => {
    const list = vi.fn((_details, callback) => {
      callback(
        [
          { name: 'UIFID', value: 'target-uifid' },
          { name: 's_v_web_id', value: 'target-verify-fp' },
          { name: 'sessionid', value: 'must-not-be-exposed' },
        ],
        undefined,
      )
    })
    const provider = createDouyinTargetCookieStateProvider({ list })

    await expect(provider()).resolves.toEqual({
      uifid: 'target-uifid',
      verifyFp: 'target-verify-fp',
    })
    expect(list).toHaveBeenCalledWith({ url: 'https://www.douyin.com/' }, expect.any(Function))
  })

  it('degrades to empty fields when Tampermonkey denies cookie access', async () => {
    const provider = createDouyinTargetCookieStateProvider({
      list: vi.fn((_details, callback) => callback([], new Error('denied'))),
    })

    await expect(provider()).resolves.toEqual({ uifid: '', verifyFp: '' })
  })
})
