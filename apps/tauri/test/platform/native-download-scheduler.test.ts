import { describe, expect, it, vi } from 'vitest'

import { nativeDownloadScheduler } from '../../src/platform/native-download-scheduler'

const invoke = vi.hoisted(() => vi.fn())
vi.mock('@tauri-apps/api/core', () => ({ invoke }))

describe('native download admission', () => {
  it('does not release an admitted slot on abort until media cleanup completes', async () => {
    invoke.mockReset().mockResolvedValue(undefined)
    invoke.mockImplementation(async (command) =>
      command === 'open_download_schedule' ? 'schedule' : undefined,
    )
    const schedule = await nativeDownloadScheduler.open(2)
    const controller = new AbortController()
    const release = await schedule.acquire('item', controller.signal)
    controller.abort()
    expect(invoke.mock.calls.filter(([name]) => name === 'release_download_slot')).toHaveLength(0)
    await release()
    await release()
    expect(invoke.mock.calls.filter(([name]) => name === 'release_download_slot')).toHaveLength(1)
    await schedule.close()
    expect(invoke).toHaveBeenLastCalledWith('close_download_schedule', { scheduleId: 'schedule' })
  })

  it('cancels waiting admission and ignores late native success', async () => {
    let grant!: () => void
    invoke.mockReset().mockImplementation(async (command) => {
      if (command === 'open_download_schedule') return 'schedule'
      if (command === 'acquire_download_slot')
        await new Promise<void>((resolve) => {
          grant = resolve
        })
    })
    const schedule = await nativeDownloadScheduler.open(1)
    const controller = new AbortController()
    const pending = schedule.acquire('item', controller.signal)
    controller.abort()
    grant()
    await expect(pending).rejects.toMatchObject({ code: 'operation-cancelled' })
    expect(invoke).toHaveBeenCalledWith(
      'release_download_slot',
      expect.objectContaining({ scheduleId: 'schedule' }),
    )
    await schedule.close()
  })
})
