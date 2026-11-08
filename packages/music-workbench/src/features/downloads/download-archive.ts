import {
  DOWNLOAD_HISTORY_SCHEMA_VERSION,
  type DownloadHistoryBatch,
  type DownloadedFileSummary,
} from '@any-music/core'
import { downloadZip } from 'client-zip'

export interface GeneratedDownloadFile {
  blob: Blob
  summary: DownloadedFileSummary
  /** A verified local artifact needs neither media work nor another save. */
  existing?: boolean
}

export interface DownloadArchive {
  blob: Blob
  fileName: string
}

/**
 * 多曲批次把成功生成的 MP3 和完整批次报告写入同一个 ZIP。
 * MP3 已经压缩，client-zip 的存储模式可避免再次压缩造成的额外内存与 CPU 消耗。
 */
export async function createDownloadArchive(
  batch: DownloadHistoryBatch,
  files: readonly GeneratedDownloadFile[],
  signal?: AbortSignal,
): Promise<DownloadArchive> {
  throwIfCancelled(signal)
  const usedNames = new Set<string>()
  const entries = files.map((file) => ({
    name: createUniqueFileName(file.summary.fileName, usedNames),
    input: file.blob,
    lastModified: new Date(batch.startedAtMs),
  }))
  entries.push({
    name: 'any-music-download-report.json',
    input: new Blob([createDownloadReport(batch)], { type: 'application/json' }),
    lastModified: new Date(),
  })

  const blob = await downloadZip(entries).blob()
  throwIfCancelled(signal)
  return {
    blob,
    fileName: `any-music-download-${formatArchiveTimestamp(batch.startedAtMs)}.zip`,
  }
}

function createDownloadReport(batch: DownloadHistoryBatch): string {
  const generatedAtMs = Date.now()
  return JSON.stringify(
    {
      schemaVersion: DOWNLOAD_HISTORY_SCHEMA_VERSION,
      generatedAtMs,
      batch: {
        ...batch,
        status: 'completed',
        completedAtMs: generatedAtMs,
        archive: undefined,
        archiveError: undefined,
      },
    },
    undefined,
    2,
  )
}

function createUniqueFileName(fileName: string, usedNames: Set<string>): string {
  if (!usedNames.has(fileName)) {
    usedNames.add(fileName)
    return fileName
  }
  const dotIndex = fileName.lastIndexOf('.')
  const baseName = dotIndex > 0 ? fileName.slice(0, dotIndex) : fileName
  const extension = dotIndex > 0 ? fileName.slice(dotIndex) : ''
  let duplicateIndex = 2
  let candidate = `${baseName} (${duplicateIndex})${extension}`
  while (usedNames.has(candidate)) {
    duplicateIndex += 1
    candidate = `${baseName} (${duplicateIndex})${extension}`
  }
  usedNames.add(candidate)
  return candidate
}

function formatArchiveTimestamp(timestampMs: number): string {
  const date = new Date(timestampMs)
  return `${date.getFullYear()}${padDatePart(date.getMonth() + 1)}${padDatePart(date.getDate())}-${padDatePart(date.getHours())}${padDatePart(date.getMinutes())}${padDatePart(date.getSeconds())}`
}

function padDatePart(value: number): string {
  return value.toString().padStart(2, '0')
}

function throwIfCancelled(signal: AbortSignal | undefined): void {
  if (!signal?.aborted) return
  const error = new Error('下载已由用户中止。')
  error.name = 'AbortError'
  throw error
}
