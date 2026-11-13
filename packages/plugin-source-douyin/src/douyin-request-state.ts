/**
 * 抖音 Web 请求使用的设备快照与短生命周期身份。
 *
 * 这里只读取当前浏览器公开暴露的能力；UIFID 也仅在脚本正运行于 douyin.com 时从
 * 同站 Cookie 读取。状态不写入 GM 存储，避免把账号或设备标识跨站持久化。
 */
import type { DouyinWebRequestState, DouyinWebRequestStateProvider } from './runtime-contracts'
export type { DouyinWebRequestState, DouyinWebRequestStateProvider } from './runtime-contracts'

interface NavigatorConnection {
  downlink?: number
  effectiveType?: string
  rtt?: number
}

interface DouyinNavigator extends Navigator {
  connection?: NavigatorConnection
  deviceMemory?: number
}

export interface DouyinRequestRuntime {
  navigator?: DouyinNavigator
  screen?: Screen
  document?: Document
  location?: Location
  localStorage?: Storage
  innerWidth?: number
  innerHeight?: number
  outerWidth?: number
  outerHeight?: number
  screenX?: number
  screenY?: number
  MediaSource?: typeof MediaSource
  now?: () => number
  random?: () => number
}

const FALLBACK_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'
const VERIFY_FP_ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'

/**
 * 为一个 DouyinApi 实例创建状态提供器。verifyFp/webid 在实例生命周期内稳定，网络、
 * 在线状态和窗口尺寸则在每次请求前重新读取，与网页当前请求模型保持一致。
 */
export function createDouyinWebRequestStateProvider(
  runtime: DouyinRequestRuntime = globalThis as unknown as DouyinRequestRuntime,
): DouyinWebRequestStateProvider {
  const now = runtime.now ?? Date.now
  const random = runtime.random ?? Math.random
  const fallbackVerifyFp = createDouyinVerifyFp(now(), random)
  const fallbackWebId = createDouyinWebId(random)

  return () => createDouyinWebRequestState(runtime, fallbackVerifyFp, fallbackWebId)
}

/** 按网页使用的时间前缀与 UUID 风格随机段生成同一请求会话内的 verifyFp。 */
export function createDouyinVerifyFp(nowMs: number, random = Math.random): string {
  const characters = Array.from({ length: 36 }, () => '')
  characters[8] = characters[13] = characters[18] = characters[23] = '_'
  characters[14] = '4'

  for (let index = 0; index < characters.length; index += 1) {
    if (characters[index]) continue
    let alphabetIndex = Math.floor(normalizeRandom(random()) * VERIFY_FP_ALPHABET.length)
    if (index === 19) alphabetIndex = (alphabetIndex & 0x03) | 0x08
    characters[index] = VERIFY_FP_ALPHABET[alphabetIndex]!
  }

  return `verify_${Math.max(0, Math.floor(nowMs)).toString(36)}_${characters.join('')}`
}

/** webid 的真实值由网页服务建立；跨站 GM 请求只生成当前实例使用的 19 位模拟值。 */
export function createDouyinWebId(random = Math.random): string {
  const firstDigit = 1 + Math.floor(normalizeRandom(random()) * 9)
  let result = String(firstDigit)
  while (result.length < 19) result += Math.floor(normalizeRandom(random()) * 10)
  return result
}

function createDouyinWebRequestState(
  runtime: DouyinRequestRuntime,
  fallbackVerifyFp: string,
  fallbackWebId: string,
): DouyinWebRequestState {
  const navigator = runtime.navigator
  const screen = runtime.screen
  const userAgent = navigator?.userAgent || FALLBACK_USER_AGENT
  const browser = parseBrowser(userAgent)
  const os = parseOperatingSystem(userAgent, navigator?.platform)
  const connection = navigator?.connection
  const cookies = readDouyinCookies(runtime)
  const webSecurityState = readDouyinWebSecurityState(runtime)
  const screenWidth = positiveInteger(screen?.width, readPositiveInteger(cookies.dy_swidth) ?? 1920)
  const screenHeight = positiveInteger(
    screen?.height,
    readPositiveInteger(cookies.dy_sheight) ?? 1080,
  )

  return {
    userAgent,
    browserFingerprint: createBrowserFingerprint(runtime, os.browserPlatform),
    browserLanguage: navigator?.language || 'zh-CN',
    browserPlatform: navigator?.platform || os.browserPlatform,
    browserName: browser.name,
    browserVersion: browser.version,
    browserOnline: String(navigator?.onLine ?? true),
    cookieEnabled: String(navigator?.cookieEnabled ?? true),
    engineName: browser.engineName,
    engineVersion: browser.engineVersion,
    osName: os.name,
    osVersion: os.version,
    cpuCoreCount: String(
      positiveInteger(
        navigator?.hardwareConcurrency,
        readPositiveInteger(cookies.device_web_cpu_core) ?? 8,
      ),
    ),
    deviceMemory: finiteNumberString(
      navigator?.deviceMemory,
      String(readPositiveInteger(cookies.device_web_memory_size) ?? 8),
    ),
    screenWidth: String(screenWidth),
    screenHeight: String(screenHeight),
    downlink: finiteNumberString(connection?.downlink, '10'),
    effectiveType: connection?.effectiveType || '4g',
    roundTripTime: finiteNumberString(connection?.rtt, '0'),
    supportDash: readCapabilityCookie(cookies.is_dash_user) ?? detectDashSupport(runtime),
    supportH265: readCapabilityCookie(cookies.hevc_supported) ?? detectH265Support(runtime),
    pcLibraDivert: os.name,
    webId: webSecurityState.webId || fallbackWebId,
    uifid: cookies.UIFID || cookies.UIFID_TEMP || '',
    verifyFp: cookies.s_v_web_id || fallbackVerifyFp,
    msToken: webSecurityState.msToken,
  }
}

function readDouyinWebSecurityState(runtime: DouyinRequestRuntime): {
  webId: string
  msToken: string
} {
  const hostname = runtime.location?.hostname ?? ''
  if (hostname !== 'douyin.com' && !hostname.endsWith('.douyin.com')) {
    return { webId: '', msToken: '' }
  }

  try {
    const storage = runtime.localStorage
    const sysInfo = JSON.parse(storage?.getItem('SysInfo') ?? '{}') as unknown
    const webId =
      sysInfo && typeof sysInfo === 'object' && 'webid' in sysInfo
        ? String((sysInfo as { webid?: unknown }).webid ?? '')
        : ''
    // webmssdk 1.0.0.20 将当前页面安全令牌保存在同源 xmst 中；只读取、不跨站持久化。
    return {
      webId: /^\d{19}$/.test(webId) ? webId : '',
      msToken: storage?.getItem('xmst') ?? '',
    }
  } catch {
    return { webId: '', msToken: '' }
  }
}

function createBrowserFingerprint(runtime: DouyinRequestRuntime, platform: string): string {
  const screen = runtime.screen
  const innerWidth = positiveInteger(runtime.innerWidth, positiveInteger(screen?.width, 1920))
  const innerHeight = positiveInteger(runtime.innerHeight, positiveInteger(screen?.height, 1080))
  const outerWidth = positiveInteger(runtime.outerWidth, innerWidth)
  const outerHeight = positiveInteger(runtime.outerHeight, innerHeight)
  const screenWidth = positiveInteger(screen?.width, outerWidth)
  const screenHeight = positiveInteger(screen?.height, outerHeight)
  const availableWidth = positiveInteger(screen?.availWidth, screenWidth)
  const availableHeight = positiveInteger(screen?.availHeight, screenHeight)
  const colorDepth = positiveInteger(screen?.colorDepth, 24)
  const pixelDepth = positiveInteger(screen?.pixelDepth, colorDepth)

  return [
    innerWidth,
    innerHeight,
    outerWidth,
    outerHeight,
    finiteNumber(runtime.screenX, 0),
    finiteNumber(runtime.screenY, 0),
    0,
    0,
    screenWidth,
    screenHeight,
    availableWidth,
    availableHeight,
    innerWidth,
    innerHeight,
    colorDepth,
    pixelDepth,
    platform,
  ].join('|')
}

function parseBrowser(userAgent: string): {
  name: string
  version: string
  engineName: string
  engineVersion: string
} {
  const edge = /Edg\/([\d.]+)/.exec(userAgent)
  const chrome = /(?:Chrome|Chromium)\/([\d.]+)/.exec(userAgent)
  const firefox = /Firefox\/([\d.]+)/.exec(userAgent)
  const safari = /Version\/([\d.]+).*Safari\//.exec(userAgent)

  if (edge) {
    return {
      name: 'Edge',
      version: edge[1]!,
      engineName: 'Blink',
      engineVersion: chrome?.[1] ?? edge[1]!,
    }
  }
  if (chrome) {
    return {
      name: 'Chrome',
      version: chrome[1]!,
      engineName: 'Blink',
      engineVersion: chrome[1]!,
    }
  }
  if (firefox) {
    return {
      name: 'Firefox',
      version: firefox[1]!,
      engineName: 'Gecko',
      engineVersion: firefox[1]!,
    }
  }
  if (safari) {
    return {
      name: 'Safari',
      version: safari[1]!,
      engineName: 'WebKit',
      engineVersion: /AppleWebKit\/([\d.]+)/.exec(userAgent)?.[1] ?? safari[1]!,
    }
  }
  return { name: 'Chrome', version: '130.0.0.0', engineName: 'Blink', engineVersion: '130.0.0.0' }
}

function parseOperatingSystem(
  userAgent: string,
  browserPlatform?: string,
): { name: string; version: string; browserPlatform: string } {
  const windows = /Windows NT ([\d.]+)/.exec(userAgent)
  if (windows) {
    const version = windows[1] === '10.0' ? '10' : windows[1]!
    return { name: 'Windows', version, browserPlatform: browserPlatform || 'Win32' }
  }
  const mac = /Mac OS X ([\d_]+)/.exec(userAgent)
  if (mac) {
    return {
      name: 'Mac OS',
      version: mac[1]!.replaceAll('_', '.'),
      browserPlatform: browserPlatform || 'MacIntel',
    }
  }
  const android = /Android ([\d.]+)/.exec(userAgent)
  if (android) return { name: 'Android', version: android[1]!, browserPlatform: 'Linux armv8l' }
  if (/Linux/.test(userAgent)) {
    return { name: 'Linux', version: '', browserPlatform: browserPlatform || 'Linux x86_64' }
  }
  return { name: 'Windows', version: '10', browserPlatform: browserPlatform || 'Win32' }
}

function readDouyinCookies(runtime: DouyinRequestRuntime): Record<string, string> {
  const hostname = runtime.location?.hostname ?? ''
  if (hostname !== 'douyin.com' && !hostname.endsWith('.douyin.com')) return {}

  const cookies: Record<string, string> = {}
  for (const part of (runtime.document?.cookie ?? '').split(';')) {
    const separator = part.indexOf('=')
    if (separator < 0) continue
    const name = part.slice(0, separator).trim()
    if (!name) continue
    const rawValue = part.slice(separator + 1)
    try {
      cookies[name] = decodeURIComponent(rawValue)
    } catch {
      cookies[name] = rawValue
    }
  }
  return cookies
}

function readCapabilityCookie(value: string | undefined): string | undefined {
  if (value === undefined || value === '') return undefined
  if (value === '1' || value.toLowerCase() === 'true') return '1'
  if (value === '0' || value.toLowerCase() === 'false') return '0'
  return undefined
}

function readPositiveInteger(value: string | undefined): number | undefined {
  if (!value) return undefined
  const result = Number(value)
  return Number.isFinite(result) && result > 0 ? Math.floor(result) : undefined
}

function detectDashSupport(runtime: DouyinRequestRuntime): string {
  try {
    return runtime.MediaSource?.isTypeSupported('video/mp4; codecs="avc1.42E01E"') ? '1' : '0'
  } catch {
    return '0'
  }
}

function detectH265Support(runtime: DouyinRequestRuntime): string {
  try {
    const video = runtime.document?.createElement('video')
    const canPlay = video?.canPlayType('video/mp4; codecs="hvc1.1.6.L93.B0"')
    return canPlay ? '1' : '0'
  } catch {
    return '0'
  }
}

function positiveInteger(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) && Number(value) > 0 ? Math.floor(Number(value)) : fallback
}

function finiteNumber(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) ? Number(value) : fallback
}

function finiteNumberString(value: number | undefined, fallback: string): string {
  return Number.isFinite(value) ? String(value) : fallback
}

function normalizeRandom(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(Math.max(value, 0), 1 - Number.EPSILON)
}
