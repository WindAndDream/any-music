import { createAppErrorState } from '@any-music/core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'

import { provideActionFeedback, useActionFeedback } from '../../src/composables/use-action-feedback'
import { useSettingsFeedback } from '../../src/composables/use-settings-feedback'
import { getActionSuccessMessage } from '../../src/product/action-feedback'
import { mountCatalogComponent } from '../components/music-sources/catalog-test-renderer'

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('shared operation feedback', () => {
  it('reuses the top notice for configurable unavailability reasons and clears it on disposal', () => {
    let feedback!: ReturnType<typeof provideActionFeedback>
    const view = mountCatalogComponent(
      defineComponent({
        setup() {
          feedback = provideActionFeedback()
          return () => h('div')
        },
      }),
      {},
    )
    expect(feedback.showUnavailable()).toBe(false)
    expect(feedback.notice.value).toBeUndefined()
    expect(feedback.showUnavailable('片段创作正在开发中。')).toBe(true)
    expect(feedback.notice.value).toMatchObject({ tone: 'info', message: '片段创作正在开发中。' })
    feedback.showUnavailable('工作室主题正在开发中。')
    expect(feedback.notice.value?.message).toBe('工作室主题正在开发中。')
    vi.advanceTimersByTime(3000)
    expect(feedback.notice.value).toBeUndefined()
    feedback.showUnavailable('其他插件暂时不可用。')
    view.unmount()
    expect(feedback.notice.value).toBeUndefined()
    expect(vi.getTimerCount()).toBe(0)
  })
  it('keeps replacements paused and starts their full duration only after interaction ends', () => {
    let feedback!: ReturnType<typeof provideActionFeedback>
    const view = mountCatalogComponent(
      defineComponent({
        setup() {
          feedback = provideActionFeedback()
          return () => h('div')
        },
      }),
      {},
    )
    try {
      feedback.show({ status: 'success', message: '已保存' })
      vi.advanceTimersByTime(2000)
      feedback.setPaused(true)
      feedback.show({ status: 'error', message: '保存失败：错误详情' })
      vi.advanceTimersByTime(10000)
      expect(feedback.notice.value?.message).toBe('保存失败：错误详情')
      feedback.setPaused(false)
      vi.advanceTimersByTime(4999)
      expect(feedback.notice.value?.tone).toBe('error')
      vi.advanceTimersByTime(1)
      expect(feedback.notice.value).toBeUndefined()
      feedback.show({ status: 'info', message: '新提示' })
      feedback.setPaused(true)
      feedback.dismiss()
      feedback.setPaused(false)
      expect(feedback.notice.value).toBeUndefined()
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      view.unmount()
    }
  })

  it('replaces repeated status notices on every click and dismisses the latest notice automatically', () => {
    let feedback!: ReturnType<typeof provideActionFeedback>
    const view = mountCatalogComponent(
      defineComponent({
        setup() {
          feedback = provideActionFeedback()
          return () => h('div')
        },
      }),
      {},
    )
    const message = '第一首歌 · 歌曲下载中'
    feedback.show({ status: 'info', icon: 'download', message })
    const firstId = feedback.notice.value!.id
    expect(feedback.notice.value?.tone).toBe('info')
    expect(feedback.notice.value?.icon).toBe('download')
    vi.advanceTimersByTime(2000)
    feedback.show({ status: 'info', message })
    expect(feedback.notice.value?.id).toBeGreaterThan(firstId)
    vi.advanceTimersByTime(1000)
    expect(feedback.notice.value?.message).toBe(message)
    vi.advanceTimersByTime(2000)
    expect(feedback.notice.value).toBeUndefined()
    feedback.show({ status: 'error', message: '第一首歌 · 歌曲下载失败：保存失败。' })
    expect(feedback.notice.value?.tone).toBe('error')
    expect(feedback.notice.value?.message).toContain('保存失败。')
    vi.advanceTimersByTime(5000)
    expect(feedback.notice.value).toBeUndefined()
    feedback.show({ status: 'warning', icon: 'pause', message: '第一首歌 · 下载暂停中' })
    expect(feedback.notice.value?.tone).toBe('warning')
    expect(feedback.notice.value?.icon).toBe('pause')
    vi.advanceTimersByTime(3000)
    expect(feedback.notice.value).toBeUndefined()
    feedback.show({ status: 'neutral', icon: 'close', message: '第一首歌 · 下载已取消' })
    expect(feedback.notice.value?.tone).toBe('neutral')
    vi.advanceTimersByTime(3000)
    expect(feedback.notice.value).toBeUndefined()
    feedback.show({ status: 'info', message })
    expect(feedback.notice.value?.icon).toBeUndefined()
    view.unmount()
    expect(feedback.notice.value).toBeUndefined()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('shares one result slot across settings and actions and reports an immediate failure with its action label', () => {
    let feedback!: ReturnType<typeof provideActionFeedback>
    let showSettings!: ReturnType<typeof useSettingsFeedback>
    let showAction!: ReturnType<typeof useActionFeedback>
    const consumer = defineComponent({
      setup() {
        showSettings = useSettingsFeedback()
        showAction = useActionFeedback()
        return () => h('div')
      },
    })
    const view = mountCatalogComponent(
      defineComponent({
        setup() {
          feedback = provideActionFeedback()
          return () => h(consumer)
        },
      }),
      {},
    )
    showSettings({ status: 'success', message: getActionSuccessMessage('profile') })
    const firstId = feedback.notice.value!.id
    showAction({
      status: 'error',
      action: 'trackRestore',
      error: createAppErrorState('storage-write-failed', '保存失败，请重试。'),
    })
    expect(feedback.notice.value?.message).toContain('恢复歌曲原名失败：')
    expect(feedback.notice.value?.message).toContain('保存失败，请重试。')
    expect(feedback.notice.value!.id).toBeGreaterThan(firstId)
    vi.advanceTimersByTime(4999)
    expect(feedback.notice.value?.tone).toBe('error')
    vi.advanceTimersByTime(1)
    expect(feedback.notice.value).toBeUndefined()
    view.unmount()
  })
})
