import type { Track } from '@any-music/core'
import { describe, expect, it, vi } from 'vitest'

import { createOfflinePluginDataProxy } from '../../src/plugin-adapters/offline-plugin-data'
import type {
  OfflinePluginDataPort,
  PluginDataProvenance,
} from '../../src/plugin-adapters/offline-plugin-data'

function fixture() {
  const port: OfflinePluginDataPort = {
    select: vi.fn(async () => ({ contextRef: 'context' })),
    read: vi.fn(async () => ({ Title: 'title' })),
    prepareAnnotation: vi.fn(async () => 'ticket'),
    commit: vi.fn(async () => 2),
  }
  const track = {
    id: 'track',
    title: 'title',
    artists: [{ name: 'artist', cookie: 'secret' }],
    source: {
      pluginId: 'bilibili',
      resourceId: 'r',
      mediaKind: 'video',
      signedUrl: 'https://private.invalid/?token=secret',
    },
    artworkUrl: 'https://private.invalid',
    cookie: 'secret',
    playlistName: 'private playlist',
  } as unknown as Track
  return { port, track, proxy: createOfflinePluginDataProxy(port) }
}
describe('offline host data proxy', () => {
  it('projects only selected text and treats untracked data as L2', async () => {
    const { proxy, port, track } = fixture()
    await proxy.select({ track, accountScope: 'account', version: 1 })
    const projection = vi.mocked(port.select).mock.calls[0]![0]
    expect(Object.keys(projection.fields)).toEqual(['Title', 'Artist'])
    expect(projection.fields.Title?.provenance.level).toBe('L2')
    expect(projection.fields.Artist?.text).toBe('artist')
    expect(JSON.stringify(projection)).not.toMatch(/cookie|secret|signedUrl|artwork|playlistName/u)
  })
  it('preserves native provenance copies and never treats a selected note as public', async () => {
    const { proxy, port, track } = fixture()
    const provenance: PluginDataProvenance = {
      level: 'L2',
      sourceInstall: 'a',
      sourceContext: 'input',
      generation: 2,
      dataGeneration: 3,
    }
    await proxy.select({
      track,
      accountScope: 'account',
      version: 1,
      titleProvenance: provenance,
      note: { text: 'note', provenance: { ...provenance, level: 'L0' } },
    })
    provenance.sourceInstall = 'changed'
    const projection = vi.mocked(port.select).mock.calls[0]![0]
    expect(projection.fields.Title?.provenance.sourceInstall).toBe('a')
    expect(projection.fields.Note?.provenance.level).toBe('L2')
  })
  it('forwards only the named annotation and returns the native committed version', async () => {
    const { proxy, port } = fixture()
    expect(
      await proxy.annotate({
        contextRef: 'ctx',
        objectId: 'track',
        expectedVersion: 1,
        operationId: 'once',
        text: 'annotation',
      }),
    ).toBe(2)
    expect(port.commit).toHaveBeenCalledExactlyOnceWith('ticket')
  })
  it('propagates a revoked commit without any renderer business mutation', async () => {
    const { proxy, port } = fixture()
    vi.mocked(port.commit).mockRejectedValue(new Error('revoked'))
    await expect(
      proxy.annotate({
        contextRef: 'ctx',
        objectId: 'track',
        expectedVersion: 1,
        operationId: 'once',
        text: 'annotation',
      }),
    ).rejects.toThrow('revoked')
  })
  it('rejects malformed proposals before reservation', async () => {
    const { proxy, port } = fixture()
    await expect(
      proxy.annotate({
        contextRef: 'ctx',
        objectId: 'track',
        expectedVersion: 1,
        operationId: 'once',
        text: 'bad\nannotation',
      }),
    ).rejects.toThrow()
    expect(port.prepareAnnotation).not.toHaveBeenCalled()
  })
})
