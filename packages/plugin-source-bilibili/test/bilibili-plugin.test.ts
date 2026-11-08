import type { Track } from '@any-music/core'
import { describe, expect, it } from 'vitest'

import type { BilibiliApi } from '../src/bilibili-api'
import { BilibiliMusicSourcePlugin } from '../src/bilibili-plugin'

const VIDEO_TRACK: Track = {
  id: 'bilibili:video:BV-test',
  title: '测试视频',
  artists: [{ id: '1', name: '测试 UP' }],
  durationMs: 120_000,
  source: {
    pluginId: 'bilibili',
    mediaKind: 'video',
    resourceId: 'BV-test',
    partId: 'cid-test',
    pageUrl: 'https://www.bilibili.com/video/BV-test',
  },
}

describe('Bilibili media resolution', () => {
  it('resumes a retained listing directly at the next page without requesting earlier pages', async () => {
    const pages: number[] = []
    const plugin = new BilibiliMusicSourcePlugin({
      async searchVideos(_query: string, page: number, size: number) {
        pages.push(page)
        return { page, pagesize: size, numResults: 100, result: [] }
      },
    } as unknown as BilibiliApi)
    const listing = plugin.search({ query: '音乐' })
    const pagesToResume = listing.pages({ continuation: { kind: 'page', nextPage: 3 } })
    const iterator = pagesToResume[Symbol.asyncIterator]()
    expect(pages).toEqual([])
    const next = await iterator.next()
    expect(pages).toEqual([3])
    expect(next.value).toMatchObject({ pageNumber: 3, continuation: { kind: 'page', nextPage: 4 } })
    await iterator.return?.()
  })
  it('keeps the bandwidth-efficient DASH audio path on Bilibili pages', async () => {
    const calls: string[] = []
    const api = {
      async getVideoPlayUrl() {
        calls.push('dash')
        return {
          timelength: 120_000,
          dash: {
            audio: [
              {
                id: 30216,
                bandwidth: 64_000,
                baseUrl: 'https://media.example/low.m4s',
                codecs: 'mp4a.40.2',
              },
              {
                id: 30280,
                bandwidth: 128_000,
                baseUrl: 'https://media.example/high.m4s',
                backupUrl: ['https://backup.example/high.m4s'],
                mimeType: 'audio/mp4',
                codecs: 'mp4a.40.2',
              },
            ],
          },
        }
      },
      async getHtml5VideoPlayUrl() {
        calls.push('html5')
        return { durl: [] }
      },
    } as unknown as BilibiliApi

    const source = await new BilibiliMusicSourcePlugin(api, () => true).resolveMedia(VIDEO_TRACK)

    expect(source).toMatchObject({
      type: 'remote-url',
      url: 'https://media.example/high.m4s',
      backupUrls: ['https://backup.example/high.m4s'],
      quality: {
        id: 'dash:30280:mp4a.40.2',
        label: 'AAC · 128 kbps',
        rank: 128_000,
        bitrate: 128_000,
      },
      requestHeaders: { Referer: 'https://www.bilibili.com/' },
      mimeType: 'audio/mp4',
      codecs: 'mp4a.40.2',
    })
    expect(source.availableQualities.map(({ id }) => id)).toEqual([
      'dash:30280:mp4a.40.2',
      'dash:30216:mp4a.40.2',
    ])
    expect(calls).toEqual(['dash'])
  })

  it('validates and resolves a requested DASH audio quality', async () => {
    const api = {
      async getVideoPlayUrl() {
        return {
          dash: {
            audio: [
              {
                id: 30216,
                bandwidth: 64_000,
                baseUrl: 'https://media.example/low.m4s',
                codecs: 'mp4a.40.2',
              },
              {
                id: 30280,
                bandwidth: 128_000,
                baseUrl: 'https://media.example/high.m4s',
                codecs: 'mp4a.40.2',
              },
            ],
          },
        }
      },
    } as unknown as BilibiliApi
    const plugin = new BilibiliMusicSourcePlugin(api, () => true)

    await expect(
      plugin.resolveMedia(VIDEO_TRACK, { qualityId: 'dash:30216:mp4a.40.2' }),
    ).resolves.toMatchObject({
      url: 'https://media.example/low.m4s',
      quality: { id: 'dash:30216:mp4a.40.2' },
    })
    await expect(
      plugin.resolveMedia(VIDEO_TRACK, { qualityId: 'dash:unknown:unknown' }),
    ).rejects.toMatchObject({ code: 'invalid-input' })
  })

  it('uses the range-capable HTML5 stream on non-Bilibili host pages', async () => {
    const calls: string[] = []
    const api = {
      async getVideoPlayUrl() {
        calls.push('dash')
        return { dash: { audio: [] } }
      },
      async getHtml5VideoPlayUrl(_bvid: string, _cid: string, quality = 127) {
        calls.push(`html5:${quality}`)
        return {
          quality: quality === 16 ? 16 : 64,
          accept_quality: [80, 64, 16],
          accept_description: ['高清 1080P', '高清 720P', '流畅 360P'],
          timelength: 120_000,
          durl: [
            {
              url: `https://media.example/cross-site-${quality === 16 ? 'low' : 'high'}.mp4`,
              backup_url: ['https://backup.example/cross-site.mp4'],
            },
          ],
        }
      },
    } as unknown as BilibiliApi

    const plugin = new BilibiliMusicSourcePlugin(api, () => false)
    const source = await plugin.resolveMedia(VIDEO_TRACK)

    expect(source).toMatchObject({
      type: 'remote-url',
      url: 'https://media.example/cross-site-high.mp4',
      backupUrls: ['https://backup.example/cross-site.mp4'],
      quality: { id: 'html5:64', label: '高清 720P · 兼容流', rank: 64 },
      requestHeaders: { Referer: 'https://www.bilibili.com/' },
      mimeType: 'video/mp4',
      durationMs: 120_000,
      loadingStrategy: 'range',
    })
    expect(source.availableQualities.map(({ id }) => id)).toEqual(['html5:64', 'html5:16'])

    const lowerSource = await plugin.resolveMedia(VIDEO_TRACK, { qualityId: 'html5:16' })
    expect(lowerSource).toMatchObject({
      url: 'https://media.example/cross-site-low.mp4',
      quality: { id: 'html5:16', label: '流畅 360P · 兼容流' },
    })
    expect(calls).toEqual(['html5:127', 'html5:16'])
  })
})
