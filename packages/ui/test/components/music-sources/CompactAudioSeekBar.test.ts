import CompactAudioSeekBar from '@any-music/ui/components/music-sources/CompactAudioSeekBar.vue'
import { describe, expect, it } from 'vitest'
import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'

describe('CompactAudioSeekBar input contract', () => {
  it('exposes an isolated horizontal slider with clamped position and keyboard access', async () => {
    const html = await renderToString(
      createSSRApp({
        render: () =>
          h(CompactAudioSeekBar, {
            positionMs: 120_000,
            durationMs: 100_000,
            bufferedUntilMs: 60_000,
            disabled: false,
          }),
      }),
    )
    expect(html).toContain('data-player-seek')
    expect(html).toContain('role="slider"')
    expect(html).toContain('aria-orientation="horizontal"')
    expect(html).toContain('aria-label="播放进度"')
    expect(html).toContain('aria-valuenow="100000"')
    expect(html).toContain('aria-valuetext="1:40.0"')
    expect(html).toContain('tabindex="0"')
  })

  it.each([undefined, 0, Number.NaN])(
    'prevents seeking or keyboard focus without duration %s',
    async (durationMs) => {
      const html = await renderToString(
        createSSRApp({
          render: () =>
            h(CompactAudioSeekBar, {
              positionMs: 10_000,
              durationMs,
              bufferedUntilMs: 0,
              disabled: false,
            }),
        }),
      )
      expect(html).toContain('aria-disabled="true"')
      expect(html).toContain('tabindex="-1"')
      expect(html).toContain('aria-valuenow="0"')
    },
  )
})
