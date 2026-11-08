import type { NativePluginSnapshot } from '@any-music/ui'
import { describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick, shallowRef } from 'vue'

import type { NativePluginAuthorityPort } from '../../../src/features/plugins/use-native-plugin-authority'
import { usePluginCenterAuthority } from '../../../src/features/plugins/use-plugin-center-authority'

describe('plugin center authority owner', () => {
  it('shares one session and disposes pending work only on disablement or owner disposal', async () => {
    const unsubscribe = vi.fn()
    const cancel = vi.fn(async () => {})
    let resolve!: (value: { token: string; value: unknown }) => void
    const port: NativePluginAuthorityPort = {
      snapshot: vi.fn(async () => []),
      revoke: vi.fn(async () => {}),
      execute: () =>
        new Promise((done) => {
          resolve = done
        }),
      cancelExecution: cancel,
      subscribePackagePreviews: vi.fn(async () => unsubscribe),
    }
    const enabled = shallowRef(false)
    const scope = effectScope()
    const center = scope.run(() => usePluginCenterAuthority(port, enabled))!
    expect(port.snapshot).not.toHaveBeenCalled()
    enabled.value = true
    await nextTick()
    await Promise.resolve()
    const authority = center.authority.value!
    expect(port.snapshot).toHaveBeenCalledOnce()
    const command = authority.execute('installed', 'query', {})
    expect(center.authority.value).toBe(authority)
    enabled.value = false
    await nextTick()
    expect(cancel).toHaveBeenCalledExactlyOnceWith('installed')
    expect(unsubscribe).toHaveBeenCalledOnce()
    expect(center.authority.value).toBeUndefined()
    resolve({ token: 'stale', value: 'ignored' })
    await command
    expect(authority.result.value).toBeUndefined()
    enabled.value = true
    await nextTick()
    expect(center.authority.value).not.toBe(authority)
    scope.stop()
  })
  it('keeps unsupported runtimes free of native sessions', () => {
    const scope = effectScope()
    const center = scope.run(() => usePluginCenterAuthority(undefined, true))!
    expect(center.installs.value).toEqual([])
    expect(center.authority.value).toBeUndefined()
    scope.stop()
  })
  it('updates native counts without remounting settings and ignores notifications after disposal', async () => {
    let receive!: (items: readonly NativePluginSnapshot[]) => void
    const unsubscribe = vi.fn()
    const port: NativePluginAuthorityPort = {
      snapshot: async () => [],
      revoke: async () => {},
      subscribeInstalls: (callback) => {
        receive = callback
        return unsubscribe
      },
    }
    const scope = effectScope()
    const center = scope.run(() => usePluginCenterAuthority(port, true))!
    await Promise.resolve()
    const install: NativePluginSnapshot = {
      installId: 'install',
      pluginId: 'example',
      contentHash: 'hash',
      publisher: 'publisher',
      generation: 1,
      dataGeneration: 1,
      permissionEpoch: 1,
      enabled: true,
      historicalLevel: 'L0',
    }
    receive([install])
    expect(center.installs.value).toEqual([install])
    scope.stop()
    receive([])
    expect(center.installs.value).toEqual([install])
    expect(unsubscribe).toHaveBeenCalledOnce()
  })
})
