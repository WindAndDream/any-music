import { readFileSync } from 'node:fs'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { readStored, writeStored } from '#workbench/runtime/storage'

vi.mock('#workbench/runtime/storage', () => ({
  readStored: vi.fn(),
  writeStored: vi.fn(),
}))
const sidebarCollapsePreference = vi.hoisted(() => ({
  read: vi.fn<() => boolean | undefined>(),
  write: vi.fn<(value: boolean) => void>(),
}))
vi.mock('#workbench/runtime/workbench-runtime', () => ({
  getWorkbenchRuntime: () => ({ sidebarCollapsePreference }),
}))

import { createEmptyDownloadHistory } from '@any-music/core'
import { createDefaultAppShellPreferences } from '@any-music/ui'

import { createEmptyMusicSourceWorkspace } from '#workbench/features/music-sources/music-source-workspace-state'
import { createEmptyPlaybackQueue } from '#workbench/features/player/playback-queue-state'
import { appShellPreferencesRepository } from '#workbench/storage/app-shell-preferences-repository'
import { catalogFilterHistoryRepository } from '#workbench/storage/catalog-filter-history-repository'
import { downloadHistoryRepository } from '#workbench/storage/download-history-repository'
import { musicSourceWorkspaceRepository } from '#workbench/storage/music-source-workspace-repository'
import { playbackQueueRepository } from '#workbench/storage/playback-queue-repository'

describe('production Userscript storage repositories', () => {
  beforeEach(() => {
    vi.mocked(readStored).mockReset()
    vi.mocked(writeStored).mockReset()
    vi.mocked(readStored).mockReturnValue(undefined)
    sidebarCollapsePreference.read.mockReset()
    sidebarCollapsePreference.write.mockReset()
  })

  it('keeps workspace, queue and download history in production-only keys', () => {
    expect(musicSourceWorkspaceRepository.load()).toEqual(createEmptyMusicSourceWorkspace())
    expect(playbackQueueRepository.load()).toEqual(createEmptyPlaybackQueue())
    expect(downloadHistoryRepository.load()).toEqual(createEmptyDownloadHistory())

    expect(readStored).toHaveBeenCalledWith('music-source-workspace:v1', undefined)
    expect(readStored).toHaveBeenCalledWith('playback-queue:v1', undefined)
    expect(readStored).toHaveBeenCalledWith('download-history:v1', undefined)
  })

  it('writes snapshots back to the same production-only keys', () => {
    const workspace = createEmptyMusicSourceWorkspace()
    const queue = createEmptyPlaybackQueue()
    const downloads = createEmptyDownloadHistory()

    musicSourceWorkspaceRepository.save(workspace)
    playbackQueueRepository.save(queue)
    downloadHistoryRepository.save(downloads)

    expect(writeStored).toHaveBeenCalledWith('music-source-workspace:v1', workspace)
    expect(writeStored).toHaveBeenCalledWith('playback-queue:v1', queue)
    expect(writeStored).toHaveBeenCalledWith('download-history:v1', downloads)
  })

  it('restores the saved rail state and writes toggles without committing a product snapshot', () => {
    const saved = { ...createDefaultAppShellPreferences(), isSidebarCollapsed: true }
    vi.mocked(readStored).mockReturnValue(saved)
    let compact: boolean | undefined
    sidebarCollapsePreference.read.mockImplementation(() => compact)
    const write = sidebarCollapsePreference.write.mockImplementation((value) => {
      compact = value
    })

    expect(appShellPreferencesRepository.load()).toEqual(saved)
    const expanded = { ...saved, isSidebarCollapsed: false }
    appShellPreferencesRepository.save(expanded)
    expect(write).toHaveBeenCalledExactlyOnceWith(false)
    expect(writeStored).not.toHaveBeenCalled()
    expect(appShellPreferencesRepository.load()).toEqual(expanded)

    const moved = { ...expanded, sidebarSide: 'right' as const }
    appShellPreferencesRepository.save(moved)
    expect(writeStored).toHaveBeenCalledExactlyOnceWith('app-shell:v1', moved)
    expect(write).toHaveBeenCalledTimes(1)
  })

  it('reads the saved repository fixtures without loading ambiguous v1 filter history', () => {
    const stored = JSON.parse(
      readFileSync(new URL('../fixtures/storage/repositories.json', import.meta.url), 'utf8'),
    ) as Record<string, unknown>
    const original = JSON.stringify(stored)
    vi.mocked(readStored).mockImplementation(
      <T>(key: string, fallback?: T) => (stored[key] as T | undefined) ?? fallback,
    )

    expect(playbackQueueRepository.load()).toMatchObject({
      trackIds: ['fixture:audio:b', 'fixture:audio:a'],
      mode: 'shuffle',
      arrangementMode: 'platform',
      addedAtMsByTrackId: { 'fixture:audio:b': 20, 'fixture:audio:a': 10 },
    })
    expect(musicSourceWorkspaceRepository.load()).toMatchObject({
      disabledPluginIds: ['custom-fixture-v2'],
      activePluginId: 'fixture',
      searchQuery: 'Fixture query',
      drawers: [
        {
          id: 'drawer:fixture',
          pluginId: 'fixture',
          title: 'Renamed fixture',
          originalTitle: 'Fixture query',
          isPinned: true,
          isExpanded: false,
        },
      ],
    })
    expect(catalogFilterHistoryRepository.load()).toEqual(stored['catalog-filter-history:v2'])
    expect(catalogFilterHistoryRepository.loadSettings?.()).toEqual(
      stored['catalog-filter-history-settings:v1'],
    )
    expect(vi.mocked(readStored).mock.calls.map(([key]) => key)).not.toContain(
      'catalog-filter-history:v1',
    )
    expect(appShellPreferencesRepository.load()).toMatchObject({
      destinationOrder: [
        'tags',
        'composer',
        'custom-tracks',
        'catalog',
        'queue',
        'favorites',
        'playlists',
        'downloads',
        'history',
        'plugins',
      ],
      hiddenDestinationIds: ['tags', 'composer'],
      theme: 'dark',
      sidebarSide: 'right',
    })
    expect(downloadHistoryRepository.load().batches[0]).toMatchObject({
      id: 'batch:fixture',
      status: 'interrupted',
      items: [expect.objectContaining({ id: 'item:fixture', status: 'interrupted' })],
    })
    expect(writeStored).toHaveBeenCalledTimes(1)
    expect(writeStored).toHaveBeenCalledWith('download-history:v1', expect.any(Object))
    expect(JSON.stringify(stored)).toBe(original)
  })
})
