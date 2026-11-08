import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'

import type { PlayerSettingKind } from '../../../src/components/player/player-control-options'
import PlayerSettingsDialog from '../../../src/components/player/PlayerSettingsDialog.vue'

beforeEach(() => {
  // AppDialog 只在 setup 注册键盘事件；SSR 仍编译真实弹窗和选择控件。
  vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() })
})

afterEach(() => vi.unstubAllGlobals())

function renderSetting(setting: PlayerSettingKind): Promise<string> {
  return renderToString(
    createSSRApp({
      render: () =>
        h(PlayerSettingsDialog, {
          setting,
          mode: 'shuffle-no-repeat',
          qualityOptions: [{ id: 'high', label: '高音质', rank: 2 }],
          selectedQualityId: 'high',
          playbackRate: 1.25,
          volume: 0.55,
        }),
    }),
  )
}

describe('PlayerSettingsDialog', () => {
  it('显示完整四种播放顺序及当前选择', async () => {
    const html = await renderSetting('mode')

    for (const label of ['顺序播放', '单曲循环', '随机播放', '随机不重复']) {
      expect(html).toContain(label)
    }
    expect(html).toMatch(/aria-pressed="true"[^>]*>\s*<span[^>]*>\s*<strong[^>]*>随机不重复/)
  })

  it('分别呈现音质、倍速和音量调节', async () => {
    expect(await renderSetting('quality')).toContain('高音质')
    expect(await renderSetting('rate')).toContain('1.25×')
    const volumeHtml = await renderSetting('volume')
    expect(volumeHtml).toContain('音量 55%')
    expect(volumeHtml).toContain('type="range"')
  })
})
