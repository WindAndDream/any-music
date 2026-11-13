import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useCollectionDisplayPreferences } from '#workbench/features/library/use-collection-display-preferences'

const storage = vi.hoisted(() => ({ readStored: vi.fn(), writeStored: vi.fn() }))
vi.mock('#workbench/runtime/storage', () => storage)
beforeEach(() => {
  const values = new Map<string, unknown>()
  storage.readStored.mockReset().mockImplementation((key) => values.get(key))
  storage.writeStored
    .mockReset()
    .mockImplementation((key, value) => values.set(key, structuredClone(value)))
})

describe('collection display preferences', () => {
  it('persists defaults for unseen regions while retaining explicit collection overrides', () => {
    const catalog = useCollectionDisplayPreferences('catalog')
    catalog.setDefault('tracks', { displayMode: 'compact', mobileColumns: 2, itemStyle: 'minimal' })
    expect(catalog.get('platform:new')).toEqual({
      displayMode: 'compact',
      mobileColumns: 2,
      itemStyle: 'minimal',
    })
    expect(catalog.get('items').itemStyle).toBe('minimal')
    catalog.set('platform:custom', { displayMode: 'comfortable' })
    catalog.setDefault('tracks', { displayMode: 'standard', mobileColumns: 1 })
    const restored = useCollectionDisplayPreferences('catalog')
    expect(restored.get('platform:new').displayMode).toBe('standard')
    expect(restored.get('platform:custom').displayMode).toBe('comfortable')
    expect(restored.get('platform:custom').mobileColumns).toBe(2)
    expect(useCollectionDisplayPreferences('favorites').get('flat').displayMode).toBe('standard')
    const playlists = useCollectionDisplayPreferences('playlists')
    playlists.setDefault('tracks', { displayMode: 'compact' })
    playlists.setDefault('playlist-cards', { displayMode: 'comfortable' })
    expect(
      useCollectionDisplayPreferences('playlists').get(
        'playlist:11111111-1111-4111-8111-111111111111:flat',
      ).displayMode,
    ).toBe('compact')
    expect(playlists.get('overview:flat').displayMode).toBe('comfortable')
    expect(playlists.getDefault('playlist-cards').displayMode).toBe('comfortable')
  })

  it('isolates plugin and tag layouts and retries an unchanged default after a failed write', () => {
    const plugins = useCollectionDisplayPreferences('plugins')
    const tags = useCollectionDisplayPreferences('tags')
    plugins.setDefault('tracks', { layout: 'list' })
    tags.setDefault('tracks', { layout: 'rows' })
    tags.setDefault('associated-tracks', {
      displayMode: 'compact',
      mobileColumns: 2,
      itemStyle: 'default',
    })
    expect(useCollectionDisplayPreferences('plugins').getDefault('tracks').layout).toBe('list')
    expect(useCollectionDisplayPreferences('tags').getDefault('tracks').layout).toBe('rows')
    expect(useCollectionDisplayPreferences('tags').getDefault('associated-tracks')).toEqual({
      displayMode: 'compact',
      mobileColumns: 2,
      itemStyle: 'default',
    })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    storage.writeStored.mockImplementationOnce(() => {
      throw new Error('disk full')
    })
    try {
      expect(plugins.setDefault('tracks', { layout: 'grid' })).toMatchObject({
        code: 'storage-write-failed',
      })
      expect(plugins.getDefault('tracks').layout).toBe('grid')
      plugins.setDefault('tracks', { layout: 'grid' })
      expect(useCollectionDisplayPreferences('plugins').getDefault('tracks').layout).toBe('grid')
    } finally {
      warn.mockRestore()
    }
  })
  it('restores independent item styles without mixing boards, playlists or arrangement', () => {
    const catalog = useCollectionDisplayPreferences('catalog')
    const queue = useCollectionDisplayPreferences('queue')
    queue.set('items', { itemStyle: 'default' })
    queue.set('flat', { displayMode: 'compact' })
    expect(catalog.get('items').itemStyle).toBe('minimal')
    expect(useCollectionDisplayPreferences('queue').get('items').itemStyle).toBe('default')
    expect(useCollectionDisplayPreferences('queue').get('flat').displayMode).toBe('compact')
    expect(useCollectionDisplayPreferences('favorites').get('items').itemStyle).toBe('minimal')
    expect(useCollectionDisplayPreferences('playlists').get('items').itemStyle).toBe('minimal')
    expect(useCollectionDisplayPreferences('history').get('items').itemStyle).toBe('minimal')
  })
  it('defaults to standard desktop density and the first phone option and restores independent regions', () => {
    const queue = useCollectionDisplayPreferences('queue')
    expect(queue.get('flat')).toEqual({
      displayMode: 'standard',
      mobileColumns: 1,
      itemStyle: 'minimal',
    })
    expect(queue.get('platform:source')).toEqual(queue.get('flat'))
    queue.set('flat', { displayMode: 'comfortable', mobileColumns: 1 })
    queue.set('platform', { displayMode: 'compact' })
    queue.set('platform:source', { displayMode: 'compact', mobileColumns: 2 })
    const restored = useCollectionDisplayPreferences('queue')
    expect(restored.get('flat')).toEqual({
      displayMode: 'comfortable',
      mobileColumns: 1,
      itemStyle: 'minimal',
    })
    expect(restored.get('platform')).toEqual({
      displayMode: 'compact',
      mobileColumns: 1,
      itemStyle: 'minimal',
    })
    expect(restored.get('platform:source')).toEqual({
      displayMode: 'compact',
      mobileColumns: 2,
      itemStyle: 'minimal',
    })
    expect(restored.get('platform:another')).toEqual({
      displayMode: 'standard',
      mobileColumns: 1,
      itemStyle: 'minimal',
    })
    expect(useCollectionDisplayPreferences('favorites').get('flat')).toEqual({
      displayMode: 'standard',
      mobileColumns: 1,
      itemStyle: 'minimal',
    })
    expect(storage.writeStored).toHaveBeenCalledTimes(3)
  })

  it('isolates download status regions and ignores malformed stored options', () => {
    const downloads = useCollectionDisplayPreferences('downloads')
    downloads.set('all', { displayMode: 'comfortable' })
    downloads.set('failed', { displayMode: 'compact', mobileColumns: 1 })
    const restored = useCollectionDisplayPreferences('downloads')
    expect(restored.get('all').displayMode).toBe('comfortable')
    expect(restored.get('failed')).toEqual({
      displayMode: 'compact',
      mobileColumns: 1,
      itemStyle: 'minimal',
    })
    expect(restored.get('paused')).toEqual({
      displayMode: 'standard',
      mobileColumns: 1,
      itemStyle: 'minimal',
    })
    storage.readStored.mockReturnValue({
      schemaVersion: 1,
      views: {
        flat: { displayMode: 'invalid', mobileColumns: 5 },
        invalid: { displayMode: 'compact' },
      },
    })
    const invalid = useCollectionDisplayPreferences('favorites')
    expect(invalid.get('flat')).toEqual({
      displayMode: 'standard',
      mobileColumns: 1,
      itemStyle: 'minimal',
    })
    expect(Object.keys(invalid.preferences.value)).toEqual(['flat'])
  })

  it('keeps playlist overview, each playlist and platform views independent on reload', () => {
    const first = 'playlist:11111111-1111-4111-8111-111111111111'
    const second = 'playlist:22222222-2222-4222-8222-222222222222'
    const preferences = useCollectionDisplayPreferences('playlists')
    preferences.set('overview:flat', { displayMode: 'compact', mobileColumns: 2 })
    preferences.set(`${first}:flat`, { displayMode: 'comfortable' })
    preferences.set(`${first}:platform:source`, { mobileColumns: 2 })
    const restored = useCollectionDisplayPreferences('playlists')
    expect(restored.get('overview:flat')).toEqual({
      displayMode: 'compact',
      mobileColumns: 2,
      itemStyle: 'minimal',
    })
    expect(restored.get(`${first}:flat`).displayMode).toBe('comfortable')
    expect(restored.get(`${first}:platform:source`).mobileColumns).toBe(2)
    expect(restored.get(`${second}:flat`).displayMode).toBe('standard')
    expect(useCollectionDisplayPreferences('favorites').get('flat').displayMode).toBe('standard')
  })

  it('retains session preferences when persistence fails', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      storage.readStored.mockImplementation(() => {
        throw new Error('read failed')
      })
      const queue = useCollectionDisplayPreferences('queue')
      storage.writeStored.mockImplementation(() => {
        throw new Error('write failed')
      })
      queue.set('flat', { displayMode: 'compact' })
      expect(queue.get('flat').displayMode).toBe('compact')
      expect(warn).toHaveBeenCalledTimes(2)
    } finally {
      warn.mockRestore()
    }
  })
})
