// 控制栏与待听页从 UI 包读取同一份模式说明，避免两处弹窗文案漂移。
export { playbackModeOptions } from '@any-music/ui'

export type PlayerSettingKind = 'mode' | 'quality' | 'rate' | 'volume'

export const playbackRateOptions = [0.5, 0.75, 1, 1.25, 1.5, 2] as const
