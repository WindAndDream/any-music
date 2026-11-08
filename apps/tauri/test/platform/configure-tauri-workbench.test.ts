import type { MusicSourcePlugin } from '@any-music/core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const host = vi.hoisted(() => ({
  invoke: vi.fn(),
  createSources: vi.fn<() => readonly MusicSourcePlugin[]>(() => []),
  configure: vi.fn(),
  initialize: vi.fn(),
}))
vi.mock('@tauri-apps/api/core', () => ({ invoke: host.invoke }))
vi.mock('@any-music/music-workbench', () => ({ configureWorkbenchRuntime: host.configure }))
vi.mock('../../src/features/accounts/account-runtime', () => ({
  AccountRuntime: class {
    initialize = host.initialize
    sourcePlatforms = { value: [] }
    refreshSourcePlatforms = vi.fn(async () => {})
    refresh = vi.fn(async () => {})
    selectedAccountIds = { value: {} }
    snapshot = { value: { accounts: [], proxies: [] } }
    subscribeSourceInvalidation = vi.fn()
  },
}))
vi.mock('../../src/features/music-sources/built-in-music-sources', () => ({
  createBuiltInMusicSources: host.createSources,
}))
vi.mock('../../src/platform/product-storage', () => ({ createProductStorage: async () => ({}) }))
vi.mock('../../src/features/plugins/built-in-workbench-modules', () => ({
  createBuiltInWorkbenchModules: () => ({ directory: [], features: [] }),
  builtInUiThemes: [],
  loadTagManagement: vi.fn(),
  loadMusicCreation: vi.fn(),
}))
import {
  accountRuntime,
  configureTauriWorkbench,
} from '../../src/platform/configure-tauri-workbench'
import { nativeDownloadScheduler } from '../../src/platform/native-download-scheduler'

beforeEach(() => {
  vi.clearAllMocks()
  host.createSources.mockReturnValue([])
  accountRuntime.sourcePlatforms.value = []
  accountRuntime.snapshot.value = { accounts: [], proxies: [] }
  accountRuntime.selectedAccountIds.value = {}
})
afterEach(() => vi.unstubAllGlobals())
describe('native capability driven composition', () => {
  it.each([false, true])(
    'keeps optional no-login access separate from an explicitly selected expired account: %s',
    async (selected) => {
      host.invoke.mockResolvedValue({
        form: 'desktop',
        externalPlugins: 'sandboxed',
        accountTransport: 'provided',
      })
      await configureTauriWorkbench()
      accountRuntime.sourcePlatforms.value = [
        {
          id: 'external:installed',
          name: 'API source',
          authentication: {
            protocolVersion: 1,
            apiBaseUrl: 'https://api.example.com/music/',
            allowUnauthenticated: true,
            methods: ['credentials'],
            credentialFields: [
              { id: 'token', label: { en: 'Token', 'zh-CN': 'Token' }, secret: true },
            ],
          },
        },
      ]
      accountRuntime.snapshot.value = {
        proxies: [],
        accounts: [
          {
            id: 'expired',
            platformId: 'external:installed',
            name: 'Saved account',
            enabled: true,
            status: 'expired',
            state: { login: 'signed-out', verification: 'not-required', connection: 'available' },
            authentication: 'credential',
            proxyId: null,
            backupProxyIds: [],
            userAgent: '',
            webId: '',
          },
        ],
      }
      if (selected) accountRuntime.selectedAccountIds.value = { 'external:installed': 'expired' }
      const port = host.configure.mock.calls[0]![0].nativePluginAuthority
      await expect(port.sourceSession('installed')).resolves.toEqual({
        status: selected ? 'signed-out' : 'not-required',
      })
      await expect(port.sourceAccount('installed')).resolves.toEqual({
        accountId: selected ? 'expired' : null,
      })
    },
  )
  it('composes mobile without desktop external ports or unavailable native operations', async () => {
    host.invoke.mockResolvedValue({ form: 'mobile', externalPlugins: 'none' })
    await configureTauriWorkbench()
    const runtime = host.configure.mock.calls[0]![0]
    expect(runtime.modules.form).toBe('mobile')
    expect(runtime.externalPlugins).toBe('none')
    expect(runtime.nativePluginAuthority).toBeUndefined()
    expect(
      runtime.builtInMusicSources.map((p: { descriptor: { id: string } }) => p.descriptor.id),
    ).toEqual(['bilibili'])
    expect(host.createSources).not.toHaveBeenCalled()
    expect(() => runtime.openLogin(null, 'bilibili')).toThrow('暂不支持')
    expect(() => runtime.prepareMedia(null, {})).toThrow('暂不支持')
    await expect(runtime.http.request({})).rejects.toThrow('暂不支持')
    await expect(runtime.saveBlob(new Blob(), 'test.txt')).rejects.toThrow('暂不支持')
    expect(host.invoke.mock.calls.map(([command]) => command)).toEqual(['runtime_capabilities'])
  })
  it('does not fall back to desktop when native capability discovery fails', async () => {
    host.invoke.mockRejectedValue(new Error('native discovery failed'))
    await expect(configureTauriWorkbench()).rejects.toThrow('native discovery failed')
    expect(host.configure).not.toHaveBeenCalled()
    expect(host.initialize).not.toHaveBeenCalled()
  })
  it('exposes only inert package inspection on Android without advertising unavailable execution', async () => {
    host.invoke.mockResolvedValue({
      platform: 'android',
      form: 'mobile',
      externalPlugins: 'none',
      packageFiles: 'provided',
      nativeSave: 'provided',
    })
    await configureTauriWorkbench()
    const port = host.configure.mock.calls[0]![0].nativePluginAuthority
    expect(port.pickPackage).toBeTypeOf('function')
    expect(port.exportDiagnostics).toBeTypeOf('function')
    for (const operation of ['install', 'execute', 'rollback', 'beginDev', 'endDev', 'saveResult'])
      expect(port[operation]).toBeUndefined()
    expect(host.createSources).not.toHaveBeenCalled()
    const arrayBuffer = vi.fn()
    await expect(
      host.configure.mock.calls[0]![0].saveBlob(
        { size: 32 * 1024 * 1024 + 1, arrayBuffer },
        'large.txt',
      ),
    ).rejects.toThrow('32 MiB')
    expect(arrayBuffer).not.toHaveBeenCalled()
  })
  it('keeps the admitted desktop installation ports', async () => {
    host.invoke.mockResolvedValue({
      form: 'desktop',
      externalPlugins: 'sandboxed',
      accountTransport: 'provided',
    })
    await configureTauriWorkbench()
    const runtime = host.configure.mock.calls[0]![0]
    expect(runtime.modules.form).toBe('desktop')
    expect(runtime.downloadScheduler).toBe(nativeDownloadScheduler)
    expect(runtime.nativePluginAuthority.install).toBeTypeOf('function')
    expect(host.createSources).toHaveBeenCalledTimes(1)
  })
  it('uses the provided Android account transport without requiring a desktop browser', async () => {
    vi.stubGlobal('window', new EventTarget())
    host.invoke.mockResolvedValue({
      platform: 'android',
      form: 'mobile',
      externalPlugins: 'none',
      accountTransport: 'provided',
      systemBrowser: 'unavailable',
    })
    await configureTauriWorkbench()
    const runtime = host.configure.mock.calls[0]![0]
    expect(host.createSources).toHaveBeenCalledWith(expect.anything(), 'mobile')
    expect(runtime.downloadScheduler).toBe(nativeDownloadScheduler)
    expect(runtime.modules.form).toBe('mobile')
    expect(runtime.nativePluginAuthority).toBeUndefined()
    expect(() => runtime.openLogin(null, 'bilibili')).not.toThrow()
  })
  it('rejects unavailable media before resolving a descriptor or issuing native grants', async () => {
    const resolveMedia = vi.fn()
    host.createSources.mockReturnValue([{ resolveMedia } as unknown as MusicSourcePlugin])
    host.invoke.mockResolvedValue({
      platform: 'android',
      form: 'mobile',
      externalPlugins: 'none',
      accountTransport: 'provided',
      media: 'unavailable',
    })
    await configureTauriWorkbench()
    await expect(
      host.configure.mock.calls[0]![0].builtInMusicSources[0].resolveMedia({}),
    ).rejects.toMatchObject({ code: 'unsupported-operation' })
    expect(resolveMedia).not.toHaveBeenCalled()
    expect(host.invoke.mock.calls.map(([command]) => command)).toEqual(['runtime_capabilities'])
  })
  it('keeps Android media resolution and native document saving available', async () => {
    const receipt = { fileName: '歌曲.m4a', sizeBytes: 3, sha256: 'a'.repeat(64) }
    const source = {
      type: 'remote-url',
      url: 'http://127.0.0.1:12345/media/primary',
      backupUrls: ['http://127.0.0.1:12345/media/backup'],
    }
    const resolveMedia = vi.fn().mockResolvedValue(source)
    host.createSources.mockReturnValue([{ resolveMedia } as unknown as MusicSourcePlugin])
    host.invoke.mockImplementation(async (command) =>
      command === 'runtime_capabilities'
        ? {
            platform: 'android',
            form: 'mobile',
            externalPlugins: 'none',
            accountTransport: 'provided',
            accountProxy: 'provided',
            media: 'provided',
            nativeSave: 'provided',
          }
        : command === 'save_download'
          ? receipt
          : true,
    )
    await configureTauriWorkbench()
    const runtime = host.configure.mock.calls[0]![0]
    expect(await runtime.builtInMusicSources[0].resolveMedia({})).toBe(source)
    expect(resolveMedia).toHaveBeenCalledOnce()
    expect(await runtime.prepareMedia(null, source)).toBe(source)
    expect(await runtime.saveBlob(new Blob([new Uint8Array([1, 2, 3])]), '歌曲.m4a')).toEqual(
      receipt,
    )
    expect(host.invoke).toHaveBeenCalledWith('save_download', {
      fileName: '歌曲.m4a',
      bytes: [1, 2, 3],
    })
    host.invoke.mockResolvedValue(null)
    await expect(runtime.saveBlob(new Blob(), '歌曲.m4a')).rejects.toMatchObject({
      code: 'operation-cancelled',
    })
    host.invoke.mockRejectedValue('下载目录不可用，请在设置中重新选择目录。')
    await expect(runtime.saveBlob(new Blob(), '歌曲.m4a')).rejects.toMatchObject({
      code: 'storage-write-failed',
      message: '下载目录不可用，请在设置中重新选择目录。',
      cause: '下载目录不可用，请在设置中重新选择目录。',
    })
  })
})

vi.mock('../../src/features/plugins/built-in-themes', () => ({
  builtInThemes: {},
  protectedStyles: 'host-css',
}))
