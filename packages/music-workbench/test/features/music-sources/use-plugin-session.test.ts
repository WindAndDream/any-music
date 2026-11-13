import type { MusicSourcePlugin, MusicSourceSession } from '@any-music/core'
import { createAppErrorState } from '@any-music/core'
import { describe, expect, it, vi } from 'vitest'
import { effectScope, shallowRef } from 'vue'

import { usePluginSession } from '#workbench/features/music-sources/use-plugin-session'

describe('usePluginSession', () => {
  it('clears the previous source identity while an uncached source refresh is pending', async () => {
    const pending = createDeferred<MusicSourceSession>()
    const getFirstSession = vi.fn(async (): Promise<MusicSourceSession> => ({
      status: 'signed-in',
      user: { id: 'first-user', name: 'First user' },
    }))
    const getSecondSession = vi.fn(() => pending.promise)
    const plugin = shallowRef(createPlugin('first', getFirstSession))
    const session = usePluginSession(plugin)
    await session.refresh()

    plugin.value = createPlugin('second', getSecondSession)
    const refresh = session.refresh()

    expect(session.session.value).toEqual({ status: 'checking' })
    expect(session.isRefreshing.value).toBe(true)
    expect(session.getKnownSession('first')).toMatchObject({
      status: 'signed-in',
      user: { id: 'first-user' },
    })
    expect(session.getKnownSession('second')).toBeUndefined()
    expect(getFirstSession).toHaveBeenCalledTimes(1)
    expect(getSecondSession).toHaveBeenCalledTimes(1)

    pending.resolve({ status: 'signed-out' })
    await refresh
    expect(session.session.value).toEqual({ status: 'signed-out' })
    expect(session.getKnownSession('second')).toEqual({ status: 'signed-out' })
    expect(session.isRefreshing.value).toBe(false)
  })

  it('keeps the known identity during a refresh of the same source', async () => {
    let response = createDeferred<MusicSourceSession>()
    const session = usePluginSession(createPlugin('test', () => response.promise))
    let refresh = session.refresh()
    const signedIn: MusicSourceSession = {
      status: 'signed-in',
      user: { id: 'known', name: 'Known user' },
    }
    response.resolve(signedIn)
    await refresh

    response = createDeferred<MusicSourceSession>()
    refresh = session.refresh()
    expect(session.session.value).toEqual(signedIn)
    expect(session.isRefreshing.value).toBe(true)
    response.resolve({ status: 'signed-out' })
    await refresh
    expect(session.session.value).toEqual({ status: 'signed-out' })
  })

  it('restores only the selected source cache when switching back during a pending refresh', async () => {
    const firstSession: MusicSourceSession = {
      status: 'signed-in',
      user: { id: 'first-user', name: 'First user' },
    }
    const secondSession: MusicSourceSession = {
      status: 'signed-in',
      user: { id: 'second-user', name: 'Second user' },
    }
    const first = createPlugin('first', async () => firstSession)
    const second = createPlugin('second', async () => secondSession)
    const plugin = shallowRef(first)
    const session = usePluginSession(plugin)
    await session.refresh()
    plugin.value = second
    await session.refresh()

    const pendingFirst = createDeferred<MusicSourceSession>()
    const pendingSecond = createDeferred<MusicSourceSession>()
    first.getSession = () => pendingFirst.promise
    second.getSession = () => pendingSecond.promise
    plugin.value = first
    const firstRefresh = session.refresh()
    expect(session.session.value).toEqual(firstSession)
    plugin.value = second
    const secondRefresh = session.refresh()
    expect(session.session.value).toEqual(secondSession)

    pendingFirst.resolve({ status: 'signed-out' })
    await firstRefresh
    expect(session.session.value).toEqual(secondSession)
    expect(session.getKnownSession('first')).toEqual(firstSession)
    expect(session.isRefreshing.value).toBe(true)
    pendingSecond.resolve({ status: 'signed-out' })
    await secondRefresh
    expect(session.session.value).toEqual({ status: 'signed-out' })
    expect(session.isRefreshing.value).toBe(false)
  })

  it('keeps an explicit expired state for a newly selected source until its refresh completes', async () => {
    const pending = createDeferred<MusicSourceSession>()
    const plugin = shallowRef(
      createPlugin('first', async () => ({
        status: 'signed-in',
        user: { id: '1', name: 'First' },
      })),
    )
    const session = usePluginSession(plugin)
    await session.refresh()
    plugin.value = createPlugin('second', () => pending.promise)
    session.markExpired()
    const refresh = session.refresh()
    expect(session.session.value.status).toBe('expired')
    pending.resolve({ status: 'signed-out' })
    await refresh
    expect(session.session.value.status).toBe('signed-out')
  })

  it('retains a newly selected source invalidation while refreshing instead of restoring another identity', async () => {
    const pending = createDeferred<MusicSourceSession>()
    const plugin = shallowRef(
      createPlugin('first', async () => ({
        status: 'signed-in',
        user: { id: '1', name: 'First' },
      })),
    )
    const session = usePluginSession(plugin)
    await session.refresh()
    plugin.value = createPlugin('second', () => pending.promise)
    const error = createAppErrorState('operation-cancelled', 'Account removed')
    session.invalidateSource('second', error)
    const refresh = session.refresh()
    expect(session.session.value).toEqual({ status: 'unavailable', error })
    expect(session.getKnownSession('second')).toBeUndefined()
    pending.resolve({ status: 'signed-out' })
    await refresh
    expect(session.session.value.status).toBe('signed-out')
  })

  it('ignores an earlier source rejection without clearing the current pending request', async () => {
    const first = createDeferred<MusicSourceSession>()
    const second = createDeferred<MusicSourceSession>()
    const plugin = shallowRef(createPlugin('first', () => first.promise))
    const session = usePluginSession(plugin)
    const firstRefresh = session.refresh()
    plugin.value = createPlugin('second', () => second.promise)
    const secondRefresh = session.refresh()
    first.reject(new Error('Late first-source failure'))
    await firstRefresh
    expect(session.session.value).toEqual({ status: 'checking' })
    expect(session.isRefreshing.value).toBe(true)
    expect(session.getKnownSession('first')).toBeUndefined()
    expect(session.getKnownSession('second')).toBeUndefined()
    second.resolve({ status: 'signed-out' })
    await secondRefresh
    expect(session.session.value).toEqual({ status: 'signed-out' })
  })

  it('does not query a source that does not require a session', async () => {
    const plugin = shallowRef(
      createPlugin('first', async () => ({
        status: 'signed-in',
        user: { id: '1', name: 'First' },
      })),
    )
    const session = usePluginSession(plugin)
    await session.refresh()
    const getSession = vi.fn(async (): Promise<MusicSourceSession> => ({ status: 'signed-out' }))
    const next = createPlugin('second', getSession)
    next.descriptor.capabilities.session = false
    plugin.value = next
    await session.refresh()
    expect(session.session.value).toEqual({ status: 'not-required' })
    expect(getSession).not.toHaveBeenCalled()
  })

  it('supports retry after a failed refresh of the newly selected source', async () => {
    const plugin = shallowRef(
      createPlugin('first', async () => ({
        status: 'signed-in',
        user: { id: '1', name: 'First' },
      })),
    )
    const session = usePluginSession(plugin)
    await session.refresh()
    const pending = createDeferred<MusicSourceSession>()
    const getSession = vi.fn(() => pending.promise)
    plugin.value = createPlugin('second', getSession)
    const refresh = session.refresh()
    pending.reject(new Error('Second-source failure'))
    await refresh
    expect(session.session.value).toMatchObject({
      status: 'unavailable',
      error: { code: 'upstream-error', message: 'Second-source failure' },
    })
    getSession.mockResolvedValue({ status: 'signed-out' })
    await session.refresh()
    expect(session.session.value).toEqual({ status: 'signed-out' })
    expect(getSession).toHaveBeenCalledTimes(2)
    expect(session.getKnownSession('first')).toMatchObject({
      status: 'signed-in',
      user: { id: '1' },
    })
  })

  it('ignores completion after disposal without changing the selected source cache', async () => {
    const pending = createDeferred<MusicSourceSession>()
    const scope = effectScope()
    const session = scope.run(() => usePluginSession(createPlugin('test', () => pending.promise)))!
    const refresh = session.refresh()
    scope.stop()
    pending.resolve({ status: 'signed-in', user: { id: 'late', name: 'Late user' } })
    await refresh
    expect(session.session.value).toEqual({ status: 'checking' })
    expect(session.getKnownSession('test')).toBeUndefined()
    expect(session.isRefreshing.value).toBe(false)
  })

  it('invalidates cached identity and ignores a session response after account removal', async () => {
    let response = createDeferred<MusicSourceSession>()
    const session = usePluginSession(createPlugin('test', () => response.promise))
    let refresh = session.refresh()
    response.resolve({ status: 'signed-in', user: { id: 'a', name: '旧账号' } })
    await refresh
    expect(session.getKnownSession('test')?.status).toBe('signed-in')
    response = createDeferred<MusicSourceSession>()
    refresh = session.refresh()
    session.invalidateSource('test', createAppErrorState('operation-cancelled', '账号已删除'))
    response.resolve({ status: 'signed-in', user: { id: 'a', name: '晚到的旧账号' } })
    await refresh
    expect(session.session.value.status).toBe('unavailable')
    expect(session.getKnownSession('test')).toBeUndefined()
    expect(session.isRefreshing.value).toBe(false)
  })
  it('keeps the latest plugin refresh when an older request finishes later', async () => {
    const first = createDeferred<MusicSourceSession>()
    const second = createDeferred<MusicSourceSession>()
    const plugin = shallowRef(createPlugin('first', () => first.promise))
    const session = usePluginSession(plugin)

    const firstRefresh = session.refresh()
    plugin.value = createPlugin('second', () => second.promise)
    const secondRefresh = session.refresh()
    second.resolve({ status: 'signed-in', user: { id: '2', name: '最新用户' } })
    await secondRefresh
    first.resolve({ status: 'signed-in', user: { id: '1', name: '旧用户' } })
    await firstRefresh

    expect(session.session.value).toEqual({
      status: 'signed-in',
      user: { id: '2', name: '最新用户' },
    })
  })

  it('converts refresh rejection into a serializable unavailable session', async () => {
    const session = usePluginSession(
      createPlugin('failed', () => Promise.reject(new Error('network timeout'))),
    )

    await expect(session.refresh()).resolves.toBeUndefined()

    expect(session.session.value).toMatchObject({
      status: 'unavailable',
      error: { code: 'upstream-error', message: 'network timeout' },
    })
  })

  it('does not let an in-flight refresh overwrite an explicit expired state', async () => {
    const pending = createDeferred<MusicSourceSession>()
    const session = usePluginSession(createPlugin('test', () => pending.promise))
    const refresh = session.refresh()

    session.markExpired()
    pending.resolve({ status: 'signed-in', user: { id: '1', name: '过期用户' } })
    await refresh

    expect(session.session.value.status).toBe('expired')
    expect(session.isRefreshing.value).toBe(false)
  })
})

function createPlugin(id: string, getSession: MusicSourcePlugin['getSession']): MusicSourcePlugin {
  return {
    descriptor: {
      id,
      name: id,
      provenance: 'built-in',
      capabilities: { search: false, importUrl: false, session: true },
      importUrlScopes: [],
    },
    checkAvailability: () => Promise.resolve({ status: 'available', checkedAtMs: 1 }),
    validateImportUrl: () => undefined,
    getSession,
    getLoginUrl: () => undefined,
    search: () => {
      throw new Error('not supported')
    },
    importFromUrl: () => {
      throw new Error('not supported')
    },
    resolveMedia: () => Promise.reject(new Error('not supported')),
  }
}

function createDeferred<T>(): {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (reason: unknown) => void
} {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((fulfill, fail) => {
    resolve = fulfill
    reject = fail
  })
  return { promise, resolve, reject }
}
