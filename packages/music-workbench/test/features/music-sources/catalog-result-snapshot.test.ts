import { describe, expect, it } from 'vitest'

import { sanitizeCatalogResultSnapshot } from '#workbench/features/music-sources/catalog-result-snapshot'

const track = {
  id: 'source:one',
  title: 'Song',
  artists: [{ name: 'Artist' }],
  source: { pluginId: 'source', resourceId: 'one', mediaKind: 'audio' },
}

describe('retained catalog metadata', () => {
  it('allowlists stable metadata and pagination without saving media or runtime authority', () => {
    const result = sanitizeCatalogResultSnapshot(
      {
        tracks: [
          {
            ...track,
            url: 'https://cdn.example/temporary.mp3',
            bytes: [1, 2],
            source: { ...track.source, cookie: 'secret', pageUrl: 'blob:temporary' },
          },
        ],
        loadedPageCount: 2,
        hasMore: true,
        continuation: { kind: 'cursor', nextPage: 3, cursor: 27, cookie: 'secret' },
        account: { id: 'account', name: 'name', state: { cookie: 'secret' } },
        verify() {},
      },
      'source',
    )!
    expect(result.tracks[0]).toMatchObject(track)
    expect(result.continuation).toEqual({ kind: 'cursor', nextPage: 3, cursor: 27 })
    const stored = JSON.stringify(result)
    expect(result.account).toEqual({ id: 'account', name: 'name', customName: undefined })
    for (const forbidden of ['temporary', 'secret', 'bytes', 'verify', 'state'])
      expect(stored).not.toContain(forbidden)
  })

  it('retains a single-account display name without retaining session state', () => {
    const result = sanitizeCatalogResultSnapshot(
      {
        tracks: [],
        loadedPageCount: 1,
        hasMore: false,
        account: { name: '宿主用户', state: { login: 'signed-in' } },
      },
      'source',
    )
    expect(result?.account).toEqual({ id: undefined, name: '宿主用户', customName: undefined })
    expect(JSON.stringify(result)).not.toContain('signed-in')
  })

  it('drops malformed continuation and forbids skipping rows missing from a damaged cache', () => {
    const valid = { tracks: [track], loadedPageCount: 2, hasMore: true }
    for (const continuation of [
      { kind: 'page', nextPage: 99 },
      { kind: 'cursor', nextPage: 3, cursor: -1 },
      { kind: 'cursor', nextPage: 3, cursor: 'secret-token' },
    ])
      expect(
        sanitizeCatalogResultSnapshot({ ...valid, continuation }, 'source')?.continuation,
      ).toBeUndefined()
    const damaged = sanitizeCatalogResultSnapshot(
      {
        ...valid,
        tracks: [track, { ...track, source: { ...track.source, pluginId: 'another' } }],
        continuation: { kind: 'page', nextPage: 3 },
      },
      'source',
    )!
    expect(damaged.tracks).toHaveLength(1)
    expect(damaged.hasMore).toBe(true)
    expect(damaged.continuation).toBeUndefined()
  })
})
