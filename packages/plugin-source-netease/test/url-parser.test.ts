import { describe, expect, it } from 'vitest'

import {
  createNeteaseSourceModule,
  NETEASE_BUILT_IN_TARGETS,
  parseNeteaseImportUrl,
} from '../src/index'

describe('NetEase lightweight URL metadata', () => {
  it.each(['song', 'playlist', 'album', 'artist'])(
    'normalizes %s desktop/hash/mobile links',
    (kind) => {
      for (const path of [`/${kind}?id=123`, `/#/${kind}?id=123`, `/m/${kind}?id=123&userid=5`])
        expect(parseNeteaseImportUrl(`https://music.163.com${path}`)).toEqual({
          kind,
          id: '123',
          url: `https://music.163.com/${kind}?id=123`,
        })
    },
  )
  it.each([
    'https://music.163.com.evil.example/song?id=1',
    'https://evil@music.163.com/song?id=1',
    'http://music.163.com/song?id=1',
    'https://music.163.com:8443/song?id=1',
    'https://music.163.com/song?id=1&id=2',
    'https://music.163.com/song?id=0',
    'https://music.163.com/song?id=1.5',
    'https://music.163.com/song?id=9007199254740992',
    'https://music.163.com/djradio?id=1',
    'https://music.163.com/playlist?id=1#/song?id=2',
  ])('rejects invalid scope or ID %s locally', (url) => {
    expect(() => parseNeteaseImportUrl(url)).toThrow()
  })
  it('keeps native mobile out of desktop-only source admission', () => {
    expect(NETEASE_BUILT_IN_TARGETS).toEqual(['userscript', 'desktop'])
    expect(createNeteaseSourceModule('tauri')).toMatchObject({
      id: 'source.netease',
      contributions: [{ implementationId: 'netease' }],
    })
  })
})
