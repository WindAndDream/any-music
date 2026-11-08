import type { CatalogDrawerView } from '@any-music/ui'
import { describe, expect, it } from 'vitest'
import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'

import CatalogErrorDetails from '../../../src/components/music-sources/CatalogErrorDetails.vue'

const drawer: CatalogDrawerView = {
  id: 'drawer:test',
  pluginId: 'douyin',
  pluginName: '抖音',
  kind: 'search',
  input: '夜曲',
  title: '夜曲',
  isExpanded: true,
  isSourceEnabled: true,
  loadedPageCount: 0,
  tracks: [],
  hasMore: false,
  isLoading: false,
  status: 'error',
  errorCode: 'verification-required',
  errorMessage: '需要安全验证',
  invalidReason: '',
  sourceUrl: 'https://www.douyin.com/search/夜曲',
}
const render = (input: Partial<CatalogDrawerView>) =>
  renderToString(
    createSSRApp({ render: () => h(CatalogErrorDetails, { drawer: { ...drawer, ...input } }) }),
  )
describe('catalog verification actions', () => {
  it('keeps the request reason and presents a failed verification action with its retry button', async () => {
    const html = await render({
      canVerify: true,
      verificationPhase: 'failed',
      verificationErrorMessage: '无法启动浏览器（错误码：AM-4001）',
      failureOperation: 'pagination',
      account: {
        id: 'a',
        state: { login: 'signed-in', verification: 'required', connection: 'available' },
      },
    })
    expect(html).toContain('需要安全验证')
    expect(html).toContain('验证操作未完成：无法启动浏览器')
    expect(html).toContain('重新验证')
    expect(html).toContain('已登录 · 需要安全验证')
    expect(html).toContain('加载后续页')
    expect(html).not.toContain('登录失效')
  })
  it.each([
    ['opening', '正在打开此账号的验证浏览器'],
    ['confirming', '正在确认验证结果并保存账号凭证'],
    ['restoring', '验证已通过，正在更新账号并重新加载列表'],
  ] as const)('shows the current recovery stage %s', async (phase, message) => {
    const html = await render({ canVerify: true, isVerifying: true, verificationPhase: phase })
    expect(html).toContain(message)
    expect(html).not.toContain('需要安全验证')
  })
  it('uses account verification when available without a disconnected source-page shortcut', async () => {
    const native = await render({ canVerify: true })
    expect(native).toContain('>验证</button>')
    expect(native).toContain('自动关闭浏览器并重新加载列表')
    expect(native).not.toContain('target="_blank"')
    const userscript = await render({})
    expect(userscript).not.toContain('target="_blank"')
    expect(userscript).not.toContain('前往来源页面验证')
    expect(userscript).toContain('重试')
  })
  it('offers cancellation and disables repeated verification and recovery while waiting', async () => {
    const html = await render({ canVerify: true, isVerifying: true })
    expect(html).toContain('取消验证')
    expect(html).toContain('等待验证…')
    expect(html.match(/disabled/g)).toHaveLength(2)
    expect(html).toContain('正在等待验证')
    expect(html).toContain('role="status"')
    expect(html).not.toContain('错误原因')
    expect(html).not.toContain('错误代码')
    expect(html).not.toContain('需要安全验证')
  })

  it.each([
    { status: 'error' as const, isLoading: true },
    { status: 'restoring' as const, isLoading: false },
  ])('shows recovery progress while the first page is pending: %j', async (state) => {
    const html = await render({ ...state, errorCode: undefined, errorMessage: '' })
    expect(html).toContain('正在重新加载列表')
    expect(html).toContain('正在重新加载第一页，请稍候。')
    expect(html).toContain('role="status"')
    expect(html).toContain('正在重试…')
    expect(html.match(/disabled/g)).toHaveLength(1)
    expect(html).not.toContain('当前列表暂时无法继续加载')
    expect(html).not.toContain('错误原因')
    expect(html).not.toContain('处理指引')
  })

  it('replaces stale verification errors during recovery and shows the actual failure afterward', async () => {
    const recovering = await render({ isLoading: true, canVerify: true })
    expect(recovering).toContain('正在重新加载列表')
    expect(recovering).not.toContain('需要安全验证')
    expect(recovering).not.toContain('verification-required')

    const failed = await render({
      errorCode: 'network-error',
      errorMessage: '重试加载列表时网络连接失败',
    })
    expect(failed).toContain('错误原因')
    expect(failed).toContain('重试加载列表时网络连接失败')
    expect(failed).toContain('检查网络后重试')
    expect(failed).not.toContain('正在重新加载列表')
  })
})
