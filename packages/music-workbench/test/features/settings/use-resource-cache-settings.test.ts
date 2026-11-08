import { AppError } from '@any-music/core'
import { describe, expect, it, vi } from 'vitest'
import { effectScope, shallowRef } from 'vue'

import {
  useResourceCacheSettings,
  type ResourceCachePort,
} from '#workbench/features/settings/use-resource-cache-settings'

function fixture() {
  const value = {
    capacityBytes: 1024 ** 3,
    usedBytes: 256 * 1024 ** 2,
    imageBytes: 0,
    audioBytes: 256 * 1024 ** 2,
    entryCount: 3,
    memoryCapacityBytes: 64 * 1024 ** 2,
    memoryUsedBytes: 1024 ** 2,
    memoryEntryCount: 1,
    directory: '/cache',
    customDirectory: false,
    canChooseDirectory: true,
  }
  const port = {
    snapshot: vi.fn(async () => value),
    configure: vi.fn(async (capacityBytes: number) => ({ ...value, capacityBytes })),
    configureMemory: vi.fn(async (memoryCapacityBytes: number) => ({
      ...value,
      memoryCapacityBytes,
    })),
    clear: vi.fn(async () => ({ ...value, usedBytes: 0 })),
    chooseDirectory: vi.fn(async () => ({ ...value, directory: '/chosen', customDirectory: true })),
  } satisfies ResourceCachePort
  const confirm = vi.fn(async () => true)
  const open = shallowRef(true)
  const scope = effectScope()
  const model = scope.run(() => useResourceCacheSettings(port, confirm, () => open.value))!
  return { port, confirm, open, model, stop: () => scope.stop() }
}
describe('resource cache settings', () => {
  it('validates memory limits separately and preserves the other unsaved draft', async () => {
    const f = fixture()
    await vi.waitFor(() => expect(f.model.busy.value).toBe(false))
    for (const input of ['', ' ', '-1', '0.5', 'NaN', '1025']) {
      f.model.memoryCapacityMib.value = input
      // eslint-disable-next-line no-await-in-loop
      await f.model.saveMemory()
      expect(f.port.configureMemory).not.toHaveBeenCalled()
    }
    f.model.capacityMib.value = '2048'
    f.model.memoryCapacityMib.value = '0'
    await f.model.saveMemory()
    expect(f.port.configureMemory).toHaveBeenCalledExactlyOnceWith(0)
    expect(f.port.configure).not.toHaveBeenCalled()
    expect(f.model.capacityMib.value).toBe('2048')
    f.model.memoryCapacityMib.value = '128'
    await f.model.save()
    expect(f.model.memoryCapacityMib.value).toBe('128')
    await f.model.refresh()
    expect(f.model.memoryCapacityMib.value).toBe('128')
    f.open.value = false
    await f.model.saveMemory()
    expect(f.port.configureMemory).toHaveBeenCalledOnce()
    f.stop()
  })
  it('rejects meaningless and invalid capacities before invoking storage', async () => {
    const f = fixture()
    await vi.waitFor(() => expect(f.model.busy.value).toBe(false))
    for (const input of ['1', '127', '128.5', 'NaN', '', '102401']) {
      f.model.capacityMib.value = input
      // Each invalid submission must leave the same underlying cache untouched.
      // eslint-disable-next-line no-await-in-loop
      await f.model.save()
      expect(f.port.configure).not.toHaveBeenCalled()
      expect(f.model.error.value).toContain('128')
    }
    f.model.capacityMib.value = '1024'
    await f.model.save()
    expect(f.port.configure).toHaveBeenCalledExactlyOnceWith(1024 ** 3)
    f.stop()
  })
  it('requires confirmation before clearing or shrinking populated storage', async () => {
    const f = fixture()
    await vi.waitFor(() => expect(f.model.busy.value).toBe(false))
    f.confirm.mockResolvedValueOnce(false)
    await f.model.clear()
    expect(f.port.clear).not.toHaveBeenCalled()
    await f.model.clear()
    expect(f.confirm).toHaveBeenLastCalledWith(
      expect.objectContaining({ title: '清除全部资源缓存？', tone: 'danger' }),
    )
    expect(f.port.clear).toHaveBeenCalledOnce()
    await f.model.refresh()
    f.model.capacityMib.value = '128'
    f.confirm.mockResolvedValueOnce(false)
    await f.model.save()
    expect(f.port.configure).not.toHaveBeenCalled()
    await f.model.save()
    expect(f.port.configure).toHaveBeenCalledExactlyOnceWith(128 * 1024 ** 2)
    f.stop()
  })
  it('never replays confirmations after settings close or disposal, and blocks duplicate actions', async () => {
    const f = fixture()
    await vi.waitFor(() => expect(f.model.busy.value).toBe(false))
    let finish!: (accepted: boolean) => void
    f.confirm.mockImplementation(
      () =>
        new Promise<boolean>((resolve) => {
          finish = resolve
        }),
    )
    const pending = f.model.clear()
    await f.model.clear()
    expect(f.confirm).toHaveBeenCalledOnce()
    f.open.value = false
    f.open.value = true
    finish(true)
    await pending
    expect(f.port.clear).not.toHaveBeenCalled()
    const choice = f.model.chooseDirectory(false)
    f.stop()
    finish(true)
    await choice
    expect(f.port.chooseDirectory).not.toHaveBeenCalled()
  })
  it('preserves drafts on refresh and recovers from storage errors', async () => {
    const f = fixture()
    await vi.waitFor(() => expect(f.model.busy.value).toBe(false))
    f.model.capacityMib.value = '2048'
    await f.model.refresh()
    expect(f.model.capacityMib.value).toBe('2048')
    f.port.configure.mockRejectedValueOnce(new AppError('storage-write-failed', '磁盘已满'))
    await f.model.save()
    expect(f.model.error.value).toBe('磁盘已满')
    await f.model.save()
    expect(f.model.error.value).toBe('')
    expect(f.model.snapshot.value?.capacityBytes).toBe(2048 * 1024 ** 2)
    f.stop()
  })
})
