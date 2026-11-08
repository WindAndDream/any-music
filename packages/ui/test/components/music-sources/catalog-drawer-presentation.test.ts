import { describe, expect, it } from 'vitest'

import {
  getCatalogDrawerErrorGuide,
  getCatalogDrawerNoticeLabel,
  getCatalogDrawerStatusLabel,
  getCatalogDrawerTrackSummary,
  getCatalogDrawerSourcePageUrl,
  getCatalogErrorGuide,
  hasCatalogDrawerError,
} from '../../../src/components/music-sources/catalog-drawer-presentation'
import type { CatalogDrawerView } from '../../../src/product/catalog-drawer'

function createDrawer(overrides: Partial<CatalogDrawerView> = {}): CatalogDrawerView {
  return {
    id: 'drawer-1',
    pluginId: 'bilibili',
    pluginName: '哔哩哔哩',
    kind: 'search',
    input: '现场音乐',
    title: '现场音乐',
    isExpanded: true,
    isSourceEnabled: true,
    loadedPageCount: 0,
    tracks: [],
    hasMore: false,
    isLoading: false,
    status: 'ready',
    errorMessage: '',
    invalidReason: '',
    ...overrides,
  }
}

describe('catalog drawer presentation', () => {
  it('separates track progress from compact failure reasons without exposing raw errors', () => {
    const failed = createDrawer({
      status: 'error',
      errorCode: 'verification-required',
      errorMessage: '来源要求完成一段较长的人工验证说明',
      tracks: [{ id: 'track-1' }] as never,
      total: 999999,
    })
    expect(getCatalogDrawerTrackSummary(failed)).toBe('1 / 999999 首')
    expect(getCatalogDrawerNoticeLabel(failed)).toBe('需要验证')
    expect(getCatalogDrawerTrackSummary(createDrawer({ status: 'error' }))).toBe('等待查看')
    expect(getCatalogDrawerNoticeLabel(createDrawer({ isLoading: true }))).toBe('加载歌曲中')
    expect(getCatalogDrawerNoticeLabel(createDrawer())).toBeUndefined()
  })

  it('prioritizes source availability over old errors and preserves cancelled-load notices', () => {
    const disabled = createDrawer({
      status: 'error',
      isSourceEnabled: false,
      errorCode: 'verification-required',
      errorMessage: '旧错误',
    })
    expect(getCatalogDrawerNoticeLabel(disabled)).toBe('音乐源已停用')
    expect(getCatalogDrawerNoticeLabel({ ...disabled, errorCode: 'operation-cancelled' })).toBe(
      '加载已取消',
    )
    expect(getCatalogDrawerNoticeLabel(createDrawer({ status: 'paused' }))).toBe('音乐源暂不可用')
  })

  it('distinguishes first-page failures from later pagination failures', () => {
    expect(getCatalogDrawerStatusLabel(createDrawer({ status: 'error' }))).toBe('加载失败')
    expect(
      getCatalogDrawerStatusLabel(
        createDrawer({ status: 'error', tracks: [{ id: 'track-1' }] as never }),
      ),
    ).toBe('已加载 1 · 翻页失败')
  })

  it('shows a short reason on the card while leaving the full error for details', () => {
    expect(
      getCatalogDrawerStatusLabel(
        createDrawer({
          status: 'error',
          errorCode: 'verification-required',
          errorMessage: '来源要求完成一段较长的人工验证说明',
          tracks: [{ id: 'track-1' }] as never,
        }),
      ),
    ).toBe('已加载 1 · 需要验证')
    expect(
      getCatalogDrawerStatusLabel(createDrawer({ status: 'invalid', errorCode: 'access-denied' })),
    ).toBe('权限受限')
  })

  it('routes list failures to error handling while preserving ready lists with invalid tracks', () => {
    for (const status of ['error', 'invalid', 'paused'] as const) {
      expect(hasCatalogDrawerError(createDrawer({ status }))).toBe(true)
    }
    expect(hasCatalogDrawerError(createDrawer({ status: 'ready' }))).toBe(false)
    expect(hasCatalogDrawerError(createDrawer({ status: 'restoring' }))).toBe(false)
    for (const status of ['disconnected', 'missing'] as const) {
      expect(hasCatalogDrawerError(createDrawer({ status }))).toBe(false)
    }
    expect(hasCatalogDrawerError(createDrawer({ status: 'error', isSourceEnabled: false }))).toBe(
      false,
    )
    expect(
      getCatalogDrawerStatusLabel(createDrawer({ status: 'error', isSourceEnabled: false })),
    ).toBe('音乐源已停用')
  })

  it('provides actionable guidance for authentication and pagination errors', () => {
    expect(getCatalogErrorGuide('not-authenticated').steps.join(' ')).toContain('登录')
    expect(getCatalogErrorGuide('pagination-unavailable').steps.join(' ')).toContain('已加载')
  })

  it('guides unavailable sources before offering a retry path', () => {
    expect(
      getCatalogDrawerErrorGuide(createDrawer({ status: 'missing', isSourceEnabled: false }))
        .steps[0],
    ).toContain('重新安装')
    expect(
      getCatalogDrawerErrorGuide(createDrawer({ status: 'paused', isSourceEnabled: false }))
        .steps[0],
    ).toContain('插件中心')
    expect(getCatalogDrawerErrorGuide(createDrawer({ status: 'invalid' })).steps[0]).toContain(
      '来源页面',
    )
    expect(
      getCatalogDrawerErrorGuide(
        createDrawer({ status: 'error', errorCode: 'pagination-unavailable' }),
      ).steps[0],
    ).toContain('已加载')
    expect(getCatalogErrorGuide('pagination-unavailable').steps[1]).toContain('从第一页重新加载')
    expect(
      getCatalogDrawerErrorGuide(
        createDrawer({
          status: 'error',
          errorCode: 'pagination-unavailable',
          sourceUrl: 'https://music.example.com/search/query',
        }),
      ),
    ).toEqual(getCatalogErrorGuide('pagination-unavailable'))
  })

  it('only exposes secure verification links', () => {
    expect(
      getCatalogDrawerSourcePageUrl(
        createDrawer({
          errorCode: 'verification-required',
          sourceUrl: 'https://www.bilibili.com/video/BV1xx',
        }),
      ),
    ).toBe('https://www.bilibili.com/video/BV1xx')
    expect(
      getCatalogDrawerSourcePageUrl(
        createDrawer({
          errorCode: 'verification-required',
          sourceUrl: 'http://example.com/verify',
        }),
      ),
    ).toBeUndefined()
    expect(
      getCatalogDrawerSourcePageUrl(
        createDrawer({
          status: 'error',
          errorCode: 'pagination-unavailable',
          sourceUrl: 'https://music.example.com/search/query',
        }),
      ),
    ).toBe('https://music.example.com/search/query')
    expect(
      getCatalogDrawerSourcePageUrl(
        createDrawer({
          status: 'error',
          kind: 'import-url',
          errorCode: 'pagination-unavailable',
          sourceUrl: 'https://music.example.com/playlist/1',
        }),
      ),
    ).toBeUndefined()
  })
})
