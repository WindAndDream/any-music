import { createAppErrorState } from '@any-music/core'
import type { UiThemeStatus } from '@any-music/ui/theme'
import { describe, expect, it } from 'vitest'
import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'

import StudioFeatureStatus from '../../src/components/StudioFeatureStatus.vue'

const error = createAppErrorState('network-error', '请求失败')
describe('Studio required feature states', () => {
  it.each([
    [{ status: 'idle' }, '等待操作'],
    [{ status: 'loading' }, '正在加载'],
    [{ status: 'empty' }, '暂无内容'],
    [{ status: 'ready' }, ''],
    [{ status: 'partial', errors: [error] }, '请求失败'],
    [{ status: 'error', error }, '请求失败'],
    [{ status: 'invalid', error }, '请求失败'],
  ] satisfies [UiThemeStatus, string][])(
    'renders %j without hiding retained content',
    async (status, text) => {
      const html = await renderToString(
        createSSRApp({
          render: () => h(StudioFeatureStatus, { availability: { status: 'available' }, status }),
        }),
      )
      expect(html).toContain(text)
    },
  )
  it.each(['disabled', 'unavailable'] as const)('explains %s capabilities', async (status) => {
    const html = await renderToString(
      createSSRApp({
        render: () =>
          h(StudioFeatureStatus, {
            availability: { status, reason: '没有可用音乐源' },
            status: { status: 'empty' },
          }),
      }),
    )
    expect(html).toContain('没有可用音乐源')
  })
})
