import { createAppErrorState, formatAppErrorMessage, toAppErrorState } from '@any-music/core'
import type { AppErrorState, PlaybackMode, Track } from '@any-music/core'
import { computed, readonly, shallowRef } from 'vue'

import { playbackQueueRepository } from '../../storage/playback-queue-repository'
import {
  createEmptyPlaybackQueue,
  MAX_PLAYBACK_QUEUE_ITEM_COUNT,
  PLAYBACK_QUEUE_SCHEMA_VERSION,
  reorderQueueIds,
} from './playback-queue-state'
import type { QueueArrangementMode } from './playback-queue-state'

interface UsePlaybackQueueOptions {
  resolveTrack: (trackId: string) => Track | undefined
  random?: () => number
  now?: () => number
}

/**
 * 待听列表负责持久化稳定曲目顺序，同时允许“我的喜欢”等资料库列表作为临时播放上下文。
 * 临时上下文不会改写待听，四种播放模式则继续共用同一套状态转换与洗牌袋语义。
 */
export function usePlaybackQueue(options: UsePlaybackQueueOptions) {
  const initial = loadInitialSnapshot()
  const random = options.random ?? Math.random
  const items = shallowRef<readonly Track[]>(
    initial.snapshot.trackIds
      .map(options.resolveTrack)
      .filter((track): track is Track => track !== undefined),
  )
  const playbackItems = shallowRef<readonly Track[]>(items.value)
  const addedAtMsByTrackId = shallowRef<ReadonlyMap<string, number>>(
    new Map(
      items.value.flatMap((track) => {
        const timestamp = initial.snapshot.addedAtMsByTrackId?.[track.id]
        return timestamp === undefined ? [] : [[track.id, timestamp] as const]
      }),
    ),
  )
  const playbackSource = shallowRef<'queue' | 'collection'>('queue')
  const currentTrackId = shallowRef<string>()
  const mode = shallowRef<PlaybackMode>(initial.snapshot.mode)
  const arrangementMode = shallowRef<QueueArrangementMode>(
    initial.snapshot.arrangementMode ?? 'flat',
  )
  const persistenceErrorState = shallowRef<AppErrorState | undefined>(initial.error)
  const persistenceError = computed(() =>
    persistenceErrorState.value ? formatAppErrorMessage(persistenceErrorState.value) : '',
  )
  const trackIds = computed<ReadonlySet<string>>(
    () => new Set(items.value.map((track) => track.id)),
  )
  const currentTrack = computed(() =>
    playbackItems.value.find((track) => track.id === currentTrackId.value),
  )

  const history: string[] = []
  let shuffleBag: string[] = []

  function add(track: Track) {
    if (trackIds.value.has(track.id)) {
      if (persistenceErrorState.value) persistNow()
      return
    }
    if (items.value.length >= MAX_PLAYBACK_QUEUE_ITEM_COUNT) {
      persistenceErrorState.value = createAppErrorState(
        'limit-exceeded',
        `待听最多保存 ${MAX_PLAYBACK_QUEUE_ITEM_COUNT} 首歌曲。`,
      )
      return
    }
    if (arrangementMode.value === 'platform') {
      const platformId = getQueuePlatformId(track)
      const nextItems = [...items.value]
      let insertIndex = nextItems.length
      for (let index = 0; index < nextItems.length; index += 1) {
        if (getQueuePlatformId(nextItems[index]!) === platformId) insertIndex = index + 1
      }
      nextItems.splice(insertIndex, 0, track)
      items.value = nextItems
    } else items.value = [...items.value, track]
    addedAtMsByTrackId.value = new Map(addedAtMsByTrackId.value).set(
      track.id,
      (options.now ?? Date.now)(),
    )
    if (playbackSource.value === 'queue') playbackItems.value = items.value
    if (
      playbackSource.value === 'queue' &&
      mode.value === 'shuffle-no-repeat' &&
      track.id !== currentTrackId.value
    ) {
      shuffleBag.push(track.id)
    }
    persistNow()
  }

  /** 批量入队按调用方的勾选顺序追加，O(n + m) 去重且仅保存一次；超限整批拒绝。 */
  function addMany(tracks: readonly Track[]): number {
    const seenIds = new Set(trackIds.value)
    const additions: Track[] = []
    for (const track of tracks) {
      if (seenIds.has(track.id)) continue
      seenIds.add(track.id)
      additions.push(track)
    }
    if (seenIds.size > MAX_PLAYBACK_QUEUE_ITEM_COUNT) {
      persistenceErrorState.value = createAppErrorState(
        'limit-exceeded',
        `待听最多保存 ${MAX_PLAYBACK_QUEUE_ITEM_COUNT} 首歌曲，请减少选择后重试。`,
      )
      return 0
    }
    if (!additions.length) {
      if (persistenceErrorState.value) persistNow()
      return 0
    }
    // 平台分组会重新分配插入位置；显式切回全部歌曲，保证选择顺序就是播放顺序。
    arrangementMode.value = 'flat'
    items.value = [...items.value, ...additions]
    const nextAddedAt = new Map(addedAtMsByTrackId.value)
    const addedAtMs = (options.now ?? Date.now)()
    for (const track of additions) nextAddedAt.set(track.id, addedAtMs)
    addedAtMsByTrackId.value = nextAddedAt
    if (playbackSource.value === 'queue') {
      playbackItems.value = items.value
      if (mode.value === 'shuffle-no-repeat') {
        for (const track of additions) {
          if (track.id !== currentTrackId.value) shuffleBag.push(track.id)
        }
      }
    }
    persistNow()
    return additions.length
  }

  function play(track: Track) {
    add(track)
    select(track.id)
  }

  /** 以调用方给出的稳定顺序播放一组曲目，但不把整组曲目写入持久化待听列表。 */
  function playTracks(tracks: readonly Track[], startTrackId: string) {
    const uniqueTracks = deduplicateTracks(tracks)
    if (!uniqueTracks.some((track) => track.id === startTrackId)) return
    playbackSource.value = 'collection'
    playbackItems.value = uniqueTracks
    shuffleBag = mode.value === 'shuffle-no-repeat' ? createShuffleBag() : []
    selectPlaybackTrack(startTrackId)
  }

  function select(trackId: string, rememberCurrent = true) {
    if (!items.value.some((track) => track.id === trackId)) return
    activateQueue()
    selectPlaybackTrack(trackId, rememberCurrent)
  }

  function selectPlaybackTrack(trackId: string, rememberCurrent = true) {
    if (!playbackItems.value.some((track) => track.id === trackId)) return
    if (rememberCurrent && currentTrackId.value && currentTrackId.value !== trackId) {
      history.push(currentTrackId.value)
    }
    currentTrackId.value = trackId
    if (mode.value === 'shuffle-no-repeat') {
      shuffleBag = shuffleBag.filter((id) => id !== trackId)
    }
  }

  function next() {
    if (playbackItems.value.length === 0) return
    if (!currentTrackId.value) {
      selectPlaybackTrack(playbackItems.value[0]?.id ?? '', false)
      return
    }
    if (mode.value === 'repeat-one') return

    const nextId = pickNextId()
    if (nextId) selectPlaybackTrack(nextId)
  }

  function previous() {
    while (history.length > 0) {
      const previousId = history.pop()
      if (previousId && playbackItems.value.some((track) => track.id === previousId)) {
        selectPlaybackTrack(previousId, false)
        return
      }
    }
  }

  /** 身份或来源失效只结束播放，不移除用户保存的待听歌曲，也不自动续播。 */
  function stop(): void {
    currentTrackId.value = undefined
    history.length = 0
    shuffleBag = []
  }

  function remove(trackId: string) {
    removeMany([trackId])
  }

  /** 批量移除只提交一次持久化；若当前待听曲目被移除，则沿用单项移除的续播语义。 */
  function removeMany(removedTrackIds: readonly string[]) {
    const removedIds = new Set(removedTrackIds)
    if (removedIds.size === 0) return
    const nextItems = items.value.filter((track) => !removedIds.has(track.id))
    if (nextItems.length === items.value.length) return
    const removingCurrent =
      playbackSource.value === 'queue' &&
      currentTrackId.value !== undefined &&
      removedIds.has(currentTrackId.value)
    items.value = nextItems
    addedAtMsByTrackId.value = new Map(
      [...addedAtMsByTrackId.value].filter(([id]) => !removedIds.has(id)),
    )
    if (playbackSource.value === 'queue') {
      playbackItems.value = items.value
      shuffleBag = shuffleBag.filter((id) => !removedIds.has(id))
    }
    if (removingCurrent) {
      currentTrackId.value = undefined
      next()
    }
    persistNow()
  }

  function move(draggedId: string, targetId: string, visibleIds?: readonly string[]) {
    const byId = new Map(items.value.map((track) => [track.id, track]))
    const dragged = byId.get(draggedId)
    const target = byId.get(targetId)
    if (!dragged || !target) return
    if (
      arrangementMode.value === 'platform' &&
      getQueuePlatformId(dragged) !== getQueuePlatformId(target)
    )
      return
    const ids = items.value.map((track) => track.id)
    const eligibleIds =
      arrangementMode.value === 'platform'
        ? (visibleIds ?? ids).filter(
            (id) => byId.get(id)?.source.pluginId === dragged.source.pluginId,
          )
        : visibleIds
    const reordered = reorderQueueIds(ids, draggedId, targetId, eligibleIds)
    if (reordered === ids) return
    items.value = reordered.map((id) => byId.get(id)!)
    if (playbackSource.value === 'queue') playbackItems.value = items.value
    persistNow()
  }

  /** 平台视图以连续区块呈现，切换时将当前队列稳定分组，使可见顺序等于实际顺序播放顺序。 */
  function setArrangementMode(nextMode: QueueArrangementMode): void {
    if (arrangementMode.value === nextMode) return
    arrangementMode.value = nextMode
    if (nextMode === 'platform') {
      const grouped = new Map<string, Track[]>()
      for (const track of items.value) {
        const platformId = getQueuePlatformId(track)
        const group = grouped.get(platformId) ?? []
        group.push(track)
        grouped.set(platformId, group)
      }
      items.value = [...grouped.values()].flat()
      if (playbackSource.value === 'queue') playbackItems.value = items.value
    }
    persistNow()
  }

  /** 平台拖拽只移动整个区块，不改变区块内歌曲的相对顺序。 */
  function movePlatform(
    draggedPlatformId: string,
    targetPlatformId: string,
    visibleIds?: readonly string[],
  ): void {
    if (draggedPlatformId === targetPlatformId || arrangementMode.value !== 'platform') return
    const grouped = new Map<string, Track[]>()
    for (const track of items.value) {
      const platformId = getQueuePlatformId(track)
      const group = grouped.get(platformId) ?? []
      group.push(track)
      grouped.set(platformId, group)
    }
    if (!grouped.has(draggedPlatformId) || !grouped.has(targetPlatformId)) return
    const platformIds = [...grouped.keys()]
    const reordered = reorderQueueIds(platformIds, draggedPlatformId, targetPlatformId, visibleIds)
    if (reordered === platformIds) return
    items.value = reordered.flatMap((platformId) => grouped.get(platformId) ?? [])
    if (playbackSource.value === 'queue') playbackItems.value = items.value
    persistNow()
  }

  function pin(trackId: string, visibleIds?: readonly string[]) {
    const track = items.value.find((item) => item.id === trackId)
    if (!track) return
    const eligible = visibleIds ? new Set(visibleIds) : undefined
    const first = items.value.find(
      (item) =>
        (!eligible || eligible.has(item.id)) &&
        (arrangementMode.value === 'flat' ||
          getQueuePlatformId(item) === getQueuePlatformId(track)),
    )
    if (first) move(trackId, first.id, visibleIds)
  }

  function setMode(nextMode: PlaybackMode) {
    mode.value = nextMode
    shuffleBag = nextMode === 'shuffle-no-repeat' ? createShuffleBag() : []
    persistNow()
  }

  /** 用户的每次队列修改都立即提交，避免关闭或刷新页面时丢失最后一次操作。 */
  function persistNow(): void {
    try {
      playbackQueueRepository.save({
        schemaVersion: PLAYBACK_QUEUE_SCHEMA_VERSION,
        trackIds: items.value.map((track) => track.id),
        mode: mode.value,
        arrangementMode: arrangementMode.value,
        addedAtMsByTrackId: Object.fromEntries(addedAtMsByTrackId.value),
      })
      persistenceErrorState.value = undefined
    } catch (error) {
      persistenceErrorState.value = toAppErrorState(
        error,
        'storage-write-failed',
        '待听列表保存失败。',
      )
    }
  }

  function pickNextId(): string | undefined {
    const currentIndex = playbackItems.value.findIndex((track) => track.id === currentTrackId.value)
    if (mode.value === 'sequence') {
      return playbackItems.value[(currentIndex + 1) % playbackItems.value.length]?.id
    }
    if (mode.value === 'shuffle') {
      return playbackItems.value[Math.floor(random() * playbackItems.value.length)]?.id
    }

    if (shuffleBag.length === 0) shuffleBag = createShuffleBag()
    return shuffleBag.pop()
  }

  function createShuffleBag(): string[] {
    const ids = playbackItems.value
      .map((track) => track.id)
      .filter((id) => id !== currentTrackId.value)
    // Fisher–Yates 原地洗牌为 O(n)，优于反复随机抽取并用 Set 重试。
    for (let index = ids.length - 1; index > 0; index -= 1) {
      const swapIndex = Math.floor(random() * (index + 1))
      const value = ids[index]
      ids[index] = ids[swapIndex] ?? ids[index] ?? ''
      ids[swapIndex] = value ?? ''
    }
    return ids
  }

  function activateQueue(): void {
    if (playbackSource.value === 'queue') return
    playbackSource.value = 'queue'
    playbackItems.value = items.value
    shuffleBag = mode.value === 'shuffle-no-repeat' ? createShuffleBag() : []
  }

  return {
    items: readonly(items),
    trackIds,
    addedAtMsByTrackId: readonly(addedAtMsByTrackId),
    currentTrackId: readonly(currentTrackId),
    currentTrack,
    mode: readonly(mode),
    arrangementMode: readonly(arrangementMode),
    persistenceError: readonly(persistenceError),
    persistenceErrorState: readonly(persistenceErrorState),
    add,
    addMany,
    play,
    playTracks,
    select,
    next,
    previous,
    stop,
    remove,
    removeMany,
    move,
    movePlatform,
    pin,
    setMode,
    setArrangementMode,
    persistNow,
  }
}

function getQueuePlatformId(track: Track): string {
  return track.source.pluginId
}

function deduplicateTracks(tracks: readonly Track[]): readonly Track[] {
  const trackById = new Map(tracks.map((track) => [track.id, track]))
  return [...trackById.values()]
}

function loadInitialSnapshot() {
  try {
    return { snapshot: playbackQueueRepository.load(), error: undefined }
  } catch (error) {
    return {
      snapshot: createEmptyPlaybackQueue(),
      error: toAppErrorState(error, 'storage-read-failed', '待听列表读取失败。'),
    }
  }
}
