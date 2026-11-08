import { providePlaylistPickerPresentation } from '@any-music/ui/library'
import { describe, expect, it } from 'vitest'
import { createSSRApp, defineComponent, h } from 'vue'
import { renderToString } from 'vue/server-renderer'

import StudioPlaylistPickerDialog from '../../../src/components/library/StudioPlaylistPickerDialog.vue'

describe('Studio playlist picker', () => {
  it('uses the library cover card, host artwork and tags with selection controls', async () => {
    const html = await renderToString(
      createSSRApp(
        defineComponent({
          setup() {
            providePlaylistPickerPresentation({
              coverUrls: () => ({ cover: 'data:image/png;base64,AAAA' }),
              customTagsByPlaylistId: () => new Map([['p', ['通勤']]]),
              mobileLayout: () => true,
            })
            return () =>
              h(StudioPlaylistPickerDialog, {
                open: true,
                selectedCount: 1,
                playlists: [
                  {
                    id: 'p',
                    name: '我的通勤',
                    coverId: 'cover',
                    trackIds: [],
                    createdAtMs: 1,
                    updatedAtMs: 1,
                  },
                ],
              })
          },
        }),
      ),
    )
    expect(html).toContain('am-cover-playlist')
    expect(html).toContain('src="data:image/png;base64,AAAA"')
    expect(html).toContain('referrerpolicy="no-referrer"')
    expect(html).toContain('aria-label="选择歌单 我的通勤"')
    expect(html).toContain('studio-playlist-picker--mobile')
    expect(html).not.toContain('data-queue-handle')
    expect(html).not.toContain('查看 我的通勤 的详细信息')
  })
})
