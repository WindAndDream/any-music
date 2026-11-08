import { describe, expect, it, vi } from 'vitest'
import { effectScope, shallowRef } from 'vue'

import { useNativePluginAuthority } from '../../../src/features/plugins/use-native-plugin-authority'
import type { NativePluginAuthorityPort } from '../../../src/features/plugins/use-native-plugin-authority'
type PackagePreview = Awaited<ReturnType<NonNullable<NativePluginAuthorityPort['previewPackage']>>>

function fixture(overrides: Partial<NativePluginAuthorityPort> = {}) {
  const port: NativePluginAuthorityPort = {
    snapshot: vi.fn(async () => []),
    revoke: vi.fn(async () => {}),
    ...overrides,
  }
  const scope = effectScope()
  const active = shallowRef(false)
  const state = scope.run(() => useNativePluginAuthority(port, active))!
  return { port, scope, state, active }
}
describe('native authority display', () => {
  it('retains cancellation for a new command after an older generation finishes', async () => {
    const completions: ((value: { token: string; value: unknown }) => void)[] = []
    const cancelExecution = vi.fn(async () => {})
    const { scope, state } = fixture({
      cancelExecution,
      execute: () => new Promise((resolve) => completions.push(resolve)),
    })
    const first = state.execute('install', 'search', {})
    await state.revoke('install')
    const next = state.execute('install', 'search', {})
    completions[0]!({ token: 'stale', value: 'stale' })
    await first
    scope.stop()
    expect(cancelExecution).toHaveBeenCalledExactlyOnceWith('install')
    completions[1]!({ token: 'next', value: 'next' })
    await next
    expect(state.result.value).toBeUndefined()
  })
  it('cancels an in-flight command when external settings are unmounted and rejects stale actions', async () => {
    let finish!: (value: { token: string; value: unknown }) => void
    const cancelExecution = vi.fn(async () => {})
    const { scope, state, port } = fixture({
      cancelExecution,
      execute: () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    })
    const task = state.execute('install', 'search', {})
    scope.stop()
    expect(cancelExecution).toHaveBeenCalledExactlyOnceWith('install')
    finish({ token: 'old-result', value: 'old-data' })
    await task
    await state.revoke('install')
    expect(state.result.value).toBeUndefined()
    expect(port.snapshot).not.toHaveBeenCalled()
    expect(port.revoke).not.toHaveBeenCalled()
  })
  it('cleans up a native preview listener registered after disposal', async () => {
    let finish!: (dispose: () => void) => void
    const unsubscribe = vi.fn()
    const { scope } = fixture({
      subscribePackagePreviews: () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    })
    scope.stop()
    finish(unsubscribe)
    await vi.waitFor(() => expect(unsubscribe).toHaveBeenCalledOnce())
  })
  it('ends an asynchronously selected DEV session when its owner was disposed', async () => {
    let finish!: (value: { pairingPath: string; previewOnly: boolean }) => void
    const endDev = vi.fn(async () => {})
    const { scope, state } = fixture({
      beginDev: () =>
        new Promise((resolve) => {
          finish = resolve
        }),
      endDev,
    })
    const task = state.beginDev()
    scope.stop()
    finish({ pairingPath: 'private DEV pairing path', previewOnly: true })
    await task
    expect(endDev).toHaveBeenCalledOnce()
    expect(state.devPairingPath.value).toBeUndefined()
  })
  it('discards a native snapshot that arrives after its owner is disposed', async () => {
    const { port, scope, state } = fixture()
    let finish!: (value: PackagePreview) => void
    port.previewPackage = vi.fn(
      () =>
        new Promise<PackagePreview>((resolve) => {
          finish = resolve
        }),
    )
    port.discardPreview = vi.fn(async () => {})
    const task = state.selectPackageFile(new File(['x'], 'test.amplugin'))
    await vi.waitFor(() => expect(port.previewPackage).toHaveBeenCalledOnce())
    scope.stop()
    finish({
      token: 'late-native-snapshot',
      pluginId: 'org.example.test',
      version: '0.1.0',
      contentHash: 'a'.repeat(64),
      publisher: null,
      publisherVerified: false,
      execution: 'declarative',
      permissions: [],
      addedPermissions: [],
      historicalLevel: 'L0',
      canInstall: false,
      blockedReason: 'closed',
    })
    await task
    expect(port.discardPreview).toHaveBeenCalledExactlyOnceWith('late-native-snapshot')
  })
  it('checks size before reading and never invokes native preview for an oversized file', async () => {
    const { port, scope, state } = fixture()
    port.previewPackage = vi.fn()
    const read = vi.fn()
    await state.selectPackageFile({
      name: 'large.amplugin',
      size: 16 * 1024 * 1024 + 1,
      arrayBuffer: read,
    } as unknown as File)
    expect(read).not.toHaveBeenCalled()
    expect(port.previewPackage).not.toHaveBeenCalled()
    expect(state.errorMessage.value).toContain('无法预览')
    scope.stop()
  })
  it('does not dispatch file bytes or accept a late preview after disposal', async () => {
    const { port, scope, state } = fixture()
    port.previewPackage = vi.fn()
    let finish!: (value: ArrayBuffer) => void
    const request = state.selectPackageFile({
      name: 'test.amplugin',
      size: 1,
      arrayBuffer: () =>
        new Promise<ArrayBuffer>((resolve) => {
          finish = resolve
        }),
    } as File)
    scope.stop()
    finish(new ArrayBuffer(1))
    await request
    expect(port.previewPackage).not.toHaveBeenCalled()
    expect(state.packagePreview.value).toBeUndefined()
  })
  it('does not infer authority from renderer state and refreshes only after native revoke', async () => {
    const { port, scope, state } = fixture()
    expect(port.snapshot).not.toHaveBeenCalled()
    await state.revoke('install')
    expect(port.revoke).toHaveBeenCalledExactlyOnceWith('install')
    expect(port.snapshot).toHaveBeenCalledTimes(1)
    scope.stop()
  })
  it('clears stale projections when a native operation fails', async () => {
    const { port, scope, state } = fixture()
    vi.mocked(port.revoke).mockRejectedValue(new Error('private native detail'))
    await state.revoke('install')
    expect(state.errorMessage.value).toBe('无法读取或更新原生授权，请刷新重试。')
    expect(state.installs.value).toEqual([])
    expect(port.snapshot).not.toHaveBeenCalled()
    scope.stop()
  })
  it('ignores a late snapshot after disposal', async () => {
    const { port, scope, state } = fixture()
    let complete!: () => void
    vi.mocked(port.snapshot).mockImplementation(
      () =>
        new Promise((resolve) => {
          complete = () => resolve([])
        }),
    )
    const request = state.refresh()
    scope.stop()
    complete()
    await request
    expect(state.installs.value).toEqual([])
  })
  it('allows revocation during execution and discards its late result', async () => {
    let finish!: (output: { token: string; value: unknown }) => void
    const { scope, state, port } = fixture({
      execute: () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    })
    const pending = state.execute('install', 'run', {})
    expect(state.busy.value).toBe(true)
    await state.revoke('install')
    expect(port.revoke).toHaveBeenCalledOnce()
    finish({ token: 'late-output', value: 'private output' })
    await pending
    expect(state.result.value).toBeUndefined()
    scope.stop()
  })
})
