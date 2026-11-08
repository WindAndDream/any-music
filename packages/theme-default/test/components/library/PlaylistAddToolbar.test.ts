import type { MusicPlaylist } from '@any-music/core'
import { describe, expect, it } from 'vitest'
import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'

import PlaylistAddToolbar from '../../../src/components/library/PlaylistAddToolbar.vue'

const playlist: MusicPlaylist = {
  id: 'playlist:test',
  name: '通勤',
  trackIds: [],
  createdAtMs: 1,
  updatedAtMs: 1,
}

interface ToolbarOverrides {
  playlists?: readonly MusicPlaylist[]
  selectedCount?: number
  canAddToPlaylist?: boolean
}

/** 通过真实 SFC 编译和 Vue prop 解析渲染，防止 Boolean 默认值再次隐藏入口。 */
function renderToolbar(overrides: ToolbarOverrides = {}): Promise<string> {
  return renderToString(
    createSSRApp({
      render: () =>
        h(PlaylistAddToolbar, {
          playlists: [playlist],
          selectedCount: 1,
          areAllVisibleSelected: false,
          areSomeVisibleSelected: false,
          visibleCount: 1,
          ...overrides,
        }),
    }),
  )
}

describe('PlaylistAddToolbar', () => {
  it('未传入 canAddToPlaylist 时默认显示加入歌单入口', async () => {
    const html = await renderToolbar()

    expect(html).toContain('aria-haspopup="dialog"')
    expect(html).toContain('加入歌单')
  })

  it('只在显式关闭时隐藏加入歌单入口', async () => {
    const html = await renderToolbar({ canAddToPlaylist: false })

    expect(html).not.toContain('aria-haspopup="dialog"')
    expect(html).not.toContain('加入歌单')
  })

  it('没有歌单或未选歌曲时保留入口并禁用操作', async () => {
    const html = await renderToolbar({ playlists: [], selectedCount: 0 })

    expect(html).toContain('aria-haspopup="dialog"')
    expect(html).not.toContain('<select')
    expect(html).toContain('加入歌单')
    expect(html).toContain('disabled')
  })
})
