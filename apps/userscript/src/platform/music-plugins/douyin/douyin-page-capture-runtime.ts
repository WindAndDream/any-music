import {
  GM_addValueChangeListener,
  GM_deleteValue,
  GM_openInTab,
  GM_removeValueChangeListener,
  GM_setValue,
  unsafeWindow,
} from '$'
import { AppError } from '@any-music/core'
import type { CancellationSignal } from '@any-music/core'
import type { DouyinCursorAwemeData } from '@any-music/plugin-source-douyin/contracts'

import {
  clearDouyinPageBridgeSessionTask,
  createDouyinPageBridgeFailure,
  createDouyinPageBridgeResultKey,
  createDouyinPageBridgeSuccess,
  createDouyinPageBridgeUrl,
  parseDouyinPageBridgeMessage,
  parseDouyinPageBridgeTask,
  readDouyinPageBridgeSessionTask,
  saveDouyinPageBridgeSessionTask,
} from './douyin-page-bridge'
import type {
  DouyinPageBridgeFailureReason,
  DouyinPageBridgeMessage,
  DouyinPageBridgeTask,
} from './douyin-page-bridge'
import {
  DouyinFallbackProtectedPageSource,
  DouyinPageCaptureStore,
  installDouyinPageCapture as installCapture,
} from './douyin-page-capture'
import type { DouyinProtectedAwemeKind } from './douyin-page-capture'
import { installDouyinMainWorldSignatureBridge } from './douyin-page-signature-bridge'

// unsafeWindow 只留在平台运行时组合点；捕获存储与解析逻辑保持可独立测试。
export const douyinPageCapture = new DouyinPageCaptureStore(() => unsafeWindow.location.href)
export const douyinProtectedPageSource = new DouyinFallbackProtectedPageSource(
  douyinPageCapture,
  requestFallbackPage,
)

const BRIDGE_WAIT_MS = 5 * 60_000
const RESULT_RETENTION_MS = 10_000
const CAPTURE_POLL_MS = 350
const FIRST_SCROLL_DELAY_MS = 1_500
const SCROLL_INTERVAL_MS = 750
const EMBEDDED_VERIFICATION_GRACE_MS = 4_000

/**
 * 在抖音真实 window 上安装 document-start 响应监听。返回 true 表示当前是 API 未正确
 * 响应后开启的页面回退任务；调用方应跳过 Any Music UI，让抖音页面自行请求目标列表。
 */
export function installDouyinPageCapture(): boolean {
  installDouyinMainWorldSignatureBridge(unsafeWindow.document)
  installCapture(unsafeWindow, douyinPageCapture)
  const task = readPageCaptureTask()
  if (!task) return false
  void runPageCapture(task)
  return true
}

function readPageCaptureTask(): DouyinPageBridgeTask | undefined {
  const fragmentTask = parseDouyinPageBridgeTask(unsafeWindow.location.href)
  try {
    if (fragmentTask) {
      saveDouyinPageBridgeSessionTask(
        unsafeWindow.sessionStorage,
        fragmentTask,
        Date.now() + BRIDGE_WAIT_MS + RESULT_RETENTION_MS,
      )
      return fragmentTask
    }
    return readDouyinPageBridgeSessionTask(
      unsafeWindow.sessionStorage,
      unsafeWindow.location.href,
      Date.now(),
    )
  } catch {
    // sessionStorage 被浏览器禁用时仍可在未跳转的原始 fragment 页面完成验证。
    return fragmentTask
  }
}

async function requestFallbackPage(
  kind: DouyinProtectedAwemeKind,
  cursor: number,
  cancellation?: CancellationSignal,
): Promise<DouyinCursorAwemeData | undefined> {
  if (cancellation?.isCancelled()) throw new AppError('operation-cancelled')
  const task: DouyinPageBridgeTask = {
    version: 1,
    taskId: createTaskId(),
    kind,
    cursor,
  }
  const resultKey = createDouyinPageBridgeResultKey(task.taskId)
  GM_deleteValue(resultKey)

  return new Promise((resolve, reject) => {
    let isSettled = false
    let tab: ReturnType<typeof GM_openInTab> | undefined
    let timer: ReturnType<typeof setTimeout> | undefined
    let detachCancellation: (() => void) | undefined

    const finish = (
      result: DouyinCursorAwemeData | Error | undefined,
      shouldCloseTab: boolean,
    ): void => {
      if (isSettled) return
      isSettled = true
      detachCancellation?.()
      if (timer) clearTimeout(timer)
      GM_removeValueChangeListener(listenerId)
      GM_deleteValue(resultKey)
      // 成功读取列表后才关闭；页面失败或超时必须保留给用户继续排查。
      if (shouldCloseTab && tab && !tab.closed) tab.close()
      if (result instanceof Error) reject(result)
      else resolve(result)
    }

    const listenerId = GM_addValueChangeListener(resultKey, (_name, _oldValue, newValue) => {
      const message = parseDouyinPageBridgeMessage(newValue, task)
      if (!message) return
      if (message.status === 'success') finish(message.page, true)
      else finish(new Error(pageFallbackFailureMessage(message.reason)), false)
    })
    detachCancellation = cancellation?.subscribe(() =>
      finish(new AppError('operation-cancelled'), true),
    )
    if (isSettled) return

    try {
      tab = GM_openInTab(createDouyinPageBridgeUrl(task), {
        // 回退页在后台加载和捕获；只有用户主动切过去时才会离开当前工作页面。
        active: false,
        insert: true,
        setParent: true,
      })
      // GM tab control 不是 DOM EventTarget，只提供 onclose 属性。
      // oxlint-disable-next-line unicorn/prefer-add-event-listener
      tab.onclose = () => finish(new Error('抖音页面已关闭，本次导入已停止。'), false)
    } catch (error) {
      finish(
        new Error('无法打开抖音页面，请确认浏览器允许篡改猴打开标签页。', {
          cause: error,
        }),
        false,
      )
      return
    }

    timer = setTimeout(
      () => finish(new Error(pageFallbackFailureMessage('timeout')), false),
      BRIDGE_WAIT_MS + 2_000,
    )
  })
}

async function runPageCapture(task: DouyinPageBridgeTask): Promise<void> {
  const startedAt = Date.now()
  const deadline = startedAt + BRIDGE_WAIT_MS
  let nextScrollAt = startedAt + FIRST_SCROLL_DELAY_MS
  let lastUnavailableReason: DouyinPageBridgeFailureReason | undefined

  while (Date.now() < deadline) {
    const page = douyinPageCapture.readCapturedAwemePage(task.kind, task.cursor)
    if (page) {
      publishBridgeResult(task, createDouyinPageBridgeSuccess(task, page))
      return
    }

    const unavailableReason = detectUnavailablePage(
      Date.now() - startedAt >= EMBEDDED_VERIFICATION_GRACE_MS,
    )
    if (unavailableReason) {
      // 风控页和登录框由用户手动解决；可见期间暂停滚动，消失后自动继续捕获目标分页。
      lastUnavailableReason = unavailableReason
      // oxlint-disable-next-line no-await-in-loop -- 等待用户完成当前标签页中的安全验证。
      await delay(CAPTURE_POLL_MS)
      continue
    }

    if (Date.now() >= nextScrollAt) {
      advanceProtectedPage()
      nextScrollAt = Date.now() + SCROLL_INTERVAL_MS
    }
    // oxlint-disable-next-line no-await-in-loop -- 工作页必须等待网页按游标惰性加载，不能并行滚动。
    await delay(CAPTURE_POLL_MS)
  }

  publishBridgeResult(task, createDouyinPageBridgeFailure(task, lastUnavailableReason ?? 'timeout'))
}

function publishBridgeResult(task: DouyinPageBridgeTask, message: DouyinPageBridgeMessage): void {
  const key = createDouyinPageBridgeResultKey(task.taskId)
  GM_setValue(key, message)
  if (message.status === 'success') {
    try {
      clearDouyinPageBridgeSessionTask(unsafeWindow.sessionStorage)
    } catch {
      // 隐私模式可禁用 sessionStorage；GM 结果仍可正常回传。
    }
  }
  // 只有成功结果自动关页；失败页应保留给用户，GM value 仍需按时清理。
  setTimeout(() => {
    GM_deleteValue(key)
    if (message.status === 'success') unsafeWindow.close()
  }, RESULT_RETENTION_MS)
}

function advanceProtectedPage(): void {
  const document = unsafeWindow.document
  const distance = Math.max(Math.floor(unsafeWindow.innerHeight * 0.85), 720)
  const contentLink = document.querySelector<HTMLAnchorElement>(
    'a[href*="/video/"], a[href*="/note/"]',
  )
  const nestedScroller = findScrollableAncestor(contentLink)
  const scrollingElement = document.scrollingElement
  const target = nestedScroller ?? scrollingElement

  if (target instanceof HTMLElement) {
    target.scrollTop = Math.min(target.scrollTop + distance, target.scrollHeight)
    target.dispatchEvent(new Event('scroll', { bubbles: false }))
  }
  // 部分抖音布局只观察 window 滚动；与内部滚动容器同时推进仍只会触发正常页面分页。
  unsafeWindow.scrollBy({ top: distance, behavior: 'instant' })
}

function findScrollableAncestor(element: Element | null): HTMLElement | undefined {
  let current = element?.parentElement
  while (current) {
    if (current.clientHeight >= 240 && current.scrollHeight > current.clientHeight + 120) {
      const overflowY = unsafeWindow.getComputedStyle(current).overflowY
      if (overflowY === 'auto' || overflowY === 'scroll') return current
    }
    current = current.parentElement
  }
  return undefined
}

function detectUnavailablePage(
  canInspectEmbeddedUi: boolean,
): DouyinPageBridgeFailureReason | undefined {
  const href = unsafeWindow.location.href.toLowerCase()
  if (href.includes('captcha') || href.includes('/verify')) return 'verification-required'
  if (!canInspectEmbeddedUi) return undefined

  const document = unsafeWindow.document
  const captchaElement = document.querySelector(
    'iframe[src*="captcha"], [class*="captcha_verify"], [id*="captcha-verify"]',
  )
  if (captchaElement && isVisible(captchaElement)) {
    return 'verification-required'
  }
  const loginElement = document.querySelector('[data-e2e="login-modal"], [class*="login-panel"]')
  if (loginElement && isVisible(loginElement)) {
    return 'sign-in-required'
  }
  return undefined
}

function isVisible(element: Element): boolean {
  const bounds = element.getBoundingClientRect()
  if (
    bounds.width < 8 ||
    bounds.height < 8 ||
    bounds.right <= 0 ||
    bounds.bottom <= 0 ||
    bounds.left >= unsafeWindow.innerWidth ||
    bounds.top >= unsafeWindow.innerHeight
  ) {
    return false
  }

  let current: Element | null = element
  while (current) {
    const style = unsafeWindow.getComputedStyle(current)
    if (
      style.display === 'none' ||
      style.visibility === 'hidden' ||
      Number(style.opacity || 1) <= 0
    ) {
      return false
    }
    current = current.parentElement
  }
  return true
}

function pageFallbackFailureMessage(reason: DouyinPageBridgeFailureReason): string {
  if (reason === 'sign-in-required') return '抖音页面仍未登录；该标签页已保留。'
  if (reason === 'verification-required') {
    return '抖音安全验证尚未完成；该标签页已保留，请完成后重新导入。'
  }
  return '抖音页面等待超时；该标签页已保留，请确认列表已正常显示后重新导入。'
}

function delay(durationMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, durationMs))
}

function createTaskId(): string {
  // randomUUID 只在 secure context 保证存在；getRandomValues 也能覆盖脚本挂载到 HTTP 宿主页的情况。
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80
  const hex = [...bytes].map((value) => value.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
