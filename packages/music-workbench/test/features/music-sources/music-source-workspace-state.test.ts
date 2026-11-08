import { describe, expect, it } from 'vitest'

import {
  createEmptyMusicSourceWorkspace,
  normalizeCatalogDrawerTitle,
  sanitizeMusicSourceWorkspaceSnapshot,
} from '#workbench/features/music-sources/music-source-workspace-state'

describe('sanitizeMusicSourceWorkspaceSnapshot', () => {
  it('preserves a bounded platform preference and ignores malformed preferences in old snapshots', () => {
    expect(
      sanitizeMusicSourceWorkspaceSnapshot({ schemaVersion: 1, activePluginId: 'douyin' })
        .activePluginId,
    ).toBe('douyin')
    for (const activePluginId of [undefined, '', 42, 'x'.repeat(201)]) {
      expect(
        sanitizeMusicSourceWorkspaceSnapshot({ schemaVersion: 1, activePluginId }).activePluginId,
      ).toBeUndefined()
    }
  })
  it('falls back when the schema is missing or incompatible', () => {
    expect(sanitizeMusicSourceWorkspaceSnapshot(undefined)).toEqual(
      createEmptyMusicSourceWorkspace(),
    )
    expect(sanitizeMusicSourceWorkspaceSnapshot({ schemaVersion: 2 })).toEqual(
      createEmptyMusicSourceWorkspace(),
    )
  })

  it('keeps replay recipes collapsed while removing duplicate and malformed drawers', () => {
    const snapshot = sanitizeMusicSourceWorkspaceSnapshot({
      schemaVersion: 1,
      disabledPluginIds: ['bilibili', 'bilibili', 1],
      proxySettings: {
        isEnabled: true,
        type: 'socks',
        host: '127.0.0.1',
        port: 1080,
        username: '',
        password: '',
        proxyDns: true,
      },
      downloadConcurrency: 9,
      searchQuery: '古风 DJ',
      importUrl: 'https://www.bilibili.com/video/BV1xx',
      drawers: [
        {
          id: 'drawer:1',
          pluginId: 'bilibili',
          kind: 'search',
          input: '古风 DJ',
          title: '我的搜索',
          isExpanded: true,
          // 旧版本曾保存加载页数；新版本兼容读取但不会恢复这些页。
          targetPageCount: 3,
          createdAtMs: 10,
          tracks: [{ id: 'must-not-be-persisted' }],
        },
        {
          id: 'drawer:1',
          pluginId: 'douyin',
          kind: 'search',
          input: '重复 ID',
          title: '应丢弃',
          isExpanded: false,
          createdAtMs: 11,
        },
        { id: 'broken' },
      ],
    })

    expect(snapshot.disabledPluginIds).toEqual(['bilibili'])
    expect(snapshot.proxySettings).toEqual({
      isEnabled: true,
      type: 'socks',
      host: '127.0.0.1',
      port: 1080,
      username: '',
      password: '',
      proxyDns: true,
    })
    expect(snapshot.downloadConcurrency).toBe(5)
    expect(snapshot.drawers).toEqual([
      {
        id: 'drawer:1',
        pluginId: 'bilibili',
        kind: 'search',
        input: '古风 DJ',
        title: '我的搜索',
        isExpanded: false,
        createdAtMs: 10,
      },
    ])
  })

  it('ignores a legacy restore page count instead of scheduling extra pages', () => {
    const snapshot = sanitizeMusicSourceWorkspaceSnapshot({
      schemaVersion: 1,
      drawers: [
        {
          id: 'drawer:1',
          pluginId: 'bilibili',
          kind: 'import-url',
          input: 'https://example.com/list',
          title: '导入',
          isExpanded: false,
          targetPageCount: 999_999,
          createdAtMs: 10,
        },
      ],
    })

    expect(snapshot.drawers[0]).toEqual({
      id: 'drawer:1',
      pluginId: 'bilibili',
      kind: 'import-url',
      input: 'https://example.com/list',
      title: '导入',
      isExpanded: false,
      createdAtMs: 10,
    })
  })

  it('restores only explicit pin preferences while retaining legacy recipes', () => {
    const recipe = {
      id: 'drawer:pinned',
      pluginId: 'test',
      kind: 'search',
      input: '华语',
      title: '华语搜索',
      isExpanded: true,
      createdAtMs: 10,
    }
    const snapshot = sanitizeMusicSourceWorkspaceSnapshot({
      schemaVersion: 1,
      drawers: [
        { ...recipe, isPinned: true },
        { ...recipe, id: 'drawer:legacy' },
        { ...recipe, id: 'drawer:malformed', isPinned: 'true' },
      ],
    })
    expect(
      snapshot.drawers.map((drawer) => [drawer.id, Boolean(drawer.isPinned), drawer.isExpanded]),
    ).toEqual([
      ['drawer:pinned', true, false],
      ['drawer:legacy', false, false],
      ['drawer:malformed', false, false],
    ])
  })
})

describe('normalizeCatalogDrawerTitle', () => {
  it('normalizes whitespace and rejects empty names', () => {
    expect(normalizeCatalogDrawerTitle('  我的\n抽屉  ')).toBe('我的 抽屉')
    expect(() => normalizeCatalogDrawerTitle('   ')).toThrow('抽屉名称不能为空')
  })
})
