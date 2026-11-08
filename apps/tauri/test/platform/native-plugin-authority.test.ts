import { usePluginCenterAuthority } from '@any-music/music-workbench/features/plugins/use-plugin-center-authority'
import type { NativePluginSnapshot } from '@any-music/ui'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope } from 'vue'

const invoke = vi.hoisted(() =>
  vi.fn(async (_command: string, _args?: Record<string, unknown>): Promise<unknown> => ({
    canInstall: false,
  })),
)
vi.mock('@tauri-apps/api/core', () => ({ invoke }))
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => vi.fn()) }))
import { nativePluginAuthority } from '../../src/platform/native-plugin-authority'

describe('native package preview port', () => {
  beforeEach(() => invoke.mockClear())
  it('uses the inert native command without inferring permission', async () => {
    await nativePluginAuthority.previewPackage!(new Uint8Array([1, 2, 3]))
    expect(invoke).toHaveBeenCalledExactlyOnceWith('plugin_package_preview', {
      bytes: [1, 2, 3],
    })
  })
  it('keeps file selection, anonymous URL acquisition and DEV pairing as named native operations', async () => {
    await nativePluginAuthority.pickPackage!()
    await nativePluginAuthority.previewPackageUrl!('https://example.com/plugin.amplugin')
    await nativePluginAuthority.beginDev!()
    await nativePluginAuthority.endDev!()
    expect(invoke.mock.calls).toEqual([
      ['plugin_package_pick_preview'],
      ['plugin_package_url_preview', { url: 'https://example.com/plugin.amplugin' }],
      ['plugin_dev_begin'],
      ['plugin_dev_end'],
    ])
  })
})

describe('native authority snapshot requests', () => {
  const scopes: ReturnType<typeof effectScope>[] = []
  const installed: NativePluginSnapshot = {
    installId: 'installed',
    pluginId: 'example',
    contentHash: 'hash',
    publisher: 'publisher',
    generation: 1,
    dataGeneration: 1,
    permissionEpoch: 1,
    enabled: true,
    historicalLevel: 'L0',
  }

  beforeEach(() => {
    vi.resetModules()
    invoke.mockReset()
  })
  afterEach(() => {
    for (const scope of scopes.splice(0)) scope.stop()
  })
  function openCenter(port: typeof nativePluginAuthority) {
    const scope = effectScope()
    scopes.push(scope)
    return scope.run(() => usePluginCenterAuthority(port, true))!
  }
  function snapshotCalls() {
    return invoke.mock.calls.filter(([command]) => command === 'plugin_authority_snapshot')
  }

  it('opens the plugin center while subscription and refresh share one native read', async () => {
    let complete!: (states: readonly NativePluginSnapshot[]) => void
    let reading = false
    invoke.mockImplementation(async (command) => {
      if (command === 'runtime_capabilities') return { platform: 'windows' }
      if (command !== 'plugin_authority_snapshot') return null
      // The native authority rejects a second operation while its sole permit is held.
      if (reading) throw '插件操作繁忙。'
      reading = true
      return new Promise((resolve) => {
        complete = (states) => {
          reading = false
          resolve(states)
        }
      })
    })
    const { nativePluginAuthority: port } =
      await import('../../src/platform/native-plugin-authority')
    const receive = vi.fn()
    const unsubscribe = port.subscribeInstalls!(receive)
    const center = openCenter(port)
    const pending = port.snapshot()
    complete([installed])
    await pending
    await vi.waitFor(() => expect(center.busy.value).toBe(false))
    expect(snapshotCalls()).toHaveLength(1)
    expect(center.errorMessage.value).toBeUndefined()
    expect(center.installs.value).toEqual([installed])
    expect(receive).toHaveBeenCalledExactlyOnceWith([installed])
    unsubscribe()
  })

  it('retries a failed read and clears the plugin center error', async () => {
    invoke.mockImplementation(async (command) => {
      if (command === 'runtime_capabilities') return { platform: 'windows' }
      if (command === 'plugin_authority_snapshot') throw '插件数据库不可用。'
      return null
    })
    const { nativePluginAuthority: port } =
      await import('../../src/platform/native-plugin-authority')
    const center = openCenter(port)
    await vi.waitFor(() => expect(center.busy.value).toBe(false))
    expect(snapshotCalls()).toHaveLength(1)
    expect(center.errorMessage.value).toBe('无法读取或更新原生授权，请刷新重试。')
    invoke.mockImplementation(async (command) =>
      command === 'plugin_authority_snapshot' ? [installed] : null,
    )
    await center.authority.value!.refresh()
    expect(snapshotCalls()).toHaveLength(2)
    expect(center.errorMessage.value).toBeUndefined()
    expect(center.installs.value).toEqual([installed])
  })

  it('reads fresh native state after revocation instead of caching a settled snapshot', async () => {
    let current = installed
    invoke.mockImplementation(async (command) => {
      if (command === 'runtime_capabilities') return { platform: 'windows' }
      if (command === 'plugin_authority_revoke')
        current = { ...installed, enabled: false, permissionEpoch: 2 }
      return command === 'plugin_authority_snapshot' ? [current] : null
    })
    const { nativePluginAuthority: port } =
      await import('../../src/platform/native-plugin-authority')
    const center = openCenter(port)
    await vi.waitFor(() => expect(center.busy.value).toBe(false))
    await center.authority.value!.revoke(installed.installId)
    expect(snapshotCalls()).toHaveLength(2)
    expect(center.installs.value).toEqual([current])
    expect(current.enabled).toBe(false)
    expect(current.permissionEpoch).toBe(2)
  })

  it('does not notify an unsubscribed owner when its pending read fails', async () => {
    const failures: ((cause: unknown) => void)[] = []
    invoke.mockImplementation(() => new Promise((_, fail) => failures.push(fail)))
    const { nativePluginAuthority: port } =
      await import('../../src/platform/native-plugin-authority')
    const receive = vi.fn()
    const unsubscribe = port.subscribeInstalls!(receive)
    const pending = port.snapshot()
    unsubscribe()
    for (const fail of failures) fail('插件数据库不可用。')
    await expect(pending).rejects.toBe('插件数据库不可用。')
    expect(receive).not.toHaveBeenCalled()
  })

  it('does not reuse or publish a read that predates a completed revocation', async () => {
    let current = installed
    invoke.mockImplementation(async (command) => {
      if (command === 'plugin_authority_revoke')
        current = { ...installed, enabled: false, permissionEpoch: 2 }
      return command === 'plugin_authority_snapshot' ? [current] : null
    })
    const { nativePluginAuthority: port, configureSourceAccountSelection } =
      await import('../../src/platform/native-plugin-authority')
    let finishSources!: () => void
    const refreshSources = vi
      .fn(async () => {})
      .mockImplementationOnce(() => new Promise<void>((resolve) => (finishSources = resolve)))
    configureSourceAccountSelection(() => undefined, refreshSources)
    const receive = vi.fn()
    const unsubscribe = port.subscribeInstalls!(receive)
    const pending = port.snapshot()
    await vi.waitFor(() => expect(refreshSources).toHaveBeenCalledOnce())
    await port.revoke(installed.installId)
    const refreshed = port.snapshot()
    finishSources()
    await expect(refreshed).resolves.toEqual([current])
    await expect(pending).resolves.toEqual([current])
    expect(receive).toHaveBeenCalled()
    expect(receive.mock.calls.every(([states]) => states[0].enabled === false)).toBe(true)
    unsubscribe()
  })

  it('retries source account refresh before publishing the same changed installation state', async () => {
    invoke.mockResolvedValue([installed])
    const { nativePluginAuthority: port, configureSourceAccountSelection } =
      await import('../../src/platform/native-plugin-authority')
    const refreshSources = vi
      .fn(async () => {})
      .mockRejectedValueOnce(new Error('source account directory unavailable'))
    configureSourceAccountSelection(() => undefined, refreshSources)
    await expect(port.snapshot()).rejects.toThrow('source account directory unavailable')
    await expect(port.snapshot()).resolves.toEqual([installed])
    expect(refreshSources).toHaveBeenCalledTimes(2)
    await port.snapshot()
    expect(refreshSources).toHaveBeenCalledTimes(2)
    expect(snapshotCalls()).toHaveLength(3)
  })
})
