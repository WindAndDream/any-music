/** Readonly cache information; native paths are display text and never file-write authority. */
export interface ResourceCacheSnapshot {
  capacityBytes: number
  usedBytes: number
  imageBytes: number
  audioBytes: number
  entryCount: number
  memoryCapacityBytes: number
  memoryUsedBytes: number
  memoryEntryCount: number
  directory: string
  customDirectory: boolean
  canChooseDirectory: boolean
  description?: string
}
export const MIN_RESOURCE_CACHE_MIB = 128
export const MAX_RESOURCE_CACHE_MIB = 102400
export const DEFAULT_MEMORY_CACHE_MIB = 64
export const MAX_MEMORY_CACHE_MIB = 1024
