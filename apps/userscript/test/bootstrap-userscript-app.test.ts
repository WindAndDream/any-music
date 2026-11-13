import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const dependencies = vi.hoisted(() => ({
  release: vi.fn<() => Promise<void>>(),
  configure: vi.fn<() => Promise<() => Promise<void>>>(),
  createPinia: vi.fn(),
  disposePinia: vi.fn(),
  mount: vi.fn(),
  unmount: vi.fn(),
  capture: vi.fn(),
}))
vi.mock('pinia', () => ({
  createPinia: dependencies.createPinia,
  disposePinia: dependencies.disposePinia,
}))
vi.mock('../src/App.vue', () => ({ default: {} }))
vi.mock('../src/platform/configure-userscript-workbench', () => ({
  configureUserscriptWorkbench: dependencies.configure,
}))
vi.mock('../src/platform/dom/mount-userscript-app', () => ({
  mountUserscriptApp: dependencies.mount,
}))
vi.mock('../src/platform/music-plugins/douyin/douyin-page-capture-runtime', () => ({
  installDouyinPageCapture: dependencies.capture,
}))

import { mountExpandedUserscriptApp } from '../src/bootstrap-userscript-app'
import type { UserscriptAppMountTarget } from '../src/platform/dom/mount-userscript-launcher'

const target = {} as UserscriptAppMountTarget
beforeEach(() => {
  vi.resetAllMocks()
  dependencies.release.mockResolvedValue()
  dependencies.configure.mockResolvedValue(dependencies.release)
  dependencies.createPinia.mockReturnValue({})
  dependencies.mount.mockReturnValue({ unmount: dependencies.unmount })
  vi.stubGlobal('window', { location: { hostname: 'example.com' }, dispatchEvent: vi.fn() })
})
afterEach(() => vi.unstubAllGlobals())

describe('expanded workbench storage lifetime', () => {
  it('waits for storage ownership before mounting and releases only once on actual unmount', async () => {
    let ready: ((release: () => Promise<void>) => void) | undefined
    dependencies.configure.mockImplementation(
      () =>
        new Promise((resolve) => {
          ready = resolve
        }),
    )
    const pending = mountExpandedUserscriptApp(target)
    expect(dependencies.mount).not.toHaveBeenCalled()
    expect(dependencies.createPinia).not.toHaveBeenCalled()
    ready!(dependencies.release)
    const mounted = await pending
    expect(dependencies.mount).toHaveBeenCalledOnce()
    expect(dependencies.release).not.toHaveBeenCalled()
    mounted!.unmount()
    mounted!.unmount()
    expect(dependencies.unmount).toHaveBeenCalledOnce()
    expect(dependencies.disposePinia).toHaveBeenCalledOnce()
    expect(dependencies.release).toHaveBeenCalledOnce()
  })

  it('releases storage when the target disappeared during initialization', async () => {
    dependencies.mount.mockReturnValue(undefined)
    expect(await mountExpandedUserscriptApp(target)).toBeUndefined()
    expect(dependencies.release).toHaveBeenCalledOnce()
    expect(dependencies.disposePinia).toHaveBeenCalledOnce()
  })

  it('releases storage after a mount failure', async () => {
    dependencies.mount.mockImplementation(() => {
      throw new Error('Mount failed')
    })
    await expect(mountExpandedUserscriptApp(target)).rejects.toThrow('Mount failed')
    expect(dependencies.release).toHaveBeenCalledOnce()
    expect(dependencies.disposePinia).toHaveBeenCalledOnce()
  })

  it('releases storage when optional page capture fails before mounting', async () => {
    window.location.hostname = 'www.douyin.com'
    dependencies.capture.mockImplementation(() => {
      throw new Error('Capture failed')
    })
    await expect(mountExpandedUserscriptApp(target)).rejects.toThrow('Capture failed')
    expect(dependencies.mount).not.toHaveBeenCalled()
    expect(dependencies.release).toHaveBeenCalledOnce()
  })

  it('never creates a Vue session after storage initialization rejects', async () => {
    dependencies.configure.mockRejectedValue(new Error('Storage busy'))
    await expect(mountExpandedUserscriptApp(target)).rejects.toThrow('Storage busy')
    expect(dependencies.mount).not.toHaveBeenCalled()
    expect(dependencies.createPinia).not.toHaveBeenCalled()
  })
})

vi.mock('../src/features/plugins/built-in-themes', () => ({
  builtInThemes: {},
  protectedStyles: 'host-css',
}))
