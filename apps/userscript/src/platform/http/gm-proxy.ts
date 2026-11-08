import type { NetworkProxySettings } from '@any-music/music-workbench/features/settings/network-proxy-settings'
import {
  DEFAULT_NETWORK_PROXY_SETTINGS,
  isSocksProxyType,
  validateNetworkProxySettings,
} from '@any-music/music-workbench/features/settings/network-proxy-settings'

/** Tampermonkey 5.5+ 在 Firefox 中支持的单次 GM 请求代理配置。 */
export interface GmProxyConfiguration {
  type: NetworkProxySettings['type']
  host: string
  port: number
  username?: string
  password?: string
  proxyDNS?: boolean
  proxyAuthorizationHeader?: string
}

let activeProxySettings: NetworkProxySettings = { ...DEFAULT_NETWORK_PROXY_SETTINGS }

/** 应用设置通过此边界更新运行时配置，后续每个 GM 请求都会读取最新快照。 */
export function configureGmHttpProxy(settings: NetworkProxySettings): void {
  activeProxySettings = validateNetworkProxySettings(settings)
}

export function getGmProxyConfiguration(): GmProxyConfiguration | undefined {
  if (!activeProxySettings.isEnabled) return undefined
  return createGmProxyConfiguration(activeProxySettings)
}

/** 将通用表单值转换成 GM 专属字段，避免凭证和兼容逻辑泄漏到请求调用方。 */
export function createGmProxyConfiguration(
  input: NetworkProxySettings,
): GmProxyConfiguration | undefined {
  const settings = validateNetworkProxySettings(input)
  if (!settings.isEnabled) return undefined

  const proxy: GmProxyConfiguration = {
    type: settings.type,
    host: settings.host,
    port: settings.port,
  }
  if (isSocksProxyType(settings.type)) {
    proxy.proxyDNS = settings.proxyDns
    if (settings.username) {
      proxy.username = settings.username
      proxy.password = settings.password
    }
  } else if (settings.username) {
    proxy.proxyAuthorizationHeader = createBasicProxyAuthorization(
      settings.username,
      settings.password,
    )
  }
  return proxy
}

function createBasicProxyAuthorization(username: string, password: string): string {
  // TextEncoder 避免 btoa 直接处理非 Latin-1 用户名时抛错；代理端按 UTF-8 解码凭据。
  const bytes = new TextEncoder().encode(`${username}:${password}`)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return `Basic ${btoa(binary)}`
}
