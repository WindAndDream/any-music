import { AppError } from '@any-music/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { effectScope } from 'vue'

import { AccountRuntime } from '@/features/accounts/account-runtime'
import { useAccountSwitcher } from '@/features/accounts/use-account-switcher'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
afterEach(() => vi.restoreAllMocks())

describe('desktop account switcher', () => {
  it('does not open or refresh an unassigned mobile platform', async () => {
    const runtime = new AccountRuntime()
    const refresh = vi.spyOn(runtime, 'refresh').mockResolvedValue()
    const scope = effectScope()
    const switcher = scope.run(() => useAccountSwitcher(runtime, ['bilibili']))!
    await switcher.open('douyin')
    expect(switcher.platformId.value).toBeNull()
    expect(refresh).not.toHaveBeenCalled()
    await switcher.open('bilibili')
    expect(switcher.platformId.value).toBe('bilibili')
    expect(refresh).toHaveBeenCalledTimes(1)
    scope.stop()
  })
  it('does not start a session request after its owner has been disposed', async () => {
    const runtime = new AccountRuntime()
    vi.spyOn(runtime, 'refresh').mockResolvedValue()
    let complete!: () => void
    vi.spyOn(runtime, 'selectAccount').mockReturnValue(
      new Promise<void>((resolve) => {
        complete = resolve
      }),
    )
    const scope = effectScope()
    const switcher = scope.run(() => useAccountSwitcher(runtime))!
    await switcher.open('bilibili')
    const refresh = vi.fn()
    const pending = switcher.select('b', refresh)
    scope.stop()
    complete()
    await pending
    expect(refresh).not.toHaveBeenCalled()
  })
  it('keeps a failed switch open for retry and refreshes the session after success', async () => {
    const runtime = new AccountRuntime()
    vi.spyOn(runtime, 'refresh').mockResolvedValue()
    const select = vi
      .spyOn(runtime, 'selectAccount')
      .mockRejectedValueOnce(new AppError('upstream-error', '无法保存账号偏好'))
      .mockResolvedValue()
    const scope = effectScope()
    const switcher = scope.run(() => useAccountSwitcher(runtime))!
    const refresh = vi.fn().mockResolvedValue(undefined)
    await switcher.open('bilibili')
    await switcher.select('b', refresh)
    expect(switcher.platformId.value).toBe('bilibili')
    expect(switcher.error.value).toContain('无法保存账号偏好')
    expect(refresh).not.toHaveBeenCalled()
    await switcher.select('b', refresh)
    expect(select).toHaveBeenCalledTimes(2)
    expect(switcher.platformId.value).toBeNull()
    expect(refresh).toHaveBeenCalledOnce()
    scope.stop()
  })
  it('allows dismissal during refresh and ignores stale failures from the old platform', async () => {
    let reject!: (cause: unknown) => void
    const runtime = new AccountRuntime()
    vi.spyOn(runtime, 'refresh')
      .mockReturnValueOnce(
        new Promise((_resolve, fail) => {
          reject = fail
        }),
      )
      .mockResolvedValue()
    const scope = effectScope()
    const switcher = scope.run(() => useAccountSwitcher(runtime))!
    const pending = switcher.open('bilibili')
    switcher.close()
    await switcher.open('douyin')
    reject('old failure')
    await pending
    expect(switcher.platformId.value).toBe('douyin')
    expect(switcher.error.value).toBe('')
    expect(switcher.busy.value).toBe(false)
    scope.stop()
  })
})
