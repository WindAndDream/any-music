import { unsafeWindow } from '$'
import type {
  DouyinPageSigningRequest,
  DouyinPageSignature,
  DouyinPageSignatureProvider,
} from '@any-music/plugin-source-douyin/contracts'

import {
  DOUYIN_SIGNATURE_BEGIN_EVENT,
  DOUYIN_SIGNATURE_CANCEL_EVENT,
  DOUYIN_SIGNATURE_RESULT_EVENT,
} from './douyin-page-signature-bridge'
export type {
  DouyinPageSigningRequest,
  DouyinPageSignature,
  DouyinPageSignatureProvider,
} from '@any-music/plugin-source-douyin/contracts'

interface DouyinPageSigningRuntime {
  document: Document
  CustomEvent: typeof CustomEvent
}

const SIGNATURE_TIMEOUT_MS = 5_000

/**
 * 使用隔离 BDMS 桥生成动态安全字段。抖音宿主页复用当前 SDK，其他宿主页使用无同源
 * 权限且禁止联网的沙箱；签名探测不会产生 API 请求，实际数据仍由 GM HTTP 适配器获取。
 */
export function createDouyinPageSignatureProvider(
  runtime: DouyinPageSigningRuntime = unsafeWindow as unknown as DouyinPageSigningRuntime,
): DouyinPageSignatureProvider {
  return (request) => signWithCurrentDouyinPage(runtime, request)
}

function signWithCurrentDouyinPage(
  runtime: DouyinPageSigningRuntime,
  request: DouyinPageSigningRequest,
): Promise<DouyinPageSignature | undefined> {
  if (!isDouyinRequest(request.url)) {
    return Promise.resolve(undefined)
  }

  return new Promise((resolve) => {
    const probeId = createProbeId()
    let timeoutId: ReturnType<typeof setTimeout> | undefined
    const finish = (signature?: DouyinPageSignature): void => {
      if (timeoutId === undefined) return
      clearTimeout(timeoutId)
      timeoutId = undefined
      runtime.document.removeEventListener(DOUYIN_SIGNATURE_RESULT_EVENT, handleResult)
      dispatchBridgeEvent(runtime, DOUYIN_SIGNATURE_CANCEL_EVENT, { id: probeId })
      resolve(signature)
    }
    const handleResult = (event: Event): void => {
      try {
        const detail = JSON.parse(String((event as CustomEvent).detail ?? '')) as Partial<
          DouyinPageSignature & { id: string }
        >
        if (detail.id !== probeId || typeof detail.aBogus !== 'string') return
        finish({
          msToken: typeof detail.msToken === 'string' ? detail.msToken : '',
          aBogus: detail.aBogus,
          timestamp: typeof detail.timestamp === 'string' ? detail.timestamp : undefined,
          webSignature: typeof detail.webSignature === 'string' ? detail.webSignature : undefined,
          webExpire: typeof detail.webExpire === 'string' ? detail.webExpire : undefined,
        })
      } catch {
        // 只接受主世界桥发送的 JSON 字符串；畸形或旁路事件直接忽略。
      }
    }

    runtime.document.addEventListener(DOUYIN_SIGNATURE_RESULT_EVENT, handleResult)
    timeoutId = setTimeout(() => finish(), SIGNATURE_TIMEOUT_MS)
    dispatchBridgeEvent(runtime, DOUYIN_SIGNATURE_BEGIN_EVENT, {
      id: probeId,
      url: request.url,
      method: request.method,
      body: request.body ?? '',
    })
  })
}

function dispatchBridgeEvent(
  runtime: DouyinPageSigningRuntime,
  type: string,
  detail: Readonly<Record<string, string>>,
): void {
  runtime.document.dispatchEvent(new runtime.CustomEvent(type, { detail: JSON.stringify(detail) }))
}

let nextProbeId = 1

function createProbeId(): string {
  const id = nextProbeId++
  return `am-${Date.now().toString(36)}-${id.toString(36)}`
}

function isDouyinRequest(rawUrl: string): boolean {
  try {
    const hostname = new URL(rawUrl).hostname
    return hostname === 'douyin.com' || hostname.endsWith('.douyin.com')
  } catch {
    return false
  }
}
