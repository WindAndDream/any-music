import { describe, expect, it } from 'vitest'

import {
  DOWNLOAD_HISTORY_SCHEMA_VERSION,
  finalizeInterruptedDownloads,
  sanitizeDownloadHistorySnapshot,
  type DownloadHistorySnapshot,
} from '../../src/download/download-history'
import currentHistoryFixture from '../fixtures/download/download-history-v2.json'

const track = {
  id: 'source:audio:1',
  title: '测试歌曲',
  artists: [{ id: 'artist:1', name: '测试歌手' }],
  durationMs: 120_000,
  source: { pluginId: 'source', mediaKind: 'audio' as const, resourceId: '1' },
}

describe('download history', () => {
  it('retains only the newest record for each song and validates saved fingerprints', () => {
    const batch = currentHistoryFixture.batches[0]!
    const item = batch.items[0]!
    const savedFile = {
      fileName: 'song.mp3',
      extension: 'mp3',
      mimeType: 'audio/mpeg',
      sizeBytes: 3,
      sha256: 'a'.repeat(64),
      path: '/must-not-persist',
    }
    const snapshot = sanitizeDownloadHistorySnapshot({
      ...currentHistoryFixture,
      batches: [
        {
          ...batch,
          items: [
            { ...item, id: 'new', savedFile, creatorName: 'creator' },
            { ...item, id: 'duplicate' },
          ],
        },
        { ...batch, id: 'old', items: [item] },
      ],
    })
    expect(snapshot.batches).toHaveLength(1)
    expect(snapshot.batches[0]!.items).toHaveLength(1)
    expect(snapshot.batches[0]!.items[0]).toMatchObject({
      id: 'new',
      creatorName: 'creator',
      savedFile: { sha256: 'a'.repeat(64) },
    })
    expect(snapshot.batches[0]!.items[0]!.savedFile).not.toHaveProperty('path')
    const invalid = sanitizeDownloadHistorySnapshot({
      ...currentHistoryFixture,
      batches: [{ ...batch, items: [{ ...item, savedFile: { ...savedFile, sha256: 'invalid' } }] }],
    })
    expect(invalid.batches[0]!.items[0]!.savedFile?.sha256).toBeUndefined()
  })
  it('restores paused task identity, saved acknowledgements and stable preview recipes', () => {
    const original = currentHistoryFixture.batches[0]!
    const first = original.items[0]!
    const recipe = [{ sourceTrackId: 'leaf', startMs: 10, endMs: 500 }]
    const restored = finalizeInterruptedDownloads(
      sanitizeDownloadHistorySnapshot({
        ...currentHistoryFixture,
        batches: [
          {
            ...original,
            items: [
              { ...first, status: 'paused', recipe },
              {
                ...first,
                id: 'saved',
                track: { ...first.track, id: 'another-song' },
                status: 'succeeded',
                savedAtMs: 20,
              },
            ],
          },
        ],
      }),
      99,
    )
    expect(restored.batches[0]!.items[0]).toMatchObject({ id: first.id, status: 'paused', recipe })
    expect(restored.batches[0]!.items[1]).toMatchObject({ status: 'succeeded', savedAtMs: 20 })
  })
  it('preserves public acquisition provenance when restoring download records', () => {
    const fixture = currentHistoryFixture
    const acquisition = {
      accountId: '11111111-1111-4111-8111-111111111111',
      accountName: '添加时名称',
      acquiredAtMs: 10,
    }
    const first = fixture.batches[0]!.items[0]!
    const snapshot = sanitizeDownloadHistorySnapshot({
      ...fixture,
      batches: [
        { ...fixture.batches[0], items: [{ ...first, track: { ...first.track, acquisition } }] },
      ],
    })
    expect(snapshot.batches[0]?.items[0]?.track.acquisition).toEqual(acquisition)
  })
  it.each([currentHistoryFixture])(
    'preserves retries and interrupts unfinished work from the saved v$schemaVersion fixture',
    (fixture) => {
      const original = JSON.stringify(fixture)
      const restored = finalizeInterruptedDownloads(sanitizeDownloadHistorySnapshot(fixture), 99)
      const batch = restored.batches[0]
      const item = batch?.items[0]

      expect(restored.schemaVersion).toBe(DOWNLOAD_HISTORY_SCHEMA_VERSION)
      expect(batch).toMatchObject({ id: 'batch:fixture', status: 'interrupted', startedAtMs: 10 })
      expect(item).toMatchObject({
        id: 'item:fixture',
        status: 'interrupted',
        maxRetryCount: 2,
        track: { id: 'fixture:audio:a' },
      })
      expect(item?.attempts).toEqual([
        expect.objectContaining({
          attemptNumber: 1,
          status: 'failed',
          error: expect.objectContaining({ code: 'download-failed', message: 'Fixture failure' }),
        }),
        expect.objectContaining({ attemptNumber: 2, status: 'interrupted', completedAtMs: 99 }),
      ])
      expect(finalizeInterruptedDownloads(restored, 100)).toBe(restored)
      expect(JSON.stringify(fixture)).toBe(original)
    },
  )

  it('restores completed player downloads without dropping their origin', () => {
    const snapshot = sanitizeDownloadHistorySnapshot({
      schemaVersion: DOWNLOAD_HISTORY_SCHEMA_VERSION,
      batches: [
        {
          id: 'player:1',
          origin: { kind: 'player', label: '播放器', referenceId: track.id },
          status: 'completed',
          startedAtMs: 1,
          completedAtMs: 2,
          concurrency: 1,
          items: [
            {
              id: 'item:1',
              track,
              status: 'succeeded',
              requestedAtMs: 1,
              maxRetryCount: 3,
              attempts: [],
            },
          ],
        },
      ],
    })
    expect(snapshot.batches[0]?.origin).toEqual({
      kind: 'player',
      label: '播放器',
      referenceId: track.id,
    })
    expect(snapshot.batches[0]?.items[0]?.status).toBe('succeeded')
  })

  it('keeps complete batches without imposing a retention limit', () => {
    const batches = Array.from({ length: 600 }, (_, index) => ({
      id: `batch:${index}`,
      origin: { kind: 'queue', label: '待听' },
      status: 'completed',
      startedAtMs: index,
      completedAtMs: index + 1,
      concurrency: 5,
      archive: {
        fileName: `batch-${index}.zip`,
        extension: 'zip',
        mimeType: 'application/zip',
        sizeBytes: 20,
      },
      items: [
        {
          id: `item:${index}`,
          track: { ...track, id: `track:${index}` },
          status: 'succeeded',
          requestedAtMs: index,
          startedAtMs: index,
          completedAtMs: index + 1,
          maxRetryCount: 3,
          progressMessage: '歌曲文件已生成，等待批次保存',
          attempts: [
            {
              attemptNumber: 1,
              startedAtMs: index,
              completedAtMs: index + 1,
              status: 'succeeded',
            },
          ],
          file: {
            fileName: '测试歌曲.mp3',
            extension: 'mp3',
            mimeType: 'audio/mpeg',
            sizeBytes: 10,
          },
        },
      ],
    }))

    const snapshot = sanitizeDownloadHistorySnapshot({
      schemaVersion: DOWNLOAD_HISTORY_SCHEMA_VERSION,
      batches,
    })
    expect(snapshot.batches).toHaveLength(600)
    expect(snapshot.batches[0]?.items[0]?.track).toMatchObject({ ...track, id: 'track:0' })
    expect(snapshot.batches[0]?.archive?.fileName).toBe('batch-0.zip')
    expect(snapshot.batches[0]?.items[0]?.progressMessage).toBe('歌曲文件已生成，等待批次保存')
  })

  it('marks downloads left running by a previous page as interrupted', () => {
    const snapshot: DownloadHistorySnapshot = {
      schemaVersion: DOWNLOAD_HISTORY_SCHEMA_VERSION,
      batches: [
        {
          id: 'batch:1',
          origin: { kind: 'music-list', label: '古风' },
          status: 'running',
          startedAtMs: 10,
          concurrency: 2,
          items: [
            {
              id: 'item:1',
              track,
              status: 'downloading',
              requestedAtMs: 10,
              startedAtMs: 11,
              maxRetryCount: 3,
              attempts: [{ attemptNumber: 1, startedAtMs: 11, status: 'running' }],
            },
          ],
        },
      ],
    }

    const restored = finalizeInterruptedDownloads(snapshot, 99)
    expect(restored.batches[0]?.status).toBe('interrupted')
    expect(restored.batches[0]?.items[0]).toMatchObject({
      status: 'interrupted',
      completedAtMs: 99,
      error: {
        code: 'download-interrupted',
        statusCode: 'AM-7202',
        message: '页面关闭或刷新导致下载中断。',
      },
    })
    expect(restored.batches[0]?.items[0]?.attempts[0]?.status).toBe('interrupted')
  })
})
