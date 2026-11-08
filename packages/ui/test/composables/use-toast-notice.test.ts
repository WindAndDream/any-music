import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope } from 'vue'

import { useToastNotice } from '../../src/composables/use-toast-notice'

const scopes: ReturnType<typeof effectScope>[] = []
beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  scopes.splice(0).forEach((scope) => scope.stop())
  vi.useRealTimers()
})
function createNotice() {
  const scope = effectScope()
  scopes.push(scope)
  return { notice: scope.run(() => useToastNotice())!, scope }
}

describe('useToastNotice', () => {
  it('pauses for copying, resumes the remaining duration and retains the playback cooldown', () => {
    const { notice } = createNotice()
    notice.show('播放失败：详细错误')
    vi.advanceTimersByTime(1800)
    notice.setPaused(true)
    notice.setPaused(true)
    vi.advanceTimersByTime(10000)
    expect(notice.message.value).toBe('播放失败：详细错误')
    expect(notice.show('其他提示')).toBe(false)
    notice.setPaused(false)
    vi.advanceTimersByTime(200)
    notice.setPaused(false)
    vi.advanceTimersByTime(199)
    expect(notice.message.value).toBe('播放失败：详细错误')
    vi.advanceTimersByTime(1)
    expect(notice.message.value).toBeUndefined()
    expect(notice.show('冷却中')).toBe(false)
    vi.advanceTimersByTime(840)
    expect(notice.show('新的提示')).toBe(true)
  })

  it('does not revive a dismissed or disposed notice when a paused presentation releases it', () => {
    const { notice, scope } = createNotice()
    notice.show('旧提示')
    notice.setPaused(true)
    notice.dismiss()
    notice.setPaused(false)
    vi.advanceTimersByTime(10000)
    expect(notice.message.value).toBeUndefined()
    expect(vi.getTimerCount()).toBe(0)
    expect(notice.show('新提示')).toBe(true)
    notice.setPaused(true)
    scope.stop()
    notice.setPaused(false)
    expect(notice.message.value).toBeUndefined()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('does not stack, queue or extend notices during repeated clicks, exit and cooldown', () => {
    const { notice } = createNotice()
    expect(notice.show('正在播放')).toBe(true)
    vi.advanceTimersByTime(2000)
    expect(notice.show('再次点击')).toBe(false)
    expect(notice.message.value).toBe('正在播放')
    vi.advanceTimersByTime(200)
    expect(notice.message.value).toBeUndefined()
    expect(notice.show('退场中')).toBe(false)
    vi.advanceTimersByTime(839)
    expect(notice.show('冷却中')).toBe(false)
    vi.advanceTimersByTime(1)
    expect(notice.message.value).toBeUndefined()
    expect(notice.show('新的提示')).toBe(true)
  })

  it('ignores empty text and disposes pending display or cooldown timers', () => {
    for (const elapsed of [100, 2400]) {
      const { notice, scope } = createNotice()
      expect(notice.show('  ')).toBe(false)
      expect(notice.show('提示')).toBe(true)
      vi.advanceTimersByTime(elapsed)
      scope.stop()
      expect(vi.getTimerCount()).toBe(0)
      expect(notice.message.value).toBeUndefined()
      expect(notice.show('卸载后')).toBe(false)
    }
  })
})
