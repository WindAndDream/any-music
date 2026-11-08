/**
 * 播放队列支持的顺序语义。
 * `shuffle` 允许跨次重复，`shuffle-no-repeat` 则在一轮覆盖全部曲目前使用洗牌袋去重。
 */
export type PlaybackMode = 'sequence' | 'repeat-one' | 'shuffle' | 'shuffle-no-repeat'
