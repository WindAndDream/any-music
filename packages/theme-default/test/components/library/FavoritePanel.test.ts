import type { LibraryTrackRecord } from '@any-music/core'
import { provideConfirmationDialog } from '@any-music/ui/library'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'

import FavoritePanel from '../../../src/components/library/FavoritePanel.vue'

const records: LibraryTrackRecord[] = ['one', 'two', 'not-liked'].map((id, index) => ({
  track: {
    id,
    title: `歌曲 ${id}`,
    artists: [],
    source: { pluginId: index === 1 ? 'b' : 'a', mediaKind: 'audio', resourceId: id },
  },
  favoritedAtMs: index === 2 ? undefined : Date.UTC(2026, 9, 10 + index),
  customTags: [],
  addedAtMs: 0,
  updatedAtMs: 0,
}))
beforeEach(() =>
  vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() }),
)
afterEach(() => vi.unstubAllGlobals())
function render(arrangementMode: 'flat' | 'platform', mobileLayout = false, items = records) {
  return renderToString(
    createSSRApp({
      setup() {
        provideConfirmationDialog()
        return () =>
          h(FavoritePanel, {
            records: items,
            arrangementMode,
            mobileLayout,
            platformNames: new Map([
              ['a', '平台 A'],
              ['b', '平台 B'],
            ]),
            errorMessage: '',
            downloadBusy: false,
          })
      },
    }),
  )
}
describe('FavoritePanel', () => {
  it('uses queue cards and arrangement controls with favorite dates and wording', async () => {
    const html = await render('flat')
    expect(html).toContain('我的喜欢排列方式')
    expect(html).toContain('展示方式')
    expect(html.match(/data-queue-drop-kind="track"/g)).toHaveLength(2)
    expect(html).toContain('喜欢于')
    expect(html).not.toContain('添加于')
    expect(html).not.toContain('歌曲 not-liked')
    expect(html).not.toContain('收缩模式')
    expect(html).not.toContain('favorites__playback')
  })
  it('uses the same platform overview and mobile intro rules', async () => {
    const html = await render('platform', true)
    expect(html.match(/data-queue-drop-kind="platform"/g)).toHaveLength(2)
    expect(html).not.toContain('listen-queue__header')
    expect(html).not.toContain('data-queue-drop-kind="track"')
  })
  it('shows favorite-specific empty guidance', async () => {
    const html = await render('flat', false, [])
    expect(html).toContain('还没有喜欢的歌曲')
    expect(html).toContain('喜欢心动的歌曲')
    expect(html).not.toContain('还没有待听歌曲')
  })
})
