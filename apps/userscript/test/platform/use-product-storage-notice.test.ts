import { describe, expect, it } from 'vitest'
import { effectScope } from 'vue'

import { useProductStorageNotice } from '../../src/platform/use-product-storage-notice'

describe('product persistence failure notice', () => {
  it('retains a serializable storage error and a visible reload instruction', () => {
    const target = new EventTarget()
    const scope = effectScope()
    const notice = scope.run(() => useProductStorageNotice(target))!
    expect(notice.message.value).toBeUndefined()
    target.dispatchEvent(new Event('any-music:storage-error'))
    expect(notice.error.value).toMatchObject({ code: 'storage-write-failed', category: 'storage' })
    expect(notice.message.value).toContain('已停止后续保存')
    expect(notice.message.value).toContain('重新加载')
    expect(JSON.parse(JSON.stringify(notice.error.value))).toEqual(notice.error.value)
    scope.stop()
  })

  it('withdraws the notice and removes the listener on actual disposal', () => {
    const target = new EventTarget()
    const scope = effectScope()
    const notice = scope.run(() => useProductStorageNotice(target))!
    target.dispatchEvent(new Event('any-music:storage-error'))
    expect(notice.message.value).toBeDefined()
    scope.stop()
    expect(notice.message.value).toBeUndefined()
    target.dispatchEvent(new Event('any-music:storage-error'))
    expect(notice.message.value).toBeUndefined()
  })
})
