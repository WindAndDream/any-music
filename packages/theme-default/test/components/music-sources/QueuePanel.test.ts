import type { Track } from '@any-music/core'
import { provideConfirmationDialog } from '@any-music/ui'
import type { TrackPlaybackState } from '@any-music/ui'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'

import QueuePanel from '../../../src/components/music-sources/QueuePanel.vue'

const tracks: Track[] = [
  createTrack('one', 'a'),
  createTrack('two', 'b'),
  createTrack('three', 'a'),
]

beforeEach(() => {
  vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() })
})
afterEach(() => vi.unstubAllGlobals())

/** SSR 编译真实面板，验证歌曲网格与平台入口的首屏契约。 */
function renderQueue(
  arrangementMode: 'flat' | 'platform',
  mobileLayout = false,
  options: { items?: readonly Track[]; playbackState?: TrackPlaybackState } = {},
): Promise<string> {
  return renderToString(
    createSSRApp({
      setup() {
        provideConfirmationDialog()
        return () =>
          h(QueuePanel, {
            items: options.items ?? tracks,
            currentTrackId: 'one',
            playbackState: options.playbackState,
            platformNames: new Map([
              ['a', '平台 A'],
              ['b', '平台 B'],
              ['local-custom', '名称不应用于识别拼接音乐'],
              ['remote-custom', '自定义音乐'],
            ]),
            arrangementMode,
            mobileLayout,
            errorMessage: '',
            downloadBusy: false,
          })
      },
    }),
  )
}

describe('QueuePanel', () => {
  it('omits the mobile intro while retaining arrangement controls and the full queue', async () => {
    const html = await renderQueue('flat', true)
    expect(html).not.toContain('listen-queue__header')
    expect(html).toContain('全部歌曲')
    expect(html).toContain('按平台')
    expect(html).not.toContain('平台切换')
    expect(html).toContain('展示方式')
    expect(html.match(/data-queue-drop-kind="track"/g)).toHaveLength(3)
  })
  it('shows shared track cards in queue order and replaces the old controls', async () => {
    const html = await renderQueue('flat')

    expect(html).not.toContain('listen-queue__mode')
    expect(html).not.toContain('播放顺序 ·')
    expect(html).not.toContain('搜索待听歌曲')
    expect(html).toContain('track__cover-select')
    expect(html).toContain('track__statistics')
    expect(html).toContain('添加时间未知')
    expect(html).toContain('待听排列方式')
    expect(html).toContain('展示方式')
    expect(html).not.toContain('平台切换')
    expect(html).not.toContain('>待听</span>')
    expect(html).toContain('喜欢')
    expect(html.indexOf('歌曲 one')).toBeLessThan(html.indexOf('歌曲 two'))
    expect(html.indexOf('歌曲 two')).toBeLessThan(html.indexOf('歌曲 three'))
    expect(html.match(/data-queue-drop-kind="track"/g)).toHaveLength(3)
    expect(html).toContain('方向键可逐首移动')
    expect(html).toContain('长按封面拖动排序')
    expect(html).not.toContain('queue-track__handle')
    expect(html).not.toContain('data-icon="drag"')
  })

  it('shows collection entries without mounting tracks or accordion controls', async () => {
    const html = await renderQueue('platform')

    expect(html.match(/data-queue-drop-kind="platform"/g)).toHaveLength(2)
    expect(html).toContain('平台 A')
    expect(html).toContain('平台 B')
    expect(html).toContain('data-queue-handle')
    expect(html).not.toContain('type="checkbox"')
    expect(html).not.toContain('data-icon="drag"')
    expect(html).toContain('长按平台卡片拖动排序')
    expect(html).not.toContain('data-queue-drop-kind="track"')
    expect(html).not.toContain('aria-expanded')
    expect(html).toContain('collection-grid')
    expect(html).not.toContain('待听浏览路径')
    expect(html).toContain('查看平台 A的歌曲')
    expect(readPlatformGroup(html, 'a')).toContain('2 首歌曲')
  })

  it('distinguishes local compositions from a source with the same display name', async () => {
    const customTrack = createTrack('local-song', 'local-custom')
    customTrack.source.mediaKind = 'custom'
    const html = await renderQueue('platform', false, {
      items: [...tracks, customTrack, createTrack('remote-song', 'remote-custom')],
    })
    const localGroup = readPlatformGroup(html, 'local-custom')
    const remoteGroup = readPlatformGroup(html, 'remote-custom')
    expect(localGroup).toContain('自定义音乐')
    expect(localGroup).toContain('本地拼接')
    expect(localGroup).toContain('1 首歌曲')
    expect(localGroup).not.toContain('名称不应用于识别')
    expect(remoteGroup).toContain('自定义音乐')
    expect(remoteGroup).not.toContain('本地拼接')
    expect(remoteGroup).toContain('1 首歌曲')
    expect(html.match(/data-queue-drop-kind="platform"/g)).toHaveLength(4)
    const pausedHtml = await renderQueue('platform', false, {
      items: [...tracks, customTrack],
      playbackState: { trackId: customTrack.id, status: 'paused' },
    })
    expect(readPlatformGroup(pausedHtml, 'local-custom')).toContain('已暂停')
  })

  it.each(['playing', 'paused'] as const)(
    'shows %s only on the actual playback platform, independently of queue selection',
    async (status) => {
      const html = await renderQueue('platform', false, {
        playbackState: { trackId: 'two', status },
      })
      expect(readPlatformGroup(html, 'b')).toContain(status === 'paused' ? '已暂停' : '正在播放')
      expect(readPlatformGroup(html, 'a')).not.toMatch(/正在播放|已暂停/)
    },
  )

  it.each([undefined, { trackId: 'preview', status: 'playing' as const }])(
    'omits playback badges for selection alone or a preview outside the queue (%j)',
    async (playbackState) => {
      const html = await renderQueue('platform', false, { playbackState })
      expect(html).not.toMatch(/正在播放|已暂停/)
    },
  )
})

function readPlatformGroup(html: string, id: string): string {
  const group = html.match(
    new RegExp(`<section\\b[^>]*data-queue-drop-id="${id}"[\\s\\S]*?</section>`),
  )?.[0]
  expect(group).toBeDefined()
  return group!
}

function createTrack(id: string, pluginId: string): Track {
  return {
    id,
    title: `歌曲 ${id}`,
    artists: [{ name: '作者' }],
    source: { pluginId, mediaKind: 'audio', resourceId: id },
  }
}
