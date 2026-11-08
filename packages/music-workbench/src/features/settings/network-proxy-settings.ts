/** Userscript 请求可选的浏览器原生代理类型，与 Tampermonkey 的 proxy 契约保持一致。 */
export type NetworkProxyType = 'http' | 'https' | 'socks' | 'socks4'

/** 全局请求代理设置；密码仅保存在当前脚本的 GM 存储中，不进入音乐领域模型。 */
export interface NetworkProxySettings {
  isEnabled: boolean
  type: NetworkProxyType
  host: string
  port: number
  username: string
  password: string
  proxyDns: boolean
}

export const DEFAULT_NETWORK_PROXY_SETTINGS: Readonly<NetworkProxySettings> = {
  isEnabled: false,
  type: 'http',
  host: '',
  port: 8080,
  username: '',
  password: '',
  proxyDns: true,
}

const MAX_PROXY_HOST_LENGTH = 255
const MAX_PROXY_CREDENTIAL_LENGTH = 512

/** 保存前严格校验用户输入，避免把 URL、路径或无效端口误传给浏览器代理接口。 */
export function validateNetworkProxySettings(input: NetworkProxySettings): NetworkProxySettings {
  const host = input.host.normalize('NFKC').trim()
  const username = input.username.normalize('NFKC').trim()
  const password = input.password

  if (!isNetworkProxyType(input.type)) throw new AppError('invalid-input', '请选择有效的代理类型。')
  if (host.length > MAX_PROXY_HOST_LENGTH) {
    throw new AppError('invalid-input', `代理主机不能超过 ${MAX_PROXY_HOST_LENGTH} 个字符。`)
  }
  if (input.isEnabled && !host) throw new AppError('invalid-input', '启用代理前请填写代理主机。')
  if (host && !isValidProxyHost(host)) {
    throw new AppError('invalid-input', '代理主机只填写域名或 IP，不要包含协议、端口或路径。')
  }
  if (!Number.isInteger(input.port) || input.port < 1 || input.port > 65_535) {
    throw new AppError('invalid-input', '代理端口必须是 1 到 65535 之间的整数。')
  }
  if (username.length > MAX_PROXY_CREDENTIAL_LENGTH) {
    throw new AppError(
      'invalid-input',
      `代理用户名不能超过 ${MAX_PROXY_CREDENTIAL_LENGTH} 个字符。`,
    )
  }
  if (password.length > MAX_PROXY_CREDENTIAL_LENGTH) {
    throw new AppError('invalid-input', `代理密码不能超过 ${MAX_PROXY_CREDENTIAL_LENGTH} 个字符。`)
  }
  if (password && !username) {
    throw new AppError('invalid-input', '填写代理密码时也需要填写用户名。')
  }

  return {
    isEnabled: input.isEnabled,
    type: input.type,
    host,
    port: input.port,
    username,
    password,
    proxyDns: isSocksProxyType(input.type) && input.proxyDns,
  }
}

/** GM 存储属于不可信输入；损坏代理设置统一退回安全的直连默认值。 */
export function sanitizeNetworkProxySettings(input: unknown): NetworkProxySettings {
  if (!isRecord(input)) return { ...DEFAULT_NETWORK_PROXY_SETTINGS }
  try {
    return validateNetworkProxySettings({
      isEnabled: input.isEnabled === true,
      type: isNetworkProxyType(input.type) ? input.type : DEFAULT_NETWORK_PROXY_SETTINGS.type,
      host: typeof input.host === 'string' ? input.host : '',
      port: typeof input.port === 'number' ? input.port : DEFAULT_NETWORK_PROXY_SETTINGS.port,
      username: typeof input.username === 'string' ? input.username : '',
      password: typeof input.password === 'string' ? input.password : '',
      proxyDns: input.proxyDns !== false,
    })
  } catch {
    return { ...DEFAULT_NETWORK_PROXY_SETTINGS }
  }
}

export function isSocksProxyType(type: NetworkProxyType): boolean {
  return type === 'socks' || type === 'socks4'
}

function isNetworkProxyType(input: unknown): input is NetworkProxyType {
  return input === 'http' || input === 'https' || input === 'socks' || input === 'socks4'
}

function isValidProxyHost(host: string): boolean {
  if (
    /^[a-z][a-z\d+.-]*:\/\//i.test(host) ||
    /[\s/@?#\\]/u.test(host) ||
    host.includes('[') ||
    host.includes(']')
  ) {
    return false
  }
  try {
    // URL 解析器负责区分合法 IPv6 与误写成 host:port 的普通主机名。
    const candidate = new URL(`http://${host.includes(':') ? `[${host}]` : host}`)
    return Boolean(candidate.hostname) && !candidate.port && candidate.pathname === '/'
  } catch {
    return false
  }
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return Boolean(input) && typeof input === 'object' && !Array.isArray(input)
}
import { AppError } from '@any-music/core'
