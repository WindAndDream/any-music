import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const requestMock = vi.hoisted(() => vi.fn())

vi.mock('$', () => ({ GM_xmlhttpRequest: requestMock }))

import { GmResponseTooLargeError } from '@/platform/http/gm-errors'
import { gmHttpClient } from '@/platform/http/gm-http-client'

describe('gmHttpClient', () => {
  beforeEach(() => requestMock.mockReset())
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('reports offline failures as a recoverable network error', async () => {
    vi.stubGlobal('navigator', { onLine: false })
    requestMock.mockReturnValueOnce({ abort: vi.fn() })
    const requestPromise = gmHttpClient.request({ url: 'https://api.example/search' })

    requestMock.mock.calls[0]?.[0].onerror({ status: 0, statusText: '' })

    await expect(requestPromise).rejects.toMatchObject({
      code: 'network-error',
      statusCode: 'AM-4001',
      message: '当前设备处于离线状态，请联网后重试。',
    })
  })

  it('treats a status-zero load callback as a network failure', async () => {
    requestMock.mockReturnValueOnce({ abort: vi.fn() })
    const requestPromise = gmHttpClient.request({ url: 'https://api.example/search' })

    requestMock.mock.calls[0]?.[0].onload({ status: 0, statusText: '' })

    await expect(requestPromise).rejects.toMatchObject({ code: 'network-error' })
  })

  it('does not report a deliberate cancellation as a network failure', async () => {
    let cancelRequest: (() => void) | undefined
    const requestHandle = {
      abort: () => requestMock.mock.calls[0]?.[0].onerror({ status: 0, statusText: '' }),
    }
    requestMock.mockReturnValueOnce(requestHandle)
    const requestPromise = gmHttpClient.request({
      url: 'https://api.example/search',
      cancellation: {
        isCancelled: () => false,
        subscribe(listener) {
          cancelRequest = listener
          return () => undefined
        },
      },
    })

    cancelRequest?.()

    await expect(requestPromise).rejects.toThrow('Userscript request aborted')
  })

  it('uses the low-latency fetch transport for unbounded text API responses', () => {
    requestMock.mockReturnValueOnce({ abort: vi.fn() })

    void gmHttpClient.request({
      url: 'https://api.example/session',
      credentials: 'include',
    })

    expect(requestMock.mock.calls[0]?.[0]).toMatchObject({
      anonymous: false,
      fetch: true,
      responseType: 'text',
    })
  })

  it('keeps byte responses on XHR so progress limits remain enforceable', () => {
    requestMock.mockReturnValueOnce({ abort: vi.fn() })

    void gmHttpClient.request({
      url: 'https://media.example/audio',
      credentials: 'include',
      responseType: 'bytes',
      maxResponseBytes: 1024,
    })

    expect(requestMock.mock.calls[0]?.[0]).not.toHaveProperty('fetch')
  })

  it('enforces timeout in the adapter when fetch transport ignores details.timeout', async () => {
    vi.useFakeTimers()
    const requestHandle = { abort: vi.fn() }
    requestMock.mockReturnValueOnce(requestHandle)
    const responsePromise = gmHttpClient.request({
      url: 'https://api.example/slow',
      credentials: 'include',
      timeoutMs: 250,
    })
    const rejection = expect(responsePromise).rejects.toMatchObject({
      code: 'request-timeout',
      statusCode: 'AM-4003',
    })

    await vi.advanceTimersByTimeAsync(250)

    await rejection
    expect(requestHandle.abort).toHaveBeenCalledOnce()
  })

  it('aborts an oversized response at headers and preserves its ephemeral final URL', async () => {
    const requestHandle = { abort: vi.fn() }
    requestMock.mockReturnValueOnce(requestHandle)
    const responsePromise = gmHttpClient.request({
      url: 'https://media.example/redirect',
      credentials: 'include',
      responseType: 'bytes',
      maxResponseBytes: 1024,
    })
    const request = requestMock.mock.calls[0]?.[0]

    request.onreadystatechange({
      readyState: 2,
      status: 200,
      statusText: 'OK',
      responseHeaders: 'Content-Length: 2048\r\n',
      finalUrl: 'https://cdn.example/ephemeral/media.mp4?token=test',
    })

    await expect(responsePromise).rejects.toMatchObject({
      name: 'GmResponseTooLargeError',
      finalUrl: 'https://cdn.example/ephemeral/media.mp4?token=test',
    } satisfies Partial<GmResponseTooLargeError>)
    expect(requestHandle.abort).toHaveBeenCalledOnce()
  })
})
