import { createAppErrorState } from '@any-music/core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'

import {
  provideSettingsFeedback,
  useSettingsFeedback,
} from '../../src/composables/use-settings-feedback'
import { mountCatalogComponent } from '../components/music-sources/catalog-test-renderer'

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

function mountFeedback() {
  let feedback!: ReturnType<typeof provideSettingsFeedback>
  let show!: ReturnType<typeof useSettingsFeedback>
  const consumer = defineComponent({
    setup() {
      show = useSettingsFeedback()
      return () => h('div')
    },
  })
  const view = mountCatalogComponent(
    defineComponent({
      setup() {
        feedback = provideSettingsFeedback()
        return () => h(consumer)
      },
    }),
    {},
  )
  return { ...view, feedback, show }
}

describe('settings feedback', () => {
  it('immediately replaces a success with a failure and restarts the lifetime on every save', () => {
    const view = mountFeedback()
    view.show({ status: 'success', message: '设置已保存。' })
    const firstId = view.feedback.notice.value!.id
    vi.advanceTimersByTime(2500)
    const error = createAppErrorState('storage-write-failed', '设置保存失败，请重试。')
    view.show({ status: 'error', error })
    expect(view.feedback.notice.value).toMatchObject({ tone: 'error' })
    expect(view.feedback.notice.value!.message).toContain('设置保存失败，请重试。')
    expect(view.feedback.notice.value!.id).toBeGreaterThan(firstId)
    vi.advanceTimersByTime(4999)
    expect(view.feedback.notice.value).toBeDefined()
    view.show({ status: 'success', message: '设置已保存。' })
    vi.advanceTimersByTime(2999)
    expect(view.feedback.notice.value?.tone).toBe('success')
    vi.advanceTimersByTime(1)
    expect(view.feedback.notice.value).toBeUndefined()
    view.unmount()
  })

  it('cleans up pending feedback when the product scope unmounts', () => {
    const view = mountFeedback()
    view.show({ status: 'success', message: '设置已保存。' })
    view.unmount()
    view.show({ status: 'success', message: '卸载后不能显示。' })
    expect(view.feedback.notice.value).toBeUndefined()
    expect(vi.getTimerCount()).toBe(0)
  })
})
