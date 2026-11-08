/** 用户编辑的片段区间使用来源曲目的时间轴，统一采用毫秒和左闭右开区间。 */
export interface SegmentRecipe {
  sourceTrackId: string
  startMs: number
  endMs: number
}

/** 编译结果只引用普通平台曲目，并附带在自定义歌曲中的虚拟时间轴。 */
export interface CompiledSegmentRecipe extends SegmentRecipe {
  virtualStartMs: number
  virtualEndMs: number
}
/** Encoded output formats supported by the optional browser engine. */
export type AudioExportFormat = 'mp3' | 'wav'
