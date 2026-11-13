import { describe, expect, it, vi } from 'vitest'

import { verifyNativeDownload } from '../../src/platform/verify-native-download'

const invoke = vi.hoisted(() => vi.fn())
vi.mock('@tauri-apps/api/core', () => ({ invoke }))
const file = {
  fileName: 'song.mp3',
  sizeBytes: 3,
  extension: 'mp3',
  mimeType: 'audio/mpeg',
  sha256: 'a'.repeat(64),
}

describe('native download verification', () => {
  it('supplies only exact filename, byte length and digest to the native directory boundary', async () => {
    invoke.mockReset().mockResolvedValue(true)
    expect(await verifyNativeDownload(file, new AbortController().signal)).toBe(true)
    expect(invoke).toHaveBeenCalledExactlyOnceWith('verify_download', {
      requestId: expect.any(String),
      fileName: file.fileName,
      sizeBytes: 3,
      sha256: file.sha256,
    })
    expect(
      await verifyNativeDownload({ ...file, sha256: undefined }, new AbortController().signal),
    ).toBe(false)
    expect(invoke).toHaveBeenCalledOnce()
  })

  it('cancels native hashing and rejects late successful verification', async () => {
    let finish!: (matches: boolean) => void
    invoke.mockReset().mockImplementation(async (name) =>
      name === 'verify_download'
        ? new Promise<boolean>((resolve) => {
            finish = resolve
          })
        : undefined,
    )
    const controller = new AbortController()
    const pending = verifyNativeDownload(file, controller.signal)
    controller.abort()
    finish(true)
    await expect(pending).rejects.toMatchObject({ code: 'operation-cancelled' })
    expect(invoke).toHaveBeenLastCalledWith('cancel_request', {
      requestId: invoke.mock.calls[0]![1].requestId,
    })
  })
})
