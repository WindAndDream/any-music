import { GM_cookie } from '$'
import type {
  DouyinTargetCookieState,
  DouyinTargetCookieStateProvider,
} from '@any-music/plugin-source-douyin/contracts'
export type {
  DouyinTargetCookieState,
  DouyinTargetCookieStateProvider,
} from '@any-music/plugin-source-douyin/contracts'

interface DouyinCookieReader {
  list: typeof GM_cookie.list
}

const COOKIE_READ_TIMEOUT_MS = 1_500
const EMPTY_COOKIE_STATE: DouyinTargetCookieState = { uifid: '', verifyFp: '' }

/**
 * 从 Tampermonkey 的目标域 Cookie API 读取本次请求需要的同站身份字段。值只存在于当前
 * 请求内存，不写入 GM value、日志或页面 DOM，因而跨站宿主页也不会持久化账号标识。
 */
export function createDouyinTargetCookieStateProvider(
  cookieReader: DouyinCookieReader = GM_cookie,
): DouyinTargetCookieStateProvider {
  return () =>
    new Promise((resolve) => {
      let isSettled = false
      const finish = (state = EMPTY_COOKIE_STATE): void => {
        if (isSettled) return
        isSettled = true
        clearTimeout(timeoutId)
        resolve(state)
      }
      const timeoutId = setTimeout(() => finish(), COOKIE_READ_TIMEOUT_MS)

      try {
        cookieReader.list({ url: 'https://www.douyin.com/' }, (cookies, error) => {
          if (error || !Array.isArray(cookies)) {
            finish()
            return
          }
          const read = (name: string): string =>
            cookies.find((cookie) => cookie.name === name)?.value ?? ''
          finish({
            uifid: read('UIFID') || read('UIFID_TEMP'),
            verifyFp: read('s_v_web_id'),
          })
        })
      } catch {
        finish()
      }
    })
}
