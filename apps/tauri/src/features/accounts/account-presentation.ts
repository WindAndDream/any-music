import { BUILT_IN_SOURCE_DIRECTORY } from '../music-sources/built-in-source-directory'
import type { NativeAccount, NativeProxy } from './account-runtime'
import { getAccountState } from './account-state'

export const ACCOUNT_PLATFORMS = BUILT_IN_SOURCE_DIRECTORY.map(({ descriptor }) => ({
  id: descriptor.id,
  name: descriptor.name,
}))

export function platformName(id: string): string {
  return ACCOUNT_PLATFORMS.find((platform) => platform.id === id)?.name ?? id
}

/** A signed-in identity can still require security recovery. Network failures do not prove logout. */
export function canLogin(account: NativeAccount): boolean {
  return (
    account.enabled &&
    (account.authentication === 'anonymous' ||
      getAccountState(account).login === 'signed-out' ||
      getAccountState(account).verification === 'required')
  )
}

export function isSignedIn(account: NativeAccount): boolean {
  return getAccountState(account).login === 'signed-in'
}

export function accountStatus(account: NativeAccount): string {
  if (!account.enabled) return '已停用'
  const state = getAccountState(account)
  const login =
    state.login === 'signed-in'
      ? '已登录'
      : state.login === 'signed-out'
        ? account.authentication === 'anonymous' && account.platformId.startsWith('external:')
          ? '无需登录'
          : '未登录'
        : '登录待确认'
  return [
    login,
    state.verification === 'required' ? '需要验证' : '',
    state.connection === 'unavailable' ? '连接不可用' : '',
  ]
    .filter(Boolean)
    .join(' · ')
}
export function connectionSummary(account: NativeAccount, proxies: readonly NativeProxy[]): string {
  if (!account.proxyId) return '直连'
  const primary = proxies.find((proxy) => proxy.id === account.proxyId)?.name ?? '代理已移除'
  const count = account.backupProxyIds?.length ?? 0
  return count ? `${primary} · ${count} 个备用代理` : primary
}
/** Names are trimmed at both boundaries; uniqueness is scoped to the platform. */
export function accountNameError(
  accounts: readonly NativeAccount[],
  platform: string,
  name: string,
  id?: string,
): string {
  const normalized = name.trim()
  if (!normalized || [...normalized].length > 80) return '账号名称需要 1–80 个字符。'
  return accounts.some(
    (account) =>
      account.id !== id && account.platformId === platform && account.name.trim() === normalized,
  )
    ? '此平台已有同名账号，请换一个名称。'
    : ''
}
