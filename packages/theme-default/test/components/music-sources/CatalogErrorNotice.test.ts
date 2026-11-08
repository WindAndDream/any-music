import type { CatalogDrawerView } from '@any-music/ui'
import { describe, expect, it } from 'vitest'
import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'

import CatalogErrorNotice from '../../../src/components/music-sources/CatalogErrorNotice.vue'

function renderNotice(overrides: Partial<CatalogDrawerView> = {}): Promise<string> {
  const drawer: CatalogDrawerView = {
    id: 'drawer:douyin',
    pluginId: 'douyin',
    pluginName: '抖音',
    kind: 'search',
    input: '音乐',
    title: '抖音搜索：音乐',
    isExpanded: true,
    isSourceEnabled: true,
    loadedPageCount: 1,
    tracks: [],
    hasMore: false,
    isLoading: false,
    status: 'error',
    errorCode: 'pagination-unavailable',
    errorMessage: '搜索暂时无法继续加载；已保留当前结果。（错误码：AM-3006）',
    invalidReason: '',
    sourceUrl: 'https://example.com/search/music',
    ...overrides,
  }
  // 编译真实组件检查可访问摘要及来源指引，不启动浏览器或产品界面。
  return renderToString(createSSRApp({ render: () => h(CatalogErrorNotice, { drawer }) }))
}

describe('CatalogErrorNotice', () => {
  it.each(['disconnected', 'error', 'invalid', 'missing'] as const)(
    'shows a static neutral notice for a disconnected %s list instead of its old error',
    async (status) => {
      const html = await renderNotice({
        status,
        isSourceEnabled: false,
        tracks: [{ id: 'douyin:1' }] as never,
      })
      expect(html).toContain('role="status"')
      expect(html).toContain('catalog-drawer__message--disconnected')
      expect(html).toContain('已保留 1 首歌曲供查看，暂不加载新歌曲')
      expect(html).not.toContain('role="alert"')
      expect(html).not.toContain('<button')
      expect(html).not.toContain('AM-3006')
    },
  )

  it('renders one clickable error summary and leaves source actions in the error dialog', async () => {
    const html = await renderNotice()
    expect(html).toContain('role="alert"')
    expect(html).toContain('aria-haspopup="dialog"')
    expect(html).toContain('搜索暂时无法继续加载；已保留当前结果。')
    expect(html).toContain('AM-3006')
    expect(html.match(/<button\b/g)).toHaveLength(1)
    expect(html).not.toContain('<a ')
    expect(html).not.toContain('<strong>查看详情</strong>')
    expect(html).not.toContain('打开来源搜索页')
    expect(html).not.toContain('前往来源页面验证')
  })

  it('preserves source-unavailability reasons and hides the notice after recovery', async () => {
    expect(
      await renderNotice({ status: 'paused', invalidReason: '来源已停用，请前往插件中心启用。' }),
    ).toContain('来源已停用，请前往插件中心启用。')
    expect(
      await renderNotice({ status: 'ready', errorCode: undefined, errorMessage: '' }),
    ).not.toContain('role="alert"')
  })
})
