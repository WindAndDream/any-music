import { AppError, createAppErrorState } from '@any-music/core'
import type { AppErrorState, Track } from '@any-music/core'
import { useToastNotice } from '@any-music/ui'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick } from 'vue'

import { useMusicSourceWorkbench } from '#workbench/features/music-sources/use-music-source-workbench'
import type { SourceInvalidation } from '#workbench/runtime/workbench-runtime'

const dependencies = vi.hoisted(() => ({
  rememberTracks: vi.fn(),
  updateTrackDuration: vi.fn(),
  updateHistory: vi.fn(),
  beginHistory: vi.fn(),
  loadQueue: vi.fn(() => ({ schemaVersion: 1, trackIds: [], mode: 'sequence' })),
  saveQueue: vi.fn(),
  tracks: new Map<string, Track>(),
  setHistoryLimit: vi.fn(),
  updateLocalUserDisplayName: vi.fn(),
  setDownloadConcurrency: vi.fn(),
  setProxySettings: vi.fn(),
  persistWorkspace: vi.fn(),
  persistLibrary: vi.fn(),
  restoreTrackNames: vi.fn<() => number>(() => 1),
  restoreDrawerNames: vi.fn<() => number>(() => 1),
  moveDrawer: vi.fn<() => number>(() => 1),
  favoriteTrack: vi.fn(),
  unfavoriteTrack: vi.fn(),
  favoriteTrackIds: new Set<string>(),
  addTracksToPlaylist: vi.fn(),
  libraryWriteError: undefined as AppErrorState | undefined,
  workspaceWriteError: undefined as AppErrorState | undefined,
  invalidateCatalog: vi.fn(),
  invalidate: undefined as ((event: SourceInvalidation) => void) | undefined,
  unsubscribe: vi.fn(),
  moduleReady: Promise.resolve(),
  refreshSession: vi.fn(),
}))
vi.mock('#workbench/features/plugins/use-workbench-modules', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('#workbench/features/plugins/use-workbench-modules')>()
  return {
    ...actual,
    useWorkbenchModules: (...args: Parameters<typeof actual.useWorkbenchModules>) => {
      const modules = actual.useWorkbenchModules(...args)
      return { ...modules, ready: Promise.all([modules.ready, dependencies.moduleReady]) }
    },
  }
})
vi.mock('#workbench/storage/playback-queue-repository', () => ({
  playbackQueueRepository: { load: dependencies.loadQueue, save: dependencies.saveQueue },
}))
vi.mock('#workbench/features/library/use-local-music-library', async () => {
  return {
    useLocalMusicLibrary: () => ({
      rememberTracks: dependencies.rememberTracks,
      updateTrackDuration: dependencies.updateTrackDuration,
      updateHistory: dependencies.updateHistory,
      beginHistory: dependencies.beginHistory,
      getTrack: (id: string) => dependencies.tracks.get(id),
      getCustomTrack: () => undefined,
      setHistoryLimit: dependencies.setHistoryLimit,
      updateLocalUserDisplayName: dependencies.updateLocalUserDisplayName,
      restoreTrackNames: dependencies.restoreTrackNames,
      favoriteTrack: dependencies.favoriteTrack,
      unfavoriteTrack: dependencies.unfavoriteTrack,
      favoriteTrackIds: {
        get value() {
          return dependencies.favoriteTrackIds
        },
      },
      addTracksToPlaylist: dependencies.addTracksToPlaylist,
      persistNow: dependencies.persistLibrary,
      persistenceErrorState: {
        get value() {
          return dependencies.libraryWriteError
        },
      },
    }),
  }
})
vi.mock('#workbench/features/music-sources/use-music-source-registry', async () => {
  const { shallowRef } = await import('vue')
  return {
    useMusicSourceRegistry: () => ({
      activePluginId: shallowRef('test'),
      plugins: shallowRef([]),
      setEnabled: vi.fn(),
      invalidateSource: vi.fn(),
    }),
  }
})
vi.mock('#workbench/features/music-sources/use-music-source-workspace', async () => {
  const { shallowRef } = await import('vue')
  return {
    useMusicSourceWorkspace: () => ({
      proxySettings: shallowRef({ isEnabled: false }),
      setDownloadConcurrency: dependencies.setDownloadConcurrency,
      setProxySettings: dependencies.setProxySettings,
      persistNow: dependencies.persistWorkspace,
      restoreDrawerNames: dependencies.restoreDrawerNames,
      moveDrawer: dependencies.moveDrawer,
      actionErrorState: shallowRef(),
      configuredEnabledPluginIds: shallowRef([]),
      enabledPlugins: shallowRef([]),
      invalidateSource: dependencies.invalidateCatalog,
      persistenceErrorState: {
        get value() {
          return dependencies.workspaceWriteError
        },
      },
    }),
  }
})
vi.mock('#workbench/features/music-sources/use-plugin-session', () => ({
  usePluginSession: () => ({ refresh: dependencies.refreshSession, invalidateSource: vi.fn() }),
}))
vi.mock('#workbench/features/downloads/use-download-manager', async () => {
  const { shallowRef } = await import('vue')
  return { useDownloadManager: () => ({ activeBatch: shallowRef() }) }
})
vi.mock('#workbench/runtime/workbench-runtime', () => ({
  getWorkbenchRuntime: () => ({
    externalPlugins: 'declarative',
    builtInMusicSources: [],
    subscribeSourceInvalidation: (listener: (event: SourceInvalidation) => void) => {
      dependencies.invalidate = listener
      return dependencies.unsubscribe
    },
  }),
}))
vi.mock('#workbench/features/audio-export/download-audio', () => ({ downloadAudioBlob: vi.fn() }))
vi.mock('#workbench/runtime/proxy', () => ({ configureHttpProxy: vi.fn() }))

const scopes: ReturnType<typeof effectScope>[] = []
beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
  dependencies.tracks.clear()
  dependencies.favoriteTrackIds.clear()
  dependencies.libraryWriteError = undefined
  dependencies.workspaceWriteError = undefined
  dependencies.moduleReady = Promise.resolve()
})
afterEach(() => {
  scopes.splice(0).forEach((scope) => scope.stop())
  vi.useRealTimers()
})
function track(id: string): Track {
  const value: Track = {
    id,
    title: id,
    artists: [],
    source: { pluginId: 'test', mediaKind: 'audio', resourceId: id },
  }
  dependencies.tracks.set(id, value)
  return value
}
function createWorkbench() {
  const scope = effectScope()
  scopes.push(scope)
  return scope.run(() => {
    const notice = useToastNotice()
    const onAlreadyPlaying = vi.fn(() => notice.show('这首歌曲已经在播放器中'))
    const onSettingsResult = vi.fn()
    const onActionResult = vi.fn()
    return {
      notice,
      onAlreadyPlaying,
      onSettingsResult,
      onActionResult,
      workbench: useMusicSourceWorkbench({
        confirm: vi.fn(),
        onAlreadyPlaying,
        onSettingsResult,
        onActionResult,
      }),
    }
  })!
}

describe('useMusicSourceWorkbench startup', () => {
  it.each([false, true])(
    'waits for source activation before probing login (disposed: %s)',
    async (disposed) => {
      let complete!: () => void
      dependencies.moduleReady = new Promise<void>((resolve) => {
        complete = resolve
      })
      const { workbench } = createWorkbench()
      expect(dependencies.refreshSession).not.toHaveBeenCalled()
      if (disposed) scopes.at(-1)!.stop()
      complete()
      await workbench.modules.ready
      await nextTick()
      expect(dependencies.refreshSession).toHaveBeenCalledTimes(disposed ? 0 : 1)
    },
  )
})

describe('useMusicSourceWorkbench repeated playback', () => {
  it('reconciles the saved song duration from playback progress without starting another history', async () => {
    const { workbench } = createWorkbench()
    const song = { ...track('bilibili'), durationMs: 43_200_000 }
    dependencies.beginHistory.mockReturnValue('history:1')
    workbench.playTrack(song)
    await nextTick()
    dependencies.beginHistory.mockClear()
    workbench.recordProgress(1_000, 253_000, false)
    expect(dependencies.updateTrackDuration).toHaveBeenCalledExactlyOnceWith(song.id, 253_000)
    expect(dependencies.updateHistory).toHaveBeenCalledExactlyOnceWith(
      'history:1',
      1_000,
      253_000,
      false,
    )
    expect(workbench.playerTrack.value).toBe(song)
    expect(dependencies.beginHistory).not.toHaveBeenCalled()
  })

  it('saves drawer order once and reports an actual persistence failure instead of success', () => {
    const { workbench, onActionResult } = createWorkbench()
    workbench.moveDrawer('a', 'b', ['a', 'b'])
    expect(dependencies.moveDrawer).toHaveBeenCalledExactlyOnceWith('a', 'b', ['a', 'b'])
    expect(dependencies.persistWorkspace).toHaveBeenCalledOnce()
    expect(onActionResult).toHaveBeenLastCalledWith({
      status: 'success',
      message: '音乐列表顺序已保存。',
    })
    const error = createAppErrorState('storage-write-failed', '存储已满')
    dependencies.workspaceWriteError = error
    workbench.moveDrawer('b', 'a', ['a', 'b'])
    expect(onActionResult).toHaveBeenLastCalledWith({
      status: 'error',
      error,
      action: 'drawerReorder',
    })
  })
  it('toggles favorite state using current library membership and distinct feedback', () => {
    const { workbench, onActionResult } = createWorkbench()
    const song = track('one')
    workbench.toggleTrackFavorite(song)
    expect(dependencies.favoriteTrack).toHaveBeenCalledExactlyOnceWith(song)
    expect(onActionResult).toHaveBeenLastCalledWith({
      status: 'success',
      message: '已添加到我的喜欢。',
    })
    dependencies.favoriteTrackIds.add(song.id)
    workbench.toggleTrackFavorite(song)
    expect(dependencies.unfavoriteTrack).toHaveBeenCalledExactlyOnceWith(song.id)
    expect(onActionResult).toHaveBeenLastCalledWith({ status: 'info', message: '已取消喜欢。' })
  })

  it('toggles queued membership and saves a selected batch once in supplied order', () => {
    const { workbench, onActionResult } = createWorkbench()
    const first = track('first')
    const second = track('second')
    workbench.toggleTrackQueue(first)
    expect(workbench.queue.trackIds.value.has(first.id)).toBe(true)
    workbench.toggleTrackQueue(first)
    expect(workbench.queue.items.value).toEqual([])
    expect(onActionResult).toHaveBeenLastCalledWith({ status: 'info', message: '已移出待听。' })
    dependencies.saveQueue.mockClear()
    workbench.queueTracks([second, first, second])
    expect(workbench.queue.items.value.map((item) => item.id)).toEqual(['second', 'first'])
    expect(dependencies.saveQueue).toHaveBeenCalledOnce()
    expect(onActionResult).toHaveBeenLastCalledWith({
      status: 'success',
      message: '已按勾选顺序添加 2 首歌曲到待听，已有歌曲保持原位。',
    })
  })

  it('does not persist queue IDs when canonical library saving fails', () => {
    const { workbench, onActionResult } = createWorkbench()
    const error = createAppErrorState('storage-write-failed', '空间不足')
    dependencies.libraryWriteError = error
    workbench.queueTracks([track('one')])
    expect(workbench.queue.items.value).toEqual([])
    expect(dependencies.saveQueue).not.toHaveBeenCalled()
    expect(onActionResult).toHaveBeenLastCalledWith({ status: 'error', error, action: 'queueAdd' })
    dependencies.libraryWriteError = undefined
    workbench.queueTracks([track('one')])
    expect(workbench.queue.items.value.map((item) => item.id)).toEqual(['one'])
    expect(dependencies.saveQueue).toHaveBeenCalledOnce()
  })
  it('resets affected playback on account removal, preserves the queue and ignores unrelated identities', () => {
    const { workbench } = createWorkbench()
    const first = track('first')
    workbench.playTrack(first)
    const event = {
      pluginId: 'test',
      accountId: 'removed',
      trackIds: ['other'],
      error: createAppErrorState('operation-cancelled'),
    }
    dependencies.invalidate!(event)
    expect(workbench.playerTrack.value).toBe(first)
    dependencies.invalidate!({ ...event, trackIds: ['first'] })
    expect(workbench.playerTrack.value).toBe(first)
    // 播放器根据自己解析到的媒体账号发出此动作，避免同 ID 的其他账号操作误清空。
    workbench.stopPlayback()
    expect(workbench.playerTrack.value).toBeUndefined()
    expect(workbench.queue.items.value).toEqual([first])
    expect(dependencies.invalidateCatalog).toHaveBeenCalledTimes(2)
    scopes.at(-1)!.stop()
    expect(dependencies.unsubscribe).toHaveBeenCalledOnce()
  })
  it('ends playback when its platform is removed, without advancing to another song', () => {
    const { workbench } = createWorkbench()
    const first = track('first')
    workbench.queue.add(track('second'))
    workbench.playTrack(first)
    dependencies.invalidate!({
      pluginId: 'test',
      error: createAppErrorState('operation-cancelled'),
    })
    expect(workbench.playerTrack.value).toBeUndefined()
    expect(workbench.queue.items.value.map((item) => item.id)).toEqual(['second', 'first'])
  })
  it('notifies repeated selection once without rewriting the queue, history or current track', async () => {
    const { workbench, notice, onAlreadyPlaying } = createWorkbench()
    const first = track('first')
    workbench.playTrack(first)
    await nextTick()
    dependencies.rememberTracks.mockClear()
    dependencies.saveQueue.mockClear()
    dependencies.beginHistory.mockClear()
    for (let count = 0; count < 5; count += 1) workbench.playTrack({ ...first })
    expect(workbench.playerTrack.value).toBe(first)
    expect(workbench.queue.items.value).toEqual([first])
    expect(onAlreadyPlaying).toHaveBeenCalledTimes(5)
    expect(notice.message.value).toBe('这首歌曲已经在播放器中')
    expect(dependencies.rememberTracks).not.toHaveBeenCalled()
    expect(dependencies.saveQueue).not.toHaveBeenCalled()
    await nextTick()
    expect(dependencies.beginHistory).not.toHaveBeenCalled()
    vi.advanceTimersByTime(2200)
    expect(notice.message.value).toBeUndefined()
    workbench.playTrack(first)
    expect(notice.message.value).toBeUndefined()
    vi.advanceTimersByTime(840)
    workbench.playTrack(first)
    expect(notice.message.value).toBe('这首歌曲已经在播放器中')
  })

  it('preserves a collection context when reselected from search or another collection and still switches songs', () => {
    const { workbench, onAlreadyPlaying } = createWorkbench()
    const first = track('first')
    const second = track('second')
    const third = track('third')
    workbench.playFavoriteTrack(first, [first, second])
    workbench.playTrack(first)
    workbench.playFavoriteTrack(first, [third, first])
    expect(onAlreadyPlaying).toHaveBeenCalledTimes(2)
    expect(workbench.queue.items.value).toEqual([])
    workbench.handlePlayerNext()
    expect(workbench.playerTrack.value?.id).toBe(second.id)
    workbench.playTrack(third)
    expect(workbench.playerTrack.value?.id).toBe(third.id)
    expect(dependencies.rememberTracks).toHaveBeenCalledExactlyOnceWith([third])
  })
})

describe('useMusicSourceWorkbench settings results', () => {
  it('reports successful saves after the corresponding action and persistence complete', () => {
    const { workbench, onSettingsResult } = createWorkbench()
    workbench.setHistoryLimit(80)
    expect(dependencies.setHistoryLimit).toHaveBeenCalledExactlyOnceWith(80)
    expect(onSettingsResult).toHaveBeenLastCalledWith({
      status: 'success',
      message: '播放历史设置已保存。',
    })
    workbench.updateLocalUserDisplayName('新名称')
    expect(onSettingsResult).toHaveBeenLastCalledWith({
      status: 'success',
      message: '创作者名称已保存。',
    })
    dependencies.persistWorkspace.mockImplementationOnce(() =>
      expect(onSettingsResult).toHaveBeenCalledTimes(2),
    )
    workbench.setDownloadConcurrency(4)
    expect(dependencies.persistWorkspace).toHaveBeenCalledOnce()
    expect(onSettingsResult).toHaveBeenLastCalledWith({
      status: 'success',
      message: '下载设置已保存。',
    })
    workbench.setProxySettings({
      isEnabled: false,
      type: 'http',
      host: 'proxy.example.com',
      port: 8080,
      username: '',
      password: '',
      proxyDns: false,
    })
    expect(dependencies.persistWorkspace).toHaveBeenCalledTimes(2)
    expect(onSettingsResult).toHaveBeenLastCalledWith({
      status: 'success',
      message: '代理配置已保存。',
    })
  })

  it('reports validation errors and storage failures instead of a successful save, then allows retry', () => {
    const { workbench, onSettingsResult } = createWorkbench()
    workbench.setDownloadConcurrency(99)
    expect(dependencies.setDownloadConcurrency).not.toHaveBeenCalled()
    expect(dependencies.persistWorkspace).not.toHaveBeenCalled()
    expect(onSettingsResult).toHaveBeenLastCalledWith({
      status: 'error',
      error: expect.objectContaining({ code: 'invalid-input' }),
    })
    dependencies.updateLocalUserDisplayName.mockImplementationOnce(() => {
      throw new AppError('invalid-input', '用户名称不能为空。')
    })
    workbench.updateLocalUserDisplayName('')
    expect(onSettingsResult).toHaveBeenLastCalledWith({
      status: 'error',
      error: expect.objectContaining({ code: 'invalid-input' }),
    })
    const libraryError = createAppErrorState('storage-write-failed', '资料库保存失败。')
    dependencies.libraryWriteError = libraryError
    workbench.setHistoryLimit(80)
    expect(onSettingsResult).toHaveBeenLastCalledWith({ status: 'error', error: libraryError })
    const workspaceError = createAppErrorState('storage-write-failed', '配置保存失败。')
    dependencies.workspaceWriteError = workspaceError
    workbench.setDownloadConcurrency(3)
    expect(onSettingsResult).toHaveBeenLastCalledWith({ status: 'error', error: workspaceError })
    dependencies.workspaceWriteError = undefined
    workbench.setDownloadConcurrency(3)
    expect(onSettingsResult).toHaveBeenLastCalledWith({
      status: 'success',
      message: '下载设置已保存。',
    })
  })
})

describe('useMusicSourceWorkbench operation results', () => {
  it('reports actual batch restore counts and performs no extra save for successful or unchanged songs', () => {
    const { workbench, onActionResult } = createWorkbench()
    dependencies.restoreTrackNames.mockReturnValueOnce(2)
    workbench.restoreTrackNames(['one', 'two'])
    expect(onActionResult).toHaveBeenLastCalledWith({
      status: 'success',
      message: '已恢复 2 首歌曲的原名。',
    })
    expect(dependencies.persistLibrary).not.toHaveBeenCalled()
    dependencies.restoreTrackNames.mockReturnValueOnce(0)
    workbench.restoreTrackNames([])
    expect(onActionResult).toHaveBeenLastCalledWith({
      status: 'success',
      message: '已选项均使用原名，无需恢复。',
    })
    expect(dependencies.persistLibrary).not.toHaveBeenCalled()
    dependencies.restoreDrawerNames.mockReturnValueOnce(2)
    workbench.restoreDrawerNames(['one', 'two'])
    expect(dependencies.persistWorkspace).toHaveBeenCalledOnce()
    expect(onActionResult).toHaveBeenLastCalledWith({
      status: 'success',
      message: '已恢复 2 个音乐列表的原名。',
    })
    dependencies.restoreDrawerNames.mockReturnValueOnce(0)
    workbench.restoreDrawerNames([])
    expect(dependencies.persistWorkspace).toHaveBeenCalledOnce()
  })

  it('reports storage failures and validates thrown actions without showing a success', () => {
    const { workbench, onActionResult } = createWorkbench()
    const error = createAppErrorState('storage-write-failed', '空间不足')
    dependencies.persistLibrary.mockImplementationOnce(() => {
      dependencies.libraryWriteError = error
    })
    workbench.favoriteTrack(track('one'))
    expect(onActionResult).toHaveBeenLastCalledWith({ status: 'error', error, action: 'favorite' })
    dependencies.addTracksToPlaylist.mockImplementationOnce(() => {
      throw new AppError('not-found', '歌单已删除')
    })
    workbench.addTracksToPlaylist('missing', [track('one')])
    expect(onActionResult).toHaveBeenLastCalledWith({
      status: 'error',
      error: expect.objectContaining({ code: 'not-found' }),
      action: 'playlistAdd',
    })
    expect(dependencies.persistLibrary).toHaveBeenCalledOnce()
    dependencies.restoreTrackNames.mockImplementationOnce(() => {
      dependencies.libraryWriteError = error
      return 1
    })
    workbench.restoreTrackNames(['one'])
    expect(onActionResult).toHaveBeenLastCalledWith({
      status: 'error',
      error,
      action: 'trackRestore',
    })
    expect(dependencies.persistLibrary).toHaveBeenCalledOnce()
    dependencies.restoreTrackNames.mockReturnValueOnce(0)
    dependencies.persistLibrary.mockImplementationOnce(() => {
      dependencies.libraryWriteError = undefined
    })
    workbench.restoreTrackNames(['one'])
    expect(dependencies.persistLibrary).toHaveBeenCalledTimes(2)
    expect(onActionResult).toHaveBeenLastCalledWith({
      status: 'success',
      message: '已选项均使用原名，无需恢复。',
    })
  })
})
