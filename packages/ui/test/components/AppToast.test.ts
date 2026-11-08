import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSSRApp, defineComponent, h, nextTick } from 'vue'
import { renderToString } from 'vue/server-renderer'

import type { AppIconName } from '../../src/components/app-icon'
import { appIconPaths } from '../../src/components/app-icon'
import AppToast from '../../src/components/AppToast.vue'
import { provideActionFeedback } from '../../src/composables/use-action-feedback'
import type { ActionFeedbackTone } from '../../src/product/action-feedback'
import {
  dispatchCatalogEvent,
  findCatalogElement,
  mountCatalogComponent,
} from './music-sources/catalog-test-renderer'

vi.mock('vue', async (load) => {
  const vue = await load<typeof import('vue')>()
  return {
    ...vue,
    Transition: vue.defineComponent({
      inheritAttrs: false,
      setup:
        (_, { slots }) =>
        () =>
          slots.default?.(),
    }),
  }
})

afterEach(() => vi.useRealTimers())

function renderToast(
  tone?: ActionFeedbackTone,
  icon?: AppIconName,
  message = '第一首歌 · 当前状态',
) {
  return renderToString(createSSRApp({ render: () => h(AppToast, { tone, icon, message }) }))
}

describe('AppToast', () => {
  it('keeps error text visible while hovered or focused and resumes the remaining time', async () => {
    vi.useFakeTimers()
    let feedback!: ReturnType<typeof provideActionFeedback>
    const view = mountCatalogComponent(
      defineComponent({
        setup() {
          feedback = provideActionFeedback()
          return () =>
            h(AppToast, {
              message: feedback.notice.value?.message,
              tone: feedback.notice.value?.tone,
              onPauseChange: feedback.setPaused,
            })
        },
      }),
      {},
    )
    try {
      const message = '请求失败：AM-1005 <原始错误>\n第二行详情'
      feedback.show({ status: 'error', message })
      await nextTick()
      const toast = findCatalogElement(view.root, (node) => node.props.role === 'alert')
      expect(toast.textContent).toBe(message)
      vi.advanceTimersByTime(4000)
      dispatchCatalogEvent(toast, 'onMouseenter', false)
      vi.advanceTimersByTime(10000)
      expect(feedback.notice.value?.message).toBe(message)
      dispatchCatalogEvent(toast, 'onFocusin')
      dispatchCatalogEvent(toast, 'onMouseleave', false)
      vi.advanceTimersByTime(10000)
      expect(feedback.notice.value?.message).toBe(message)
      dispatchCatalogEvent(toast, 'onFocusout')
      vi.advanceTimersByTime(999)
      expect(feedback.notice.value?.message).toBe(message)
      vi.advanceTimersByTime(1)
      await nextTick()
      expect(toast.textContent).not.toContain(message)
      expect(feedback.notice.value).toBeUndefined()
    } finally {
      view.unmount()
    }
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each([
    ['success', 'check'],
    ['error', 'warning'],
    ['warning', 'warning'],
    ['info', 'info'],
    ['neutral', 'close'],
  ] as const)('renders a %s notice with its default state icon', async (tone, icon) => {
    const html = await renderToast(tone)
    expect(html).toContain(`data-tone="${tone}"`)
    expect(html).toContain(`d="${appIconPaths[icon][0]}"`)
    expect(html).toContain('aria-hidden="true"')
    expect(html).toContain(`role="${tone === 'error' ? 'alert' : 'status'}"`)
    expect(html).toContain(`aria-live="${tone === 'error' ? 'assertive' : 'polite'}"`)
    expect(html).toContain('第一首歌 · 当前状态')
  })

  it.each([
    ['info', 'download'],
    ['warning', 'pause'],
  ] as const)(
    'uses the %s state icon instead of implying successful completion',
    async (tone, icon) => {
      const html = await renderToast(tone, icon)
      expect(html).toContain(`d="${appIconPaths[icon][0]}"`)
      expect(html).not.toContain(`d="${appIconPaths.check[0]}"`)
    },
  )

  it('preserves plain playback notices and removes content when dismissed', async () => {
    const plain = await renderToast()
    expect(plain).not.toContain('data-tone=')
    expect(plain).not.toContain('<svg')
    const empty = await renderToast('success', 'check', '')
    expect(empty).not.toContain('app-toast__message')
    expect(empty).not.toContain('<svg')
  })
})
