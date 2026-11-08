import { provideCardPresentation } from '@any-music/card-styles/vue'
import type { Track } from '@any-music/core'
import { describe, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick, reactive, shallowRef } from 'vue'

import StudioStyledTrack from '../../../src/components/library/StudioStyledTrack.vue'
import { findStudioNode, invokeStudio, mountStudio } from '../../helpers/test-renderer'

const track: Track = {
  id: 'one',
  title: '音乐',
  artists: [],
  source: { pluginId: 'test', resourceId: 'one', mediaKind: 'audio' },
}

describe('Studio styled track playback', () => {
  it('pauses/resumes only the real current song and keeps operator selection independent', async () => {
    const player = reactive({ track, playing: true, positionMs: 250, durationMs: 1000 })
    const selectable = shallowRef(false)
    const pause = vi.fn(() => {
      player.playing = false
    })
    const resume = vi.fn(() => {
      player.playing = true
    })
    const play = vi.fn(),
      select = vi.fn()
    const view = mountStudio(
      defineComponent({
        setup() {
          provideCardPresentation({
            itemStyle: () => 'minimal',
            player: () => player,
            actions: { play: resume, pause },
          })
          return () =>
            h(StudioStyledTrack, {
              track,
              title: track.title,
              selectable: selectable.value,
              onPlay: play,
              onSelect: select,
            })
        },
      }),
      {},
    )
    const cover = () =>
      findStudioNode(view.root, (node) => node.props['data-am-focus-key'] === 'track:one:play')
    try {
      expect(cover().props.title).toBe('正在播放，点击暂停')
      invokeStudio(cover(), 'onClick')
      await nextTick()
      expect(pause).toHaveBeenCalledOnce()
      expect(cover().props['aria-label']).toBe('播放《音乐》')
      invokeStudio(cover(), 'onClick')
      await nextTick()
      expect(resume).toHaveBeenCalledOnce()
      expect(play).not.toHaveBeenCalled()

      selectable.value = true
      await nextTick()
      expect(cover().props['aria-label']).toBe('选择歌曲 音乐')
      invokeStudio(cover(), 'onClick')
      expect(select).toHaveBeenCalledOnce()
      expect(pause).toHaveBeenCalledOnce()
      expect(resume).toHaveBeenCalledOnce()

      selectable.value = false
      player.track = { ...track, id: 'other' }
      await nextTick()
      invokeStudio(cover(), 'onClick')
      expect(play).toHaveBeenCalledOnce()
      expect(pause).toHaveBeenCalledOnce()
      expect(resume).toHaveBeenCalledOnce()
    } finally {
      view.unmount()
    }
  })
})
