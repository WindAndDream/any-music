import { AppError } from '@any-music/core'
import type { AppErrorCode, HttpClient, HttpRequest, HttpResponse } from '@any-music/core'
import { ResponseTooLargeError } from '@any-music/music-workbench/media/response-too-large-error'
import { invoke } from '@tauri-apps/api/core'

const MAX_RESPONSE_METADATA_BYTES = 1024 * 1024

/** Four-byte big-endian JSON metadata length, bounded metadata, then unchanged body bytes. */
function decodeNativeResponse(buffer: ArrayBuffer, input: HttpRequest): HttpResponse {
  if (!(buffer instanceof ArrayBuffer) || buffer.byteLength < 4)
    throw new AppError('invalid-response', '原生响应帧无效。')
  const metadataLength = new DataView(buffer).getUint32(0)
  if (
    metadataLength === 0 ||
    metadataLength > MAX_RESPONSE_METADATA_BYTES ||
    metadataLength > buffer.byteLength - 4
  )
    throw new AppError('invalid-response', '原生响应元数据无效。')
  let metadata: unknown
  try {
    metadata = JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array(buffer, 4, metadataLength)),
    )
  } catch {
    throw new AppError('invalid-response', '原生响应元数据无效。')
  }
  if (!metadata || typeof metadata !== 'object') throw new AppError('invalid-response')
  const { status, statusText, headers, responseType } = metadata as Record<string, unknown>
  if (
    typeof status !== 'number' ||
    !Number.isInteger(status) ||
    status < 100 ||
    status > 999 ||
    typeof statusText !== 'string' ||
    typeof headers !== 'string' ||
    responseType !== (input.responseType === 'bytes' ? 'bytes' : 'text')
  )
    throw new AppError('invalid-response', '原生响应元数据无效。')
  const body = new Uint8Array(buffer, 4 + metadataLength)
  if (body.byteLength > Math.min(input.maxResponseBytes ?? 16 * 1024 * 1024, 512 * 1024 * 1024))
    throw new AppError('invalid-response', '原生响应超过读取预算。')
  return {
    status,
    statusText,
    headers,
    // Preserve Rust's lossy UTF-8 text semantics, including a leading BOM; bytes share the IPC buffer.
    body:
      responseType === 'bytes' ? body : new TextDecoder('utf-8', { ignoreBOM: true }).decode(body),
  }
}

const ERROR_CODES = new Set<AppErrorCode>([
  'network-error',
  'request-timeout',
  'operation-cancelled',
  'verification-required',
  'not-authenticated',
  'invalid-input',
  'limit-exceeded',
  'invalid-response',
  'pagination-unavailable',
  'upstream-error',
  'account-unavailable',
  'unknown',
  'unsupported-operation',
  'storage-read-failed',
  'storage-write-failed',
])
export function mapNativeError(value: unknown): Error {
  const message = String(value)
  const delimiter = message.indexOf(':')
  let code = message.slice(0, delimiter) as AppErrorCode
  if (code === ('expired' as AppErrorCode)) code = 'not-authenticated'
  if (code === ('response-too-large' as AppErrorCode)) {
    try {
      const details = JSON.parse(message.slice(delimiter + 1)) as {
        maxResponseBytes: number
        finalUrl?: string
      }
      return new ResponseTooLargeError(details.maxResponseBytes, details.finalUrl)
    } catch {
      return new AppError('limit-exceeded', '响应超过读取预算。')
    }
  }
  return new AppError(
    ERROR_CODES.has(code) ? code : 'unknown',
    delimiter > 0 ? message.slice(delimiter + 1) : message,
  )
}

/** A client is bound to one account for the whole source operation and its pages. */
export function createNativeHttpClient(accountId?: string): HttpClient {
  return {
    async request(input: HttpRequest): Promise<HttpResponse> {
      if (input.cancellation?.isCancelled()) throw new AppError('operation-cancelled')
      const requestId = crypto.randomUUID()
      const { cancellation, ...request } = input
      if (
        request.url.startsWith('http://127.0.0.1:') &&
        new URL(request.url).pathname.startsWith('/media/')
      )
        request.credentials = 'omit'
      const pending = invoke<ArrayBuffer>('http_request', {
        request: { ...request, requestId, accountId },
      })
      const detach = cancellation?.subscribe(() => {
        void invoke('cancel_request', { requestId }).catch(() => {})
      })
      if (cancellation?.isCancelled()) void invoke('cancel_request', { requestId }).catch(() => {})
      try {
        const response = await pending
        if (cancellation?.isCancelled()) throw new AppError('operation-cancelled')
        return decodeNativeResponse(response, request)
      } catch (error) {
        if (cancellation?.isCancelled()) throw new AppError('operation-cancelled')
        if (error instanceof AppError) throw error
        throw mapNativeError(error)
      } finally {
        detach?.()
      }
    },
  }
}
