import { describe, expect, it } from 'vitest'

import { normalizeProxyUrl, validateProxyDraft } from '@/features/accounts/proxy-settings'

import endpoints from '../../fixtures/proxy-endpoints.json'

describe('desktop proxy endpoints (shared with native validation)', () => {
  it.each(endpoints.accepted)(
    'normalizes $input and preserves its explicit port',
    ({ input, normalized }) => {
      expect(normalizeProxyUrl(input)).toBe(normalized)
    },
  )
  it.each(endpoints.rejected)('rejects invalid endpoint %s', (input) => {
    expect(() => normalizeProxyUrl(input)).toThrow()
  })
  it('rejects duplicate addresses even with different names and legacy URL formatting', () => {
    const proxies = [{ id: 'p', name: '本地代理', url: 'SOCKS5h://Proxy.Example.:1080/' }]
    expect(
      validateProxyDraft('备用代理', 'socks5h://proxy.example:01080', proxies).urlError,
    ).toContain('地址已存在')
    expect(validateProxyDraft(' 本地代理 ', 'http://localhost:7897', proxies).nameError).toContain(
      '名称已存在',
    )
    expect(validateProxyDraft('另一协议', 'socks5://proxy.example:1080', proxies).urlError).toBe('')
    expect(validateProxyDraft('另一端口', 'socks5h://proxy.example:1081', proxies).urlError).toBe(
      '',
    )
  })
  it('validates name length by characters and trims submitted values', () => {
    expect(validateProxyDraft('中文'.repeat(40), 'http://localhost:80', []).nameError).toBe('')
    expect(validateProxyDraft('字'.repeat(81), 'http://localhost:80', []).nameError).not.toBe('')
    expect(validateProxyDraft('   ', 'http://localhost:80', []).nameError).not.toBe('')
    expect(validateProxyDraft(' 本地代理 ', ' HTTP://LOCALHOST:80/ ', [])).toEqual({
      name: '本地代理',
      url: 'http://localhost:80',
      nameError: '',
      urlError: '',
    })
  })
})
