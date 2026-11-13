import { describe, expect, it } from 'vitest'
import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'

import PlayerControlActions from '../../../src/components/player/PlayerControlActions.vue'

/** 编译真实 SFC 验证各尺寸共用的受控入口，不启动浏览器界面。 */
async function renderActions(hasTrack: boolean): Promise<string> {
  return renderToString(
    createSSRApp({
      render: () =>
        h(PlayerControlActions, {
          mode: 'shuffle-no-repeat',
          playbackRate: 1.25,
          hasTrack,
          qualityDisabled: false,
        }),
    }),
  )
}

describe('PlayerControlActions', () => {
  it('显示当前顺序并保留四项设置入口', async () => {
    const html = await renderActions(true)

    expect(html).toContain('播放顺序：随机不重复')
    expect(html).toContain('选择音质')
    expect(html).toContain('播放倍速：1.25 倍')
    expect(html).toContain('调整音量')
    expect(html).toContain('下载当前音乐')
  })

  it('空播放器仍可设置偏好，但不会启用下载', async () => {
    const html = await renderActions(false)
    const downloadButton = html.match(/<button[^>]*aria-label="下载当前音乐"[^>]*>/)?.[0]
    const qualityButton = html.match(/<button[^>]*aria-label="选择音质"[^>]*>/)?.[0]

    expect(html).toContain('播放顺序：随机不重复')
    expect(downloadButton).toContain('disabled')
    expect(qualityButton).not.toContain('disabled')
  })
})
