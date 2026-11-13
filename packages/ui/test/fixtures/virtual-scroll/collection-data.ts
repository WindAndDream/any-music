import type { LibraryTrackRecord, Track } from '@any-music/core'

export const virtualCollectionSizes = [0, 1, 80, 1_000, 10_000] as const
const fixtureTimeMs = Date.UTC(2026, 10, 3)

// In-memory artwork exercises missing/square/tall metadata without network or storage.
function artwork(width: number, height: number): string {
  return `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="#547b8c"/></svg>`)}`
}
const squareArtwork = artwork(120, 120)
const tallArtwork = artwork(120, 240)

export interface CollectionOccurrence {
  /** Playback-history identity is distinct from the underlying track identity. */
  occurrenceKey: string
  track: Track
}

/** Test-only input shared by geometry/measurement regressions; never persist these records. */
export function createVirtualCollectionFixture(count: number) {
  if (!Number.isSafeInteger(count) || count < 0) throw new RangeError('Invalid fixture count')
  const records: LibraryTrackRecord[] = Array.from({ length: count }, (_, index) => {
    const resourceId = String(index).padStart(5, '0')
    const pluginId = `fixture-${index % 3}`
    return {
      track: {
        id: `${pluginId}:audio:${resourceId}`,
        title:
          index % 5 === 0
            ? `长标题 ${resourceId} ${'音乐与布局 '.repeat(12)}`
            : `歌曲 ${resourceId}`,
        artists: [{ name: `创作者 ${index % 11}` }],
        artworkUrl: index % 3 === 0 ? undefined : index % 3 === 1 ? squareArtwork : tallArtwork,
        durationMs: 60_000 + (index % 240) * 1_000,
        publishedAtMs: fixtureTimeMs - index * 86_400_000,
        source: { pluginId, resourceId, mediaKind: 'audio' },
      },
      customName: index % 7 === 0 ? `自定义名称 ${resourceId}` : undefined,
      customTags: Array.from(
        { length: index % 6 },
        (_value, tag) => `标签 ${tag} ${'长文本'.repeat(tag)}`,
      ),
      favoritedAtMs: fixtureTimeMs - index * 1_000,
      addedAtMs: fixtureTimeMs - index * 2_000,
      updatedAtMs: fixtureTimeMs,
    }
  })
  const occurrences: CollectionOccurrence[] = records.map((_, index) => ({
    occurrenceKey: `occurrence:${String(index).padStart(5, '0')}`,
    track: records[Math.floor(index / 2)]!.track,
  }))
  return { records, occurrences }
}

/** An edit can both grow and shrink content without changing source or occurrence identity. */
export function resizeFixtureContent(
  record: LibraryTrackRecord,
  expanded: boolean,
): LibraryTrackRecord {
  return {
    ...record,
    track: {
      ...record.track,
      title: expanded ? `${record.track.title} ${'展开内容 '.repeat(20)}` : '短标题',
      artworkUrl: expanded ? tallArtwork : squareArtwork,
    },
    customTags: expanded ? Array.from({ length: 12 }, (_, index) => `展开标签 ${index}`) : [],
  }
}
