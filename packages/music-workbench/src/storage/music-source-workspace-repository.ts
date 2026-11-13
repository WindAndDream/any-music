import {
  sanitizeMusicSourceWorkspaceSnapshot,
  type MusicSourceWorkspaceSnapshot,
} from '../features/music-sources/music-source-workspace-state'
import { readStored, writeStored } from '../runtime/storage'

const STORAGE_KEY = 'music-source-workspace:v1'

/** 稳定存储保存请求、结果元数据与分页位置；不保存媒体数据或账号会话。 */
export const musicSourceWorkspaceRepository = {
  load(): MusicSourceWorkspaceSnapshot {
    return sanitizeMusicSourceWorkspaceSnapshot(readStored<unknown>(STORAGE_KEY, undefined))
  },

  save(snapshot: MusicSourceWorkspaceSnapshot): void {
    writeStored(STORAGE_KEY, snapshot)
  },
}
