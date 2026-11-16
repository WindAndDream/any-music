import { beforeEach, describe, expect, it, vi } from 'vitest'

const native = vi.hoisted(() => ({
  invoke: vi.fn(),
  listener: undefined as undefined | ((event: { payload: unknown }) => void),
}))
vi.mock('@tauri-apps/api/core', () => ({ invoke: native.invoke }))
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(async (_name: string, handler: (event: { payload: unknown }) => void) => {
    native.listener = handler
    return () => {}
  }),
}))

import { layoutAccountPage, openAccountPage, useAccountPage } from '@/platform/account-page'

beforeEach(() => native.invoke.mockReset().mockResolvedValue(undefined))

describe('in-app account page presentation', () => {
  it('reveals only the presented account and keeps an isolated challenge size', async () => {
    const onClose = vi.fn()
    const page = await openAccountPage({
      accountId: 'a',
      title: '验证',
      description: '',
      mode: 'challenge',
      onClose,
    })
    const { current, close } = useAccountPage()
    expect(current.value?.state).toBe('pending')
    native.listener?.({ payload: { accountId: 'b', state: 'visible', width: 10, height: 10 } })
    expect(current.value?.state).toBe('pending')
    native.listener?.({ payload: { accountId: 'a', state: 'visible', width: 340, height: 260 } })
    expect(current.value).toMatchObject({ state: 'visible', width: 340, height: 260 })
    // A concealed challenge returns to pending and forgets its old size.
    native.listener?.({ payload: { accountId: 'a', state: 'pending', width: null, height: null } })
    expect(current.value).toMatchObject({ state: 'pending', width: undefined })
    native.listener?.({ payload: { accountId: 'a', state: 'visible', width: null, height: null } })
    expect(current.value).toMatchObject({ state: 'visible', width: undefined })
    close()
    expect(onClose).toHaveBeenCalledOnce()
    page.dismiss()
    expect(current.value).toBeUndefined()
  })

  it('lets a stale handle neither update nor dismiss a newer presentation', async () => {
    const old = await openAccountPage({
      accountId: 'a',
      title: '旧',
      description: '',
      mode: 'page',
      onClose: () => {},
    })
    const onAction = vi.fn()
    await openAccountPage({
      accountId: 'a',
      title: '新',
      description: '',
      mode: 'page',
      actionLabel: '完成',
      onAction,
      onClose: () => {},
    })
    const { current, action } = useAccountPage()
    old.update({ busy: true })
    old.dismiss()
    expect(current.value).toMatchObject({ title: '新', busy: false })
    action()
    expect(onAction).toHaveBeenCalledOnce()
  })

  it('forwards dialog geometry to the native page owner', async () => {
    await layoutAccountPage('a', { x: 1, y: 2, width: 300, height: 200 })
    await layoutAccountPage('a', null)
    expect(native.invoke.mock.calls).toEqual([
      ['account_page_layout', { accountId: 'a', bounds: { x: 1, y: 2, width: 300, height: 200 } }],
      ['account_page_layout', { accountId: 'a', bounds: null }],
    ])
  })
})
