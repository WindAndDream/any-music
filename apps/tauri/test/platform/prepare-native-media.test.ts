import type { ResolvedMediaSource } from '@any-music/core'
import { describe, expect, it, vi } from 'vitest'

import { prepareNativeMedia } from '../../src/platform/prepare-native-media'

function media(url: string, backupUrls: string[] = []): ResolvedMediaSource {
  return {
    type: 'remote-url',
    url,
    backupUrls,
    loadingStrategy: 'range',
    quality: { id: 'best', label: '最高', rank: 2 },
    availableQualities: [],
    release: vi.fn(),
  }
}
describe('native media preparation', () => {
  it('preserves native account grants and their owned release lifetime', async () => {
    const source = media('http://127.0.0.1:12345/media/a', ['http://127.0.0.1:12345/media/b'])
    expect(await prepareNativeMedia(source)).toBe(source)
    expect(source.release).not.toHaveBeenCalled()
  })
  it('rejects unbound primary or backup URLs and releases the rejected source', async () => {
    await Promise.all(
      [
        media('https://cdn.example/a'),
        media('http://127.0.0.1:12345/media/a', ['https://cdn.example/b']),
      ].map(async (source) => {
        await expect(prepareNativeMedia(source)).rejects.toMatchObject({
          code: 'unsupported-operation',
        })
        expect(source.release).toHaveBeenCalledOnce()
      }),
    )
  })
})
