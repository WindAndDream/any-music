import { describe, expect, it } from 'vitest'

import {
  mapDouyinAweme,
  mapDouyinMusic,
  resolveDouyinAwemeMedia,
  resolveDouyinMusicMedia,
} from '../src/track-mappers'

describe('Douyin track mapping', () => {
  it('keeps only stable identifiers in normal video tracks and resolves the full media', () => {
    const aweme = {
      aweme_id: '10001',
      desc: '#古风 完整人声',
      create_time: 1_700_000_000,
      author: { sec_uid: 'author-sec', nickname: '作者' },
      video: {
        duration: 31_000,
        cover: { url_list: ['https://img.example/cover.jpg'] },
        play_addr: { url_list: ['https://video.example/full.mp4'] },
      },
      music: { duration: 31, play_url: { url_list: ['https://music.example/bgm.mp3'] } },
      text_extra: [{ hashtag_name: '古风' }],
      statistics: { play_count: 12, digg_count: 3 },
    }
    const track = mapDouyinAweme(aweme)
    expect(track).toMatchObject({
      id: 'douyin:video:10001',
      durationMs: 31_000,
      sourceTags: ['古风'],
      source: { resourceId: '10001', partId: 'video' },
    })
    expect(JSON.stringify(track)).not.toContain('video.example')
    expect(resolveDouyinAwemeMedia(aweme)).toMatchObject({
      url: 'https://video.example/full.mp4',
      mimeType: 'video/mp4',
      requestHeaders: { Referer: 'https://www.douyin.com/' },
    })
  })

  it('maps image posts as notes and resolves their music instead of an absent video', () => {
    const aweme = {
      awemeId: '20002',
      awemeType: 68,
      desc: '图文作品',
      images: [{ urlList: ['https://img.example/note.jpg'] }],
      music: { duration: 35, playUrl: { urlList: ['https://music.example/note.mp3'] } },
    }
    expect(mapDouyinAweme(aweme)).toMatchObject({
      sourceTags: ['图文'],
      source: { partId: 'note', pageUrl: 'https://www.douyin.com/note/20002' },
    })
    expect(resolveDouyinAwemeMedia(aweme)).toMatchObject({
      url: 'https://music.example/note.mp3',
      mimeType: 'audio/mpeg',
      durationMs: 35_000,
    })
  })

  it('maps collected music without persisting its temporary play URL', () => {
    const music = {
      id: 7_536_041_373_540_075_500,
      id_str: '7536041373540075558',
      title: 'Track in Time',
      author: '音乐人',
      duration: 42,
      play_url: { url_list: ['https://music.example/current.mp3'] },
    }
    const track = mapDouyinMusic(music)
    expect(track).toMatchObject({
      id: 'douyin:music:7536041373540075558',
      durationMs: 42_000,
      source: { mediaKind: 'audio', resourceId: '7536041373540075558', partId: 'music' },
    })
    expect(JSON.stringify(track)).not.toContain('current.mp3')
    expect(resolveDouyinMusicMedia(music)).toMatchObject({
      url: 'https://music.example/current.mp3',
      mimeType: 'audio/mpeg',
    })
  })

  it('defaults to the highest independent audio bitrate and validates quality switches', () => {
    const aweme = {
      aweme_id: 'quality-test',
      video: {
        duration: 60_000,
        bit_rate_audio_list: [
          {
            bit_rate: 64_000,
            quality_type: 1,
            gear_name: 'audio_low',
            play_addr: {
              url_list: ['https://audio.example/low.m4a', 'https://backup.example/low.m4a'],
            },
          },
          {
            bit_rate: 192_000,
            quality_type: 3,
            gear_name: 'audio_high',
            play_addr: { url_list: ['https://audio.example/high.m4a'] },
          },
        ],
      },
    }

    const highest = resolveDouyinAwemeMedia(aweme)
    expect(highest).toMatchObject({
      url: 'https://audio.example/high.m4a',
      quality: { rank: 192_000, bitrate: 192_000 },
    })
    expect(highest.availableQualities.map(({ rank }) => rank)).toEqual([192_000, 64_000])

    const lowerQualityId = highest.availableQualities[1]?.id
    const lower = resolveDouyinAwemeMedia(aweme, undefined, {
      qualityId: lowerQualityId,
    })
    expect(lower).toMatchObject({
      url: 'https://audio.example/low.m4a',
      backupUrls: ['https://backup.example/low.m4a'],
      quality: { id: lowerQualityId, rank: 64_000 },
    })
    expect(() => resolveDouyinAwemeMedia(aweme, undefined, { qualityId: 'audio:unknown' })).toThrow(
      '所选抖音音质当前不可用',
    )
  })

  it('does not expose DASH video-only representations as audio choices', () => {
    const aweme = {
      aweme_id: 'full-work-test',
      video: {
        duration: 30_000,
        bit_rate: [
          {
            bit_rate: 2_000_000,
            gear_name: 'normal_1080_0',
            play_addr: {
              url_list: ['https://video.example/media-video-hvc1/stream?br=2000'],
            },
          },
          {
            bit_rate: 900_000,
            gear_name: 'normal_720_0',
            play_addr: { url_list: ['https://video.example/combined.mp4?br=900'] },
          },
        ],
      },
    }

    const source = resolveDouyinAwemeMedia(aweme)
    expect(source).toMatchObject({
      url: 'https://video.example/combined.mp4?br=900',
      quality: { label: '720P 标准 · MP4 · 900 kbps', rank: 900_000 },
    })
    expect(source.availableQualities).toHaveLength(1)
  })

  it('prefers the complete playback address over ambiguous bitrate video representations', () => {
    const aweme = {
      aweme_id: 'complete-before-dash',
      video: {
        duration: 30_000,
        play_addr: { url_list: ['https://video.example/complete.mp4'] },
        bit_rate: [
          {
            bit_rate: 2_000_000,
            play_addr: { url_list: ['https://video.example/ambiguous-representation.mp4'] },
          },
        ],
      },
    }

    const source = resolveDouyinAwemeMedia(aweme)
    expect(source).toMatchObject({
      url: 'https://video.example/complete.mp4',
      backupUrls: [],
    })
    expect(source.availableQualities).toHaveLength(1)
  })

  it('numbers otherwise indistinguishable platform qualities in response order', () => {
    const aweme = {
      aweme_id: 'unnamed-quality-test',
      video: {
        duration: 20_000,
        bit_rate_audio_list: [
          { play_addr: { url_list: ['https://audio.example/first.m4a'] } },
          { play_addr: { url_list: ['https://audio.example/second.m4a'] } },
        ],
      },
    }

    const highest = resolveDouyinAwemeMedia(aweme)
    expect(highest).toMatchObject({
      url: 'https://audio.example/first.m4a',
      quality: { label: '音质 1 · M4A', rank: 2 },
    })
    expect(highest.availableQualities).toMatchObject([
      { label: '音质 1 · M4A', rank: 2 },
      { label: '音质 2 · M4A', rank: 1 },
    ])

    expect(
      resolveDouyinAwemeMedia(aweme, undefined, {
        qualityId: highest.availableQualities[1]?.id,
      }),
    ).toMatchObject({ url: 'https://audio.example/second.m4a' })
  })
})
