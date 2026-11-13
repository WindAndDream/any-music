import { getProductDestination, PRODUCT_DESTINATIONS } from '@any-music/ui'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'

import ProductWorkbench from '../../../src/components/shell/ProductWorkbench.vue'

/** 编译共享壳层，验证按钮与文字的可访问契约，不启动产品界面。 */
function renderWorkbench(
  sidebarSide: 'left' | 'right',
  sidebarCollapsed: boolean,
  mobile = false,
  source?: () => ReturnType<typeof h>,
) {
  vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() })
  return renderToString(
    createSSRApp({
      render: () =>
        h(
          ProductWorkbench,
          {
            activeDestination: getProductDestination('catalog'),
            activeDescription: '搜索音乐',
            navigationItems: [{ ...getProductDestination('queue'), count: 12 }],
            mobileNavigationItems: [],
            activeMobileNavigationId: 'catalog',
            preferenceDestinations: PRODUCT_DESTINATIONS,
            hiddenDestinationIds: [],
            sidebarSide,
            sidebarCollapsed,
            mobileDrawerOpen: mobile,
            mobileNavigationEnabled: false,
            mobileLayout: mobile,
            preferencesOpen: false,
            theme: 'system',
            resolvedTheme: 'light',
            hasPlayer: false,
            canHideProduct: true,
          },
          source ? { source } : undefined,
        ),
    }),
  )
}

function readTopBarMarkup(html: string): string | undefined {
  return html.match(/<header class="product-top-bar(?: [^"]*)?"[\s\S]*?<\/header>/)?.[0]
}

afterEach(() => vi.unstubAllGlobals())

describe('ProductWorkbench sidebar', () => {
  it('omits an absent source slot and forwards the mobile queue count through the shell', async () => {
    const empty = readTopBarMarkup(await renderWorkbench('left', false))!
    expect(empty).toContain('product-top-bar--without-source')
    expect(empty).not.toContain('product-top-bar__source')
    expect(empty).not.toContain('打开界面设置')
    const count = readTopBarMarkup(
      await renderWorkbench('left', false, true, () =>
        h('span', { 'aria-label': '待听共 12 首歌曲' }, '12 首'),
      ),
    )!
    expect(count).not.toContain('product-top-bar--without-source')
    expect(count).toContain('product-top-bar__source')
    expect(count).toContain('待听共 12 首歌曲')
    expect(count).not.toContain('平台切换')
  })
  it.each([false, true])(
    'passes the selected side only to the mobile top bar (mobile: %s)',
    async (mobile) => {
      const left = await renderWorkbench('left', false, mobile)
      const right = await renderWorkbench('right', false, mobile)
      expect(left).toContain('data-sidebar-side="left"')
      expect(right).toContain('data-sidebar-side="right"')
      expect(readTopBarMarkup(left)).toBeDefined()
      if (mobile) {
        expect(readTopBarMarkup(left)).toContain('data-sidebar-side="left"')
        expect(readTopBarMarkup(right)).toContain('data-sidebar-side="right"')
        expect(
          readTopBarMarkup(right)?.replace('data-sidebar-side="right"', 'data-sidebar-side="left"'),
        ).toBe(readTopBarMarkup(left))
      } else {
        expect(readTopBarMarkup(right)).toBe(readTopBarMarkup(left))
        expect(readTopBarMarkup(right)).not.toContain('data-sidebar-side')
      }
    },
  )

  it.each(['left', 'right'] as const)(
    'labels the visible %s rail state and retains accessible text nodes across collapse',
    async (side) => {
      const collapsed = await renderWorkbench(side, true)
      const expanded = await renderWorkbench(side, false)

      expect(collapsed).toMatch(
        /<button[^>]*aria-label="展开侧栏"[^>]*aria-expanded="false"[^>]*aria-controls="am-product-navigation"/,
      )
      expect(expanded).toMatch(/<button[^>]*aria-label="收起侧栏"[^>]*aria-expanded="true"/)
      expect(collapsed).toMatch(/class="product-sidebar__brand-copy"[^>]*aria-hidden="true"/)
      expect(expanded).toMatch(/class="product-sidebar__brand-copy"[^>]*aria-hidden="false"/)
      expect(collapsed).toMatch(/class="navigation-rail__label"[^>]*aria-hidden="true"[^>]*>待听/)
      expect(expanded).toMatch(/class="navigation-rail__label"[^>]*aria-hidden="false"[^>]*>待听/)
      expect(collapsed).toMatch(/<span[^>]*aria-hidden="true"[^>]*>设置<\/span>/)
      expect(expanded).toMatch(/<span[^>]*aria-hidden="false"[^>]*>设置<\/span>/)
      expect(collapsed).toContain('aria-label="打开全局设置"')
      expect(collapsed).toContain('aria-label="隐藏 Any Music"')
      expect(collapsed).not.toContain('自定义界面')
      expect(expanded).not.toContain('自定义界面')
    },
  )

  it('keeps the mobile drawer action labelled as closing navigation', async () => {
    const html = await renderWorkbench('right', false, true)
    expect(html).toContain('aria-label="收起侧栏"')
    expect(html).not.toContain('aria-label="展开侧栏"')
    expect(html).toContain('role="dialog" aria-modal="true" aria-label="功能导航"')
    expect(html).not.toContain('自定义界面')
  })

  it('provides the mobile navigation trigger as a visible semantic focus return target', async () => {
    const mobileTopBar = readTopBarMarkup(await renderWorkbench('left', false, true))!
    expect(mobileTopBar).toMatch(
      /<button[^>]*data-am-focus-key="navigation:open"[^>]*aria-label="关闭功能导航"/,
    )
    expect(readTopBarMarkup(await renderWorkbench('left', false))).not.toContain(
      'data-am-focus-key="navigation:open"',
    )
  })
})
