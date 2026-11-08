import { describe, expect, it } from 'vitest'

import { getMusicSourceInputHints } from '../../../src/components/music-sources/source-input-hints'

describe('getMusicSourceInputHints', () => {
  it('uses Douyin concepts without leaking Bilibili wording', () => {
    const hints = getMusicSourceInputHints('douyin')

    expect(hints.searchPlaceholder).toBe('歌曲、作者或关键词')
    expect(hints.importPlaceholder).toBe('推荐 / 喜欢 / 收藏 / 合集 / 视频 URL')
    expect(JSON.stringify(hints)).not.toContain('UP')
  })
})
