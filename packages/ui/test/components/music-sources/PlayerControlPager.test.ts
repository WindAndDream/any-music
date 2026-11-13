import PlayerControlPager from '@any-music/ui/components/music-sources/PlayerControlPager.vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSSRApp, h, nextTick, reactive } from 'vue'
import { renderToString } from 'vue/server-renderer'

import {
  CatalogTestElement,
  dispatchCatalogEvent,
  findCatalogElement,
  mountCatalogComponent,
} from './catalog-test-renderer'

afterEach(() => vi.unstubAllGlobals())

/** 编译共享分页器，验证真实消费端插槽与辅助技术隔离契约。 */
function renderPager(mobile: boolean, disabled = false): Promise<string> {
  return renderToString(
    createSSRApp({
      render: () =>
        h(
          PlayerControlPager,
          { mobile, disabled },
          {
            default: () => h('button', { type: 'button' }, '播放'),
            actions: () => h('button', { type: 'button' }, '下载'),
          },
        ),
    }),
  )
}

describe('PlayerControlPager', () => {
  it('retains the second page across full-player suspension and places its return arrow after the actions', async () => {
    vi.stubGlobal('ShadowRoot', CatalogTestElement)
    const props = reactive({ mobile: true, disabled: false })
    const mounted = mountCatalogComponent(PlayerControlPager, props)
    const arrow = (label: string) =>
      findCatalogElement(mounted.root, (node) => node.props['aria-label'] === label)
    dispatchCatalogEvent(arrow('更多播放控制'), 'onClick')
    await nextTick()
    const page = () =>
      findCatalogElement(
        mounted.root,
        (node) => node.props.class === 'player-control-pager__actions',
      )
    expect(page().props.inert).toBeUndefined()
    expect(page().children.at(-1)?.props['aria-label']).toBe('返回播放控制')
    props.disabled = true
    await nextTick()
    expect(page().props.inert).toBe(true)
    props.disabled = false
    await nextTick()
    expect(page().props.inert).toBeUndefined()
    expect(
      findCatalogElement(
        mounted.root,
        (node) => node.props.class === 'player-control-pager__playback',
      ).props.inert,
    ).toBe(true)
    dispatchCatalogEvent(arrow('返回播放控制'), 'onClick')
    await nextTick()
    expect(page().props.inert).toBe(true)
    mounted.unmount()
  })
  it('移动分页保留点击入口，两页均挂载但隐藏页不能获取焦点', async () => {
    const html = await renderPager(true)
    expect(html).toContain('player-control-pager--mobile')
    expect(html).toContain('更多播放控制')
    expect(html).toContain('返回播放控制')
    expect(html).toContain('>播放</button>')
    expect(html).toContain('>下载</button>')
    expect(html).toMatch(/class="player-control-pager__actions"[^>]*aria-hidden="true"[^>]*inert/)
    expect(html).not.toMatch(/class="player-control-pager__playback"[^>]*inert/)
  })

  it('桌面保持普通控制布局，完整播放器展开时整个迷你分页不可交互', async () => {
    expect(await renderPager(false)).not.toContain('player-control-pager--mobile')
    const html = await renderPager(true, true)
    expect(html).toMatch(/class="player-control-pager player-control-pager--mobile"[^>]*inert/)
    expect(html).toMatch(/class="player-control-pager__playback"[^>]*aria-hidden="true"[^>]*inert/)
  })
})
