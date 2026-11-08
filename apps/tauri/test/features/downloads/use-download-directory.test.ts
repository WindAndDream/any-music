import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope } from 'vue'

import { useDownloadDirectory } from '@/features/downloads/use-download-directory'

const host = vi.hoisted(() => ({ invoke: vi.fn(), feedback: vi.fn() }))
vi.mock('@tauri-apps/api/core', () => ({ invoke: host.invoke }))
vi.mock('@any-music/ui', () => ({ useSettingsFeedback: () => host.feedback }))
beforeEach(() => {
  host.invoke.mockReset()
  host.feedback.mockReset()
})
afterEach(() => vi.restoreAllMocks())

function setup() {
  const scope = effectScope()
  const settings = scope.run(useDownloadDirectory)!
  return { scope, settings }
}

describe('native download directory settings', () => {
  it('loads the persisted projection and applies only native-confirmed choose/reset results', async () => {
    const { scope, settings } = setup()
    host.invoke.mockResolvedValueOnce({ directory: 'Music' })
    await settings.load()
    expect(settings.directory.value).toBe('Music')
    expect(settings.loaded.value).toBe(true)
    expect(host.feedback).not.toHaveBeenCalled()
    host.invoke.mockResolvedValueOnce({ directory: 'My Downloads' })
    await settings.choose()
    expect(settings.directory.value).toBe('My Downloads')
    expect(host.feedback).toHaveBeenLastCalledWith({
      status: 'success',
      message: '下载目录已保存。',
    })
    host.invoke.mockResolvedValueOnce({ directory: null })
    await settings.reset()
    expect(settings.directory.value).toBeNull()
    expect(host.invoke.mock.calls).toEqual([
      ['get_download_directory'],
      ['choose_download_directory'],
      ['reset_download_directory'],
    ])
    scope.stop()
  })

  it('preserves the selected directory when the picker is cancelled or persistence fails, and allows retry', async () => {
    const { scope, settings } = setup()
    host.invoke.mockResolvedValueOnce({ directory: 'Music' })
    await settings.load()
    host.invoke.mockResolvedValueOnce(null)
    await settings.choose()
    expect(settings.directory.value).toBe('Music')
    expect(host.feedback).not.toHaveBeenCalled()
    host.invoke.mockRejectedValueOnce('目录权限不足。')
    await settings.reset()
    expect(settings.directory.value).toBe('Music')
    expect(settings.error.value).toMatchObject({
      code: 'storage-write-failed',
      message: '目录权限不足。',
    })
    expect(host.feedback).toHaveBeenLastCalledWith({ status: 'error', message: '目录权限不足。' })
    host.invoke.mockResolvedValueOnce({ directory: null })
    await settings.reset()
    expect(settings.directory.value).toBeNull()
    expect(settings.error.value).toBeUndefined()
    scope.stop()
  })

  it('prevents overlapping pickers and ignores a result after the settings session is disposed', async () => {
    const { scope, settings } = setup()
    let resolve!: (value: { directory: string }) => void
    host.invoke.mockReturnValueOnce(
      new Promise((done) => {
        resolve = done
      }),
    )
    const pending = settings.choose()
    expect(settings.busy.value).toBe(true)
    await settings.choose()
    await settings.reset()
    expect(host.invoke).toHaveBeenCalledTimes(1)
    scope.stop()
    resolve({ directory: 'Late result' })
    await pending
    expect(settings.directory.value).toBeNull()
    expect(host.feedback).not.toHaveBeenCalled()
    await settings.choose()
    expect(host.invoke).toHaveBeenCalledTimes(1)
  })

  it('keeps a failed read explicit and still permits choosing a replacement', async () => {
    const { scope, settings } = setup()
    host.invoke.mockRejectedValueOnce(new Error('下载目录设置损坏。'))
    await settings.load()
    expect(settings.loaded.value).toBe(false)
    expect(settings.error.value?.code).toBe('storage-read-failed')
    host.invoke.mockResolvedValueOnce({ directory: 'Recovered' })
    await settings.choose()
    expect(settings.loaded.value).toBe(true)
    expect(settings.directory.value).toBe('Recovered')
    expect(settings.error.value).toBeUndefined()
    scope.stop()
  })
})
