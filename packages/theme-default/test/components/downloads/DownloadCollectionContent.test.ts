import { afterEach, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'

import DownloadCollectionContent from '../../../src/components/downloads/DownloadCollectionContent.vue'
import {
  dispatchCatalogEvent,
  findCatalogElement,
  mountCatalogComponent,
} from '../../helpers/test-renderer'

afterEach(() => vi.unstubAllGlobals())

it('advances through the grouped download tabs and points left at the end', async () => {
  vi.stubGlobal('window', { matchMedia: () => ({ matches: false }) })
  const view = mountCatalogComponent(DownloadCollectionContent, {
    concurrency: 2,
    mobileLayout: true,
    status: 'all',
    statuses: [
      { id: 'all', name: '全部' },
      { id: 'downloading', name: '下载中' },
      { id: 'paused', name: '已暂停' },
      { id: 'succeeded', name: '已下载' },
      { id: 'failed', name: '下载失败' },
    ],
    counts: { all: 0, downloading: 0, paused: 0, succeeded: 0, failed: 0 },
    empty: true,
  })
  try {
    const rail = findCatalogElement(view.root, (node) => node.props['aria-label'] === '下载状态')
    const viewport = findCatalogElement(rail, (node) => typeof node.props.onScroll === 'function')
    const content = viewport.children[0]!
    const group = findCatalogElement(
      content,
      (node) => node.props.class === 'download-collection__status-options',
    )
    const buttons = group.children.filter((node) => node.tag === 'button')
    const scrollTo = vi.fn(({ left }: ScrollToOptions) => {
      viewport.scrollLeft = Math.min(left ?? 0, 238.75)
      dispatchCatalogEvent(viewport, 'onScroll', false)
    })
    Object.assign(rail, { clientWidth: 288 })
    Object.assign(viewport, {
      clientWidth: 240,
      scrollWidth: 480,
      scrollTo,
      getBoundingClientRect: () => ({ left: 12 }),
    })
    Object.assign(content, { scrollWidth: 480, querySelectorAll: () => buttons })
    buttons.forEach((button, index) => {
      Object.assign(button, {
        getBoundingClientRect: () => {
          const left = 12 + index * 96 - viewport.scrollLeft
          return { left, right: left + 96 }
        },
      })
    })

    const arrow = (label: string) =>
      findCatalogElement(rail, (node) => node.props['aria-label'] === label)
    dispatchCatalogEvent(viewport, 'onScroll', false)
    await nextTick()
    const forward = arrow('查看更多下载状态')
    dispatchCatalogEvent(forward, 'onClick', false)
    expect(scrollTo).toHaveBeenLastCalledWith({ left: 192, behavior: 'smooth' })
    dispatchCatalogEvent(forward, 'onClick', false)
    expect(scrollTo).toHaveBeenLastCalledWith({ left: 240, behavior: 'smooth' })
    await nextTick()

    const back = arrow('返回下载状态开头')
    expect(findCatalogElement(back, (node) => node.tag === 'path').props.d).toBe('M15 18l-6-6 6-6')
    dispatchCatalogEvent(back, 'onClick', false)
    expect(scrollTo).toHaveBeenLastCalledWith({ left: 0, behavior: 'smooth' })
    await nextTick()
    expect(arrow('查看更多下载状态')).toBe(forward)
    expect(buttons[0]?.props['aria-pressed']).toBe(true)
  } finally {
    view.unmount()
  }
})
