import type { NativeProxy } from './account-runtime'

/** 桌面只接受无认证的代理端点；显式保留默认端口，与 Rust 的保存/查重规则一致。 */
export function normalizeProxyUrl(value: string): string {
  const input = value.trim()
  if (!input) throw new Error('请填写代理地址。')
  if (/[\s\p{Cc}\\%]/u.test(input)) throw new Error('代理地址不能包含空白、反斜杠或转义字符。')
  const prefix = /^([a-z][a-z0-9+.-]*):\/\//i.exec(input)
  const scheme = prefix?.[1]?.toLowerCase()
  if (!prefix || !scheme || !['http', 'https', 'socks5', 'socks5h'].includes(scheme))
    throw new Error('请使用 http://、https://、socks5:// 或 socks5h:// 开头的地址。')
  const endpoint = input.slice(prefix[0].length)
  const authority = endpoint.endsWith('/') ? endpoint.slice(0, -1) : endpoint
  if (/[/?#]/.test(authority))
    throw new Error('代理地址只能包含主机和端口，不能包含路径、查询或片段。')
  if (authority.includes('@')) throw new Error('暂不支持代理认证，请移除地址中的用户名和密码。')
  const parts = /^(\[[^\]]+\]|[^:]+):([0-9]+)$/.exec(authority)
  if (!parts) throw new Error('请填写主机和端口；IPv6 地址需使用方括号，例如 [::1]:1080。')
  const rawHost = parts[1]!
  const port = Number(parts[2])
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error('代理端口必须是 1–65535 之间的整数。')
  let host: string
  try {
    // 用同一主机解析规则处理四种协议，避免 SOCKS 的非特殊 URL 主机不规范化。
    host = new URL(`http://${authority}/`).hostname.toLowerCase().replace(/\.$/, '')
  } catch {
    throw new Error('请填写有效的 IPv4、IPv6 地址或域名。')
  }
  if (/^[0-9.]+$/.test(host)) {
    if (host !== rawHost) throw new Error('IPv4 地址需填写完整的四段十进制数字。')
  } else if (!host.startsWith('[')) {
    if (
      host.length > 253 ||
      !host.split('.').every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))
    )
      throw new Error('请填写有效的 IPv4、IPv6 地址或域名。')
  }
  return `${scheme}://${host}:${port}`
}

export function validateProxyDraft(name: string, url: string, proxies: readonly NativeProxy[]) {
  const normalizedName = name.trim()
  let normalizedUrl = ''
  let nameError = ''
  let urlError = ''
  if (!normalizedName || [...normalizedName].length > 80) nameError = '代理名称需要 1–80 个字符。'
  else if (proxies.some((proxy) => proxy.name.trim() === normalizedName))
    nameError = '代理名称已存在，请使用其他名称。'
  try {
    normalizedUrl = normalizeProxyUrl(url)
    if (
      proxies.some((proxy) => {
        try {
          return normalizeProxyUrl(proxy.url) === normalizedUrl
        } catch {
          return false
        }
      })
    )
      urlError = '该代理地址已存在，请勿重复添加。'
  } catch (cause) {
    urlError = (cause as Error).message
  }
  return { name: normalizedName, url: normalizedUrl, nameError, urlError }
}
