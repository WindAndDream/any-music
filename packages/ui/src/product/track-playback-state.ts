/** 播放标记属于实际媒体曲目；未选择、解析中和失败时不以队列选中项推断播放状态。 */
export interface TrackPlaybackState {
  trackId: string
  status: 'playing' | 'paused'
}
