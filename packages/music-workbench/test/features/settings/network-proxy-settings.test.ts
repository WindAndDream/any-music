import { describe, expect, it } from 'vitest'

import {
  DEFAULT_NETWORK_PROXY_SETTINGS,
  sanitizeNetworkProxySettings,
  validateNetworkProxySettings,
} from '#workbench/features/settings/network-proxy-settings'

describe('network proxy settings', () => {
  it('restores a saved proxy configuration independently from its disabled state', () => {
    const settings = {
      ...DEFAULT_NETWORK_PROXY_SETTINGS,
      host: 'proxy.example.com',
      port: 3128,
      username: 'alice',
      password: 'secret',
    }
    expect(sanitizeNetworkProxySettings(settings)).toEqual({ ...settings, proxyDns: false })
  })
  it('normalizes a valid enabled proxy', () => {
    expect(
      validateNetworkProxySettings({
        isEnabled: true,
        type: 'socks',
        host: '  proxy.example.com  ',
        port: 1080,
        username: ' user ',
        password: 'secret',
        proxyDns: true,
      }),
    ).toEqual({
      isEnabled: true,
      type: 'socks',
      host: 'proxy.example.com',
      port: 1080,
      username: 'user',
      password: 'secret',
      proxyDns: true,
    })
  })

  it('rejects URL-shaped hosts and invalid ports', () => {
    expect(() =>
      validateNetworkProxySettings({
        ...DEFAULT_NETWORK_PROXY_SETTINGS,
        isEnabled: true,
        host: 'http://127.0.0.1',
      }),
    ).toThrow('不要包含协议')
    expect(() =>
      validateNetworkProxySettings({
        ...DEFAULT_NETWORK_PROXY_SETTINGS,
        isEnabled: true,
        host: '127.0.0.1',
        port: 70_000,
      }),
    ).toThrow('1 到 65535')
  })

  it('falls back to direct requests for damaged persisted settings', () => {
    expect(
      sanitizeNetworkProxySettings({
        isEnabled: true,
        type: 'http',
        host: 'proxy.example.com/path',
        port: 8080,
      }),
    ).toEqual(DEFAULT_NETWORK_PROXY_SETTINGS)
  })
})
