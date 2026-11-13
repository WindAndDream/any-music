import type { Track } from '@any-music/core'
import type { DownloadHistoryBatch } from '@any-music/core'
import { describe, expect, it } from 'vitest'

import { createDownloadArchive } from '#workbench/features/downloads/download-archive'

const track: Track = {
  id: 'source:audio:1',
  title: '同名',
  artists: [{ name: '测试歌手' }],
  source: { pluginId: 'source', mediaKind: 'audio', resourceId: '1' },
}

const batch: DownloadHistoryBatch = {
  id: 'download-batch:test',
  origin: { kind: 'favorites', label: '我的喜欢' },
  status: 'running',
  startedAtMs: new Date(2026, 7, 29, 12, 34, 56).getTime(),
  concurrency: 2,
  items: [],
}

describe('createDownloadArchive', () => {
  it('creates one ZIP with unique audio names and a complete batch report', async () => {
    const blob = new Blob(['mp3'], { type: 'audio/mpeg' })
    const archive = await createDownloadArchive(batch, [
      {
        blob,
        summary: {
          fileName: `${track.title}.mp3`,
          extension: 'mp3',
          mimeType: 'audio/mpeg',
          sizeBytes: blob.size,
        },
      },
      {
        blob,
        summary: {
          fileName: `${track.title}.mp3`,
          extension: 'mp3',
          mimeType: 'audio/mpeg',
          sizeBytes: blob.size,
        },
      },
    ])

    expect(archive.fileName).toBe('any-music-download-20260829-123456.zip')
    expect(archive.blob.size).toBeGreaterThan(blob.size * 2)
    const bytes = new Uint8Array(await archive.blob.arrayBuffer())
    expect(bytes.slice(0, 4)).toEqual(new Uint8Array([0x50, 0x4b, 0x03, 0x04]))
    const archiveText = new TextDecoder().decode(bytes)
    expect(archiveText).toContain('同名.mp3')
    expect(archiveText).toContain('同名 (2).mp3')
    expect(archiveText).toContain('any-music-download-report.json')
    expect(archiveText).toContain('download-batch:test')
    expect(archiveText).toContain('"status": "completed"')
  })
})
