import { afterEach, describe, expect, it, vi } from 'vitest'
import { effectScope } from 'vue'

import {
  preparePlaylistCover,
  usePlaylistCoverUpload,
} from '../../../src/composables/library/use-playlist-cover-upload'

const jpeg = () =>
  new File([new Uint8Array([255, 216, 255, 0])], 'cover.jpg', { type: 'image/jpeg' })
afterEach(() => vi.unstubAllGlobals())
describe('playlist cover upload', () => {
  it('rejects unsupported extensions, oversized files and disguised bytes before decoding', async () => {
    const decode = vi.fn()
    vi.stubGlobal('createImageBitmap', decode)
    await expect(
      preparePlaylistCover(new File(['<svg/>'], 'cover.svg', { type: 'image/svg+xml' })),
    ).rejects.toThrow(/JPG/)
    await expect(
      preparePlaylistCover(new File(['bad'], 'cover.png', { type: 'image/png' })),
    ).rejects.toThrow(/无法识别/)
    await expect(
      preparePlaylistCover(new File([new Uint8Array(5 * 1024 ** 2 + 1)], 'cover.jpg')),
    ).rejects.toThrow(/5 MB/)
    expect(decode).not.toHaveBeenCalled()
  })
  it('preserves the full image and releases pixels even if a canceled selection finishes late', async () => {
    const scope = effectScope()
    const upload = scope.run(() => usePlaylistCoverUpload(() => 'existing'))!
    const close = vi.fn()
    let finish!: (value: unknown) => void
    let signalStarted!: () => void
    const started = new Promise<void>((resolve) => {
      signalStarted = resolve
    })
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(() => {
        signalStarted()
        return new Promise((resolve) => {
          finish = resolve
        })
      }),
    )
    const drawImage = vi.fn()
    vi.stubGlobal('document', {
      createElement: () => ({
        getContext: () => ({ fillRect: vi.fn(), drawImage }),
        toDataURL: () => 'data:image/jpeg;base64,AAAA',
      }),
    })
    const pending = upload.select(jpeg())
    await started
    upload.remove()
    finish({ width: 800, height: 400, close })
    await pending
    expect(drawImage).not.toHaveBeenCalled()
    expect(close).toHaveBeenCalledOnce()
    expect(upload.cover.value).toBeNull()
    expect(upload.preview.value).toBeUndefined()
    expect(upload.busy.value).toBe(false)
    scope.stop()
  })
  it('retains 1024px detail and retries encoding within a bounded size and work budget', async () => {
    const close = vi.fn()
    vi.stubGlobal('createImageBitmap', async () => ({ width: 3000, height: 2000, close }))
    const drawImage = vi.fn()
    const encode = vi
      .fn()
      .mockReturnValueOnce('A'.repeat(512 * 1024 + 1))
      .mockReturnValueOnce('data:image/jpeg;base64,AAAA')
    const canvas = {
      width: 0,
      height: 0,
      getContext: () => ({ fillRect: vi.fn(), drawImage }),
      toDataURL: encode,
    }
    vi.stubGlobal('document', { createElement: () => canvas })
    await expect(preparePlaylistCover(jpeg())).resolves.toBe('data:image/jpeg;base64,AAAA')
    expect([canvas.width, canvas.height]).toEqual([0, 0])
    expect(drawImage.mock.calls[0]?.slice(1)).toEqual([0, 0, 3000, 2000, 0, 0, 1024, 683])
    expect(encode.mock.calls).toEqual([
      ['image/jpeg', 0.9],
      ['image/jpeg', 0.8],
    ])
    expect(close).toHaveBeenCalledOnce()
    encode.mockReset().mockReturnValue('A'.repeat(512 * 1024 + 1))
    await expect(preparePlaylistCover(jpeg())).rejects.toThrow(/过于复杂/)
    expect(encode).toHaveBeenCalledTimes(3)
    expect(close).toHaveBeenCalledTimes(2)
  })
  it.each([
    { width: 400, height: 400, expected: [400, 400] },
    { width: 600, height: 900, expected: [600, 900] },
    { width: 2000, height: 3000, expected: [683, 1024] },
  ])(
    'preserves $width × $height artwork without upscaling',
    async ({ width, height, expected }) => {
      const close = vi.fn()
      vi.stubGlobal('createImageBitmap', async () => ({ width, height, close }))
      const canvas = {
        width: 0,
        height: 0,
        getContext: () => ({ fillRect: vi.fn(), drawImage: vi.fn() }),
        toDataURL: () => 'data:image/jpeg;base64,AAAA',
      }
      vi.stubGlobal('document', { createElement: () => canvas })
      const draw = vi.fn()
      canvas.getContext = () => ({ fillRect: vi.fn(), drawImage: draw })
      await preparePlaylistCover(jpeg())
      expect(draw.mock.calls[0]?.slice(-2)).toEqual(expected)
      expect(close).toHaveBeenCalledOnce()
    },
  )
  it('keeps the current cover until confirmation and decodes the selected image only once', async () => {
    const scope = effectScope()
    const upload = scope.run(() => usePlaylistCoverUpload(() => 'existing'))!
    const close = vi.fn()
    const decode = vi.fn(async () => ({ width: 1600, height: 1000, close }))
    vi.stubGlobal('createImageBitmap', decode)
    const drawImage = vi.fn()
    vi.stubGlobal('document', {
      createElement: () => ({
        getContext: () => ({ fillRect: vi.fn(), drawImage }),
        toDataURL: () => 'data:image/jpeg;base64,CROP',
      }),
    })
    try {
      await upload.select(jpeg())
      expect(upload.source.value).toBeDefined()
      expect(upload.preview.value).toBe('existing')
      expect(drawImage).not.toHaveBeenCalled()
      upload.confirmCrop({ x: 400, y: 100, width: 800, height: 500 })
      expect(drawImage.mock.calls[0]?.slice(1)).toEqual([400, 100, 800, 500, 0, 0, 800, 500])
      expect(upload.preview.value).toBe('data:image/jpeg;base64,CROP')
      expect(upload.source.value).toBeNull()
      expect(decode).toHaveBeenCalledOnce()
      expect(close).toHaveBeenCalledOnce()
    } finally {
      scope.stop()
    }
  })
  it('preserves the saved cover on cancellation or invalid crop and releases pending pixels on disposal', async () => {
    const scope = effectScope()
    const upload = scope.run(() => usePlaylistCoverUpload(() => 'existing'))!
    const close = vi.fn()
    vi.stubGlobal('createImageBitmap', async () => ({ width: 800, height: 400, close }))
    await upload.select(jpeg())
    upload.confirmCrop({ x: 799, y: 0, width: 20, height: 20 })
    expect(upload.error.value).toContain('范围无效')
    expect(upload.preview.value).toBe('existing')
    expect(close).not.toHaveBeenCalled()
    upload.cancelCrop()
    expect(upload.preview.value).toBe('existing')
    expect(close).toHaveBeenCalledOnce()
    await upload.select(jpeg())
    scope.stop()
    expect(close).toHaveBeenCalledTimes(2)
    expect(upload.source.value).toBeNull()
  })
})
