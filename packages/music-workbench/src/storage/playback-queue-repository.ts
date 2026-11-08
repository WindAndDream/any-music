import {
  sanitizePlaybackQueueSnapshot,
  type PlaybackQueueSnapshot,
} from '../features/player/playback-queue-state'
import { readStored, writeStored } from '../runtime/storage'

const STORAGE_KEY = 'playback-queue:v1'

/** 待听只持久化稳定曲目 ID、排列设置与入队时间；Track 始终由本地资料库恢复。 */
export const playbackQueueRepository = {
  load(): PlaybackQueueSnapshot {
    return sanitizePlaybackQueueSnapshot(readStored<unknown>(STORAGE_KEY, undefined))
  },

  save(snapshot: PlaybackQueueSnapshot): void {
    writeStored(STORAGE_KEY, snapshot)
  },
}
