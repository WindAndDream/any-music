/** Synthetic identities exercise presentation and mutations, never live media acceptance. */
export function createVirtualListTestData(data, { count, theme }) {
  const compact = count === 10000
  const tracks = Array.from({ length: count }, (_, i) => ({
    track: {
      id: `v${i}`,
      title: compact
        ? `T${i}`
        : `测试歌曲 ${String(i).padStart(4, '0')}${i % 7 === 0 ? ' · 长标题与换行 Long title layout test' : ''}`,
      artists: [{ name: compact ? 'A' : `测试歌手 ${i % 8}` }],
      durationMs: 180000,
      ...(!compact && i % 5 === 0 ? { sourceTags: ['测试', '长标签'] } : {}),
      source: {
        pluginId: i % 3 === 0 ? 'douyin' : 'bilibili',
        resourceId: `v${i}`,
        mediaKind: 'audio',
      },
    },
    favoritedAtMs: 1,
    addedAtMs: 1,
    updatedAtMs: 1,
  }))
  const trackIds = tracks.map(({ track }) => track.id)
  return {
    ...data,
    core: {
      ...data.core,
      library: {
        ...data.core.library,
        tracks,
        playlists: [
          {
            id: 'virtual-list-test',
            name: `虚拟列表测试 · ${count} 首`,
            trackIds,
            createdAtMs: 1,
            updatedAtMs: 1,
          },
        ],
        history: [],
        customTracks: [],
      },
      // Preserve the product's existing 5,000-item queue limit.
      queue: {
        schemaVersion: 1,
        trackIds: trackIds.slice(0, 5000),
        mode: 'sequence',
        arrangementMode: 'flat',
      },
      favorites: { schemaVersion: 1, trackIds, arrangementMode: 'flat' },
    },
    host: {
      ...data.host,
      theme: { themeId: theme === 'studio' ? 'studio' : 'default', settingsByTheme: {} },
    },
  }
}
