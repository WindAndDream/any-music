import { AppError } from '@any-music/core'
import { CancellationSource } from '@any-music/network-routing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createNativeHttpClient } from '@/platform/native-http'

import fixture from '../fixtures/native-http-response.json'

const native = vi.hoisted(() => ({ invoke: vi.fn() }))
vi.mock('@tauri-apps/api/core', () => ({ invoke: native.invoke }))
beforeEach(() => {
  native.invoke.mockReset()
})

function frame(
  body: Uint8Array,
  metadata: unknown = {
    status: 200,
    statusText: 'OK',
    headers: '',
    responseType: 'text',
  },
): ArrayBuffer {
  const encoded = new TextEncoder().encode(JSON.stringify(metadata))
  const bytes = new Uint8Array(4 + encoded.length + body.length)
  new DataView(bytes.buffer).setUint32(0, encoded.length)
  bytes.set(encoded, 4)
  bytes.set(body, 4 + encoded.length)
  return bytes.buffer
}

describe('native account HTTP', () => {
  it('keeps account identity, Range and bounds while using a view into the raw IPC buffer', async () => {
    // Rust tests assert that the same fixture is raw IPC, including Unicode metadata.
    const buffer = Uint8Array.from(Buffer.from(fixture.frameHex, 'hex')).buffer
    native.invoke.mockResolvedValue(buffer)
    const response = await createNativeHttpClient('account-a').request({
      url: 'https://api.bilibili.com/data',
      credentials: 'include',
      responseType: 'bytes',
      headers: { Range: 'bytes=0-3' },
      timeoutMs: 1234,
      maxResponseBytes: 4,
    })
    expect(response).toMatchObject({
      status: fixture.metadata.status,
      statusText: fixture.metadata.statusText,
      headers: fixture.metadata.headers,
      body: Uint8Array.from(Buffer.from(fixture.bodyHex, 'hex')),
    })
    expect((response.body as Uint8Array).buffer).toBe(buffer)
    expect(native.invoke).toHaveBeenCalledExactlyOnceWith('http_request', {
      request: expect.objectContaining({
        accountId: 'account-a',
        credentials: 'include',
        maxResponseBytes: 4,
        timeoutMs: 1234,
        headers: { Range: 'bytes=0-3' },
      }),
    })
  })
  it('sends cancellation and rejects a late successful result', async () => {
    let finish!: (value: unknown) => void
    native.invoke.mockImplementation((command: string) =>
      command === 'http_request'
        ? new Promise((resolve) => {
            finish = resolve
          })
        : Promise.resolve(),
    )
    const source = new CancellationSource()
    const request = createNativeHttpClient('a').request({
      url: 'https://www.douyin.com/api',
      cancellation: source.signal,
    })
    source.cancel()
    finish(frame(new TextEncoder().encode('old')))
    await expect(request).rejects.toMatchObject({ code: 'operation-cancelled' })
    expect(native.invoke).toHaveBeenCalledWith('cancel_request', expect.any(Object))
  })
  it('keeps bounded redirect recovery inside the native account media grant', async () => {
    native.invoke.mockRejectedValue(
      'response-too-large:{"maxResponseBytes":3,"finalUrl":"http://127.0.0.1:1234/media/retry"}',
    )
    await expect(
      createNativeHttpClient().request({
        url: 'http://127.0.0.1:1234/media/original',
        maxResponseBytes: 3,
      }),
    ).rejects.toMatchObject({
      name: 'ResponseTooLargeError',
      finalUrl: 'http://127.0.0.1:1234/media/retry',
    })
    native.invoke.mockRejectedValue('limit-exceeded:请求并发超过预算。')
    await expect(
      createNativeHttpClient().request({ url: 'https://example.com/' }),
    ).rejects.toMatchObject({ code: 'limit-exceeded' })
  })
  it('opens no request when already cancelled and leaves local media credentials in its grant', async () => {
    const source = new CancellationSource()
    source.cancel()
    await expect(
      createNativeHttpClient().request({
        url: 'https://www.douyin.com/',
        cancellation: source.signal,
      }),
    ).rejects.toMatchObject({ code: 'operation-cancelled' })
    expect(native.invoke).not.toHaveBeenCalled()
    native.invoke.mockResolvedValue(frame(new TextEncoder().encode('media')))
    await createNativeHttpClient().request({
      url: 'http://127.0.0.1:1234/media/token',
      credentials: 'include',
    })
    expect(native.invoke).toHaveBeenCalledWith('http_request', {
      request: expect.objectContaining({ credentials: 'omit' }),
    })
  })

  it.each([
    { bytes: new TextEncoder().encode('歌曲🎵'), text: '歌曲🎵' },
    { bytes: new Uint8Array([0xef, 0xbb, 0xbf, 0x61]), text: '\uFEFFa' },
    { bytes: new Uint8Array([0x61, 0xff, 0x62]), text: 'a\uFFFDb' },
    { bytes: new Uint8Array(), text: '' },
  ])('preserves text UTF-8 semantics for $text', async ({ bytes, text }) => {
    native.invoke.mockResolvedValue(
      frame(bytes, {
        status: 404,
        statusText: 'Not Found',
        headers: 'x-public: yes',
        responseType: 'text',
      }),
    )
    await expect(
      createNativeHttpClient('a').request({ url: 'https://api.bilibili.com/' }),
    ).resolves.toMatchObject({
      status: 404,
      statusText: 'Not Found',
      headers: 'x-public: yes',
      body: text,
    })
  })

  it('preserves nonstandard three-digit statuses accepted by the native HTTP client', async () => {
    native.invoke.mockResolvedValue(
      frame(new Uint8Array(), {
        status: 700,
        statusText: '',
        headers: '',
        responseType: 'text',
      }),
    )
    await expect(
      createNativeHttpClient().request({ url: 'https://api.bilibili.com/' }),
    ).resolves.toMatchObject({ status: 700, body: '' })
  })

  it.each([
    'network-error:late network failure',
    'request-timeout:late timeout',
    'response-too-large:{"maxResponseBytes":3,"finalUrl":"http://127.0.0.1:1234/media/retry"}',
    new AppError('verification-required'),
  ])('reports cancellation instead of a late rejection: %s', async (error) => {
    let fail!: (value: unknown) => void
    native.invoke.mockImplementation((command: string) =>
      command === 'http_request'
        ? new Promise((_, reject) => {
            fail = reject
          })
        : Promise.resolve(),
    )
    const source = new CancellationSource()
    const pending = createNativeHttpClient('a').request({
      url: 'https://api.bilibili.com/',
      cancellation: source.signal,
    })
    const assertion = expect(pending).rejects.toMatchObject({ code: 'operation-cancelled' })
    source.cancel()
    fail(error)
    await assertion
  })

  it.each([false, true])('detaches cancellation after native rejection=%s', async (reject) => {
    const detach = vi.fn()
    native.invoke.mockImplementation(() =>
      reject
        ? Promise.reject('network-error:upstream detail')
        : Promise.resolve(frame(new TextEncoder().encode('ok'))),
    )
    const pending = createNativeHttpClient('a').request({
      url: 'https://api.bilibili.com/',
      cancellation: { isCancelled: () => false, subscribe: () => detach },
    })
    if (reject)
      await expect(pending).rejects.toMatchObject({
        code: 'network-error',
        message: 'upstream detail',
      })
    else await expect(pending).resolves.toMatchObject({ body: 'ok' })
    expect(detach).toHaveBeenCalledTimes(1)
    expect(native.invoke).toHaveBeenCalledTimes(1)
  })

  it('retains account identity and fresh request IDs over successive requests', async () => {
    native.invoke.mockResolvedValue(frame(new Uint8Array()))
    const client = createNativeHttpClient('fixed-account')
    await client.request({ url: 'https://api.bilibili.com/?page=1' })
    await client.request({ url: 'https://api.bilibili.com/?page=2' })
    const requests = native.invoke.mock.calls.map(([, args]) => args.request)
    expect(requests).toHaveLength(2)
    expect(requests.every((request) => request.accountId === 'fixed-account')).toBe(true)
    expect(new Set(requests.map((request) => request.requestId)).size).toBe(2)
  })

  it('decodes against the sent request even if the caller later changes its input', async () => {
    let finish!: (value: ArrayBuffer) => void
    native.invoke.mockImplementation(
      () =>
        new Promise<ArrayBuffer>((resolve) => {
          finish = resolve
        }),
    )
    const input = {
      url: 'https://api.bilibili.com/',
      responseType: 'bytes' as 'bytes' | 'text',
      maxResponseBytes: 4,
    }
    const pending = createNativeHttpClient('a').request(input)
    input.responseType = 'text'
    input.maxResponseBytes = 0
    finish(Uint8Array.from(Buffer.from(fixture.frameHex, 'hex')).buffer)
    await expect(pending).resolves.toMatchObject({ body: new Uint8Array([0, 255, 128, 1]) })
  })

  it.each([
    ['old JSON envelope', { status: 200, body: [1, 2, 3] }],
    ['short prefix', new ArrayBuffer(3)],
    ['empty metadata', new ArrayBuffer(4)],
    ['truncated metadata', new Uint8Array([0, 0, 0, 2, 0x7b]).buffer],
    ['oversized metadata length', new Uint8Array([0, 0x10, 0, 1]).buffer],
    ['invalid UTF-8 metadata', new Uint8Array([0, 0, 0, 1, 0xff]).buffer],
    ['invalid JSON metadata', new Uint8Array([0, 0, 0, 1, 0x7b]).buffer],
    ['non-object metadata', frame(new Uint8Array(), null)],
    [
      'invalid status',
      frame(new Uint8Array(), { status: 1000, statusText: '', headers: '', responseType: 'text' }),
    ],
    [
      'invalid header type',
      frame(new Uint8Array(), { status: 200, statusText: '', headers: [], responseType: 'text' }),
    ],
    [
      'wrong response type',
      frame(new Uint8Array(), { status: 200, statusText: '', headers: '', responseType: 'bytes' }),
    ],
    ['missing metadata fields', frame(new Uint8Array(), {})],
  ])('rejects %s', async (_, value) => {
    native.invoke.mockResolvedValue(value)
    await expect(
      createNativeHttpClient().request({ url: 'https://api.bilibili.com/' }),
    ).rejects.toMatchObject({ code: 'invalid-response' })
  })

  it('rejects a delivered frame whose body exceeds the requested byte budget', async () => {
    native.invoke.mockResolvedValue(frame(new Uint8Array([1, 2])))
    await expect(
      createNativeHttpClient().request({ url: 'https://api.bilibili.com/', maxResponseBytes: 1 }),
    ).rejects.toMatchObject({ code: 'invalid-response' })
  })
})
