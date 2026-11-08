import type { PlaybackMode } from '@any-music/core'

/** 待听与播放器共用同一组播放顺序文案和可选值。 */
export const playbackModeOptions: readonly {
  value: PlaybackMode
  label: string
  shortLabel: string
  description: string
}[] = [
  {
    value: 'sequence',
    label: '顺序播放',
    shortLabel: '顺序',
    description: '按列表顺序播放，播完从头开始。',
  },
  {
    value: 'repeat-one',
    label: '单曲循环',
    shortLabel: '单曲',
    description: '当前歌曲结束后继续播放这一首。',
  },
  {
    value: 'shuffle',
    label: '随机播放',
    shortLabel: '随机',
    description: '每次随机选歌，可能连续选到同一首。',
  },
  {
    value: 'shuffle-no-repeat',
    label: '随机不重复',
    shortLabel: '不重复',
    description: '每轮听完所有歌曲前不重复。',
  },
]
