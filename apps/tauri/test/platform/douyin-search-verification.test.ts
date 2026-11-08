import { CancellationSource } from '@any-music/network-routing'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { verifyDouyinSearch } from '@/platform/douyin-search-verification'

const native = vi.hoisted(() => ({ invoke: vi.fn() }))
vi.mock('@tauri-apps/api/core', () => ({ invoke: native.invoke }))
const response = (data: unknown) => ({
  status: 200,
  statusText: '',
  headers: '',
  body: Array.from(new TextEncoder().encode(JSON.stringify(data))),
})
beforeAll(async () => {
  // Module transformation is test preparation, outside the native verification clock.
  await import('@any-music/plugin-source-douyin/runtime')
})
beforeEach(() => {
  vi.useFakeTimers()
  native.invoke.mockReset()
})
afterEach(() => vi.useRealTimers())

describe('explicit account search verification', () => {
  it('times out with scoped cleanup and permits a later verification attempt', async () => {
    native.invoke.mockImplementation(async (command: string) =>
      command === 'poll_douyin_search_verification' ? null : undefined,
    )
    const pending = verifyDouyinSearch('account-a', '夜曲')
    const rejected = expect(pending).rejects.toMatchObject({ code: 'request-timeout' })
    await vi.waitFor(() =>
      expect(
        native.invoke.mock.calls.some(([name]) => name === 'poll_douyin_search_verification'),
      ).toBe(true),
    )
    await vi.advanceTimersByTimeAsync(10 * 60_000 + 1000)
    await rejected
    expect(native.invoke).toHaveBeenLastCalledWith(
      'end_douyin_search_verification',
      expect.objectContaining({ accountId: 'account-a', completed: false }),
    )
    native.invoke.mockImplementation(async (command: string) =>
      command === 'poll_douyin_search_verification'
        ? response({ status_code: 0, data: [], has_more: 0 })
        : undefined,
    )
    await verifyDouyinSearch('account-a', '夜曲')
    expect(native.invoke).toHaveBeenLastCalledWith(
      'end_douyin_search_verification',
      expect.objectContaining({ accountId: 'account-a', completed: true }),
    )
  })
  it('preserves a native launch-stage error and does not continue polling or commit credentials', async () => {
    native.invoke.mockImplementation(async (command: string) => {
      if (command === 'begin_douyin_search_verification')
        throw 'network-error:无法启动账号浏览器（Windows 错误码 5）。'
    })
    await expect(verifyDouyinSearch('account-a', '夜曲')).rejects.toMatchObject({
      code: 'network-error',
      message: '无法启动账号浏览器（Windows 错误码 5）。',
    })
    expect(
      native.invoke.mock.calls.some(([name]) => name === 'poll_douyin_search_verification'),
    ).toBe(false)
    expect(native.invoke.mock.calls.some(([, args]) => args.completed === true)).toBe(false)
  })
  it('waits for a valid official response, then closes automatically with the exact account/session', async () => {
    const packets = [
      null,
      response({ status_code: 0, data: [], search_nil_info: { search_nil_type: 'verify_check' } }),
      response({ status_code: 0, data: [], has_more: 0, result_status: 5 }),
      response({ status_code: 0, data: [{ type: 1 }], has_more: 1 }),
    ]
    native.invoke.mockImplementation(async (command: string) =>
      command === 'poll_douyin_search_verification' ? packets.shift() : undefined,
    )
    const progress = vi.fn()
    const pending = verifyDouyinSearch('account-a', '夜曲', undefined, progress)
    await vi.waitFor(() =>
      expect(
        native.invoke.mock.calls.some(([name]) => name === 'poll_douyin_search_verification'),
      ).toBe(true),
    )
    await vi.advanceTimersByTimeAsync(3500)
    await pending
    const context = native.invoke.mock.calls[0]![1]
    expect(context).toMatchObject({ accountId: 'account-a', query: '夜曲' })
    expect(
      native.invoke.mock.calls.filter(([name]) => name === 'poll_douyin_search_verification'),
    ).toHaveLength(4)
    expect(native.invoke).toHaveBeenLastCalledWith('end_douyin_search_verification', {
      accountId: 'account-a',
      verificationId: context.verificationId,
      completed: true,
    })
    expect(native.invoke.mock.calls.some(([, args]) => args.completed === false)).toBe(false)
    expect(progress.mock.calls.map(([phase]) => phase)).toEqual([
      'opening',
      'waiting',
      'confirming',
    ])
  })

  it('cancels a pending opening and never commits its late successful response', async () => {
    let opened!: () => void
    native.invoke.mockImplementation((command: string) =>
      command === 'begin_douyin_search_verification'
        ? new Promise<void>((resolve) => {
            opened = resolve
          })
        : Promise.resolve(response({ status_code: 0, data: [] })),
    )
    const stop = new CancellationSource()
    const pending = verifyDouyinSearch('account-b', '音乐', stop.signal)
    const rejected = expect(pending).rejects.toMatchObject({ code: 'operation-cancelled' })
    await vi.waitFor(() => expect(opened).toBeTypeOf('function'))
    stop.cancel()
    opened()
    await rejected
    expect(native.invoke.mock.calls.some(([, args]) => args.completed === true)).toBe(false)
    expect(
      native.invoke.mock.calls.some(([name]) => name === 'poll_douyin_search_verification'),
    ).toBe(false)
    expect(native.invoke).toHaveBeenLastCalledWith(
      'end_douyin_search_verification',
      expect.objectContaining({ accountId: 'account-b', completed: false }),
    )
  })

  it('reports a manually closed browser and cleans only its own verification', async () => {
    native.invoke.mockImplementation(async (command: string) => {
      if (command === 'poll_douyin_search_verification') throw 'network-error:验证浏览器已关闭。'
    })
    await expect(verifyDouyinSearch('account-a', '音乐')).rejects.toMatchObject({
      code: 'network-error',
    })
    expect(native.invoke).toHaveBeenLastCalledWith(
      'end_douyin_search_verification',
      expect.objectContaining({ completed: false }),
    )
  })

  it('does not open a browser for an already cancelled action', async () => {
    const stop = new CancellationSource()
    stop.cancel()
    await expect(verifyDouyinSearch('account-a', '音乐', stop.signal)).rejects.toMatchObject({
      code: 'operation-cancelled',
    })
    expect(
      native.invoke.mock.calls.some(([name]) => name === 'begin_douyin_search_verification'),
    ).toBe(false)
  })
})
