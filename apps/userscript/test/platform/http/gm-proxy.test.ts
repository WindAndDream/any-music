import { DEFAULT_NETWORK_PROXY_SETTINGS } from '@any-music/music-workbench/features/settings/network-proxy-settings'
import { beforeEach, describe, expect, it } from 'vitest'

import {
  configureGmHttpProxy,
  createGmProxyConfiguration,
  getGmProxyConfiguration,
} from '@/platform/http/gm-proxy'

describe('GM request proxy', () => {
  beforeEach(() => configureGmHttpProxy({ ...DEFAULT_NETWORK_PROXY_SETTINGS }))

  it('omits proxy details while direct requests are selected', () => {
    expect(createGmProxyConfiguration({ ...DEFAULT_NETWORK_PROXY_SETTINGS })).toBeUndefined()
    expect(getGmProxyConfiguration()).toBeUndefined()
  })

  it('returns to direct requests while retaining the saved configuration for reactivation', () => {
    const settings = { ...DEFAULT_NETWORK_PROXY_SETTINGS, host: 'proxy.example.com', port: 3128 }
    configureGmHttpProxy(settings)
    expect(getGmProxyConfiguration()).toBeUndefined()
    configureGmHttpProxy({ ...settings, isEnabled: true })
    expect(getGmProxyConfiguration()).toEqual({
      type: 'http',
      host: 'proxy.example.com',
      port: 3128,
    })
    configureGmHttpProxy(settings)
    expect(getGmProxyConfiguration()).toBeUndefined()
    configureGmHttpProxy({ ...settings, isEnabled: true })
    expect(getGmProxyConfiguration()?.host).toBe('proxy.example.com')
  })

  it('maps SOCKS credentials and DNS routing to the GM request contract', () => {
    configureGmHttpProxy({
      isEnabled: true,
      type: 'socks',
      host: '127.0.0.1',
      port: 1080,
      username: 'alice',
      password: 'secret',
      proxyDns: true,
    })

    expect(getGmProxyConfiguration()).toEqual({
      type: 'socks',
      host: '127.0.0.1',
      port: 1080,
      username: 'alice',
      password: 'secret',
      proxyDNS: true,
    })
  })

  it('maps HTTP credentials to a Proxy-Authorization header', () => {
    expect(
      createGmProxyConfiguration({
        isEnabled: true,
        type: 'http',
        host: 'proxy.example.com',
        port: 3128,
        username: 'alice',
        password: 'secret',
        proxyDns: false,
      }),
    ).toEqual({
      type: 'http',
      host: 'proxy.example.com',
      port: 3128,
      proxyAuthorizationHeader: 'Basic YWxpY2U6c2VjcmV0',
    })
  })
})
