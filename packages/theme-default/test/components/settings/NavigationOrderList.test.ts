import { PRODUCT_DESTINATIONS } from '@any-music/ui'
import { describe, expect, it } from 'vitest'
import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'

import NavigationOrderList from '../../../src/components/settings/NavigationOrderList.vue'

/** 消费端编译真实排序模板，确认移动端从 DOM 移除方向按钮并保留可访问手柄。 */
function renderList(isMobileLayout: boolean): Promise<string> {
  return renderToString(
    createSSRApp({
      render: () =>
        h(NavigationOrderList, {
          destinations: PRODUCT_DESTINATIONS,
          hiddenDestinationIds: ['queue'],
          isMobileLayout,
        }),
    }),
  )
}

describe('NavigationOrderList', () => {
  it('retains drag handles and visibility on mobile without redundant arrow buttons', async () => {
    const html = await renderList(true)
    expect(html).not.toContain('navigation-order__move-actions')
    expect(html).not.toContain('aria-label="上移')
    expect(html).not.toContain('aria-label="下移')
    for (const destination of PRODUCT_DESTINATIONS) {
      expect(html).toContain(`拖动 ${destination.label} 排序；键盘按空格或回车后使用上下方向键移动`)
    }
    expect(html).toContain('固定显示')
    expect(html).toContain('已隐藏')
    expect(html).toContain('显示中')
  })

  it('retains desktop move actions and prevents moving beyond either end', async () => {
    const html = await renderList(false)
    expect(html).toContain('navigation-order__move-actions')
    expect(html).toMatch(/disabled[^>]*aria-label="上移 发现"/)
    expect(html).toMatch(/disabled[^>]*aria-label="下移 插件中心"/)
  })
})
