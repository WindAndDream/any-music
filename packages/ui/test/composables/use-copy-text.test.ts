import { afterEach, describe, expect, it, vi } from 'vitest'
import { effectScope, shallowRef } from 'vue'

import { useCopyText } from '../../src/composables/use-copy-text'
import { writeClipboardText } from '../../src/product/clipboard'

vi.mock('../../src/product/clipboard', () => ({ writeClipboardText: vi.fn() }))
const scopes: ReturnType<typeof effectScope>[] = []
afterEach(() => {
  scopes.splice(0).forEach((scope) => scope.stop())
  vi.resetAllMocks()
})

function createCopy() {
  const context = shallowRef<string | undefined>('drawer:1')
  const enabled = shallowRef(true)
  const getText = vi.fn(() => '{"id":"drawer:1"}')
  const scope = effectScope()
  scopes.push(scope)
  const copy = scope.run(() =>
    useCopyText({
      context,
      enabled,
      getText,
      container: () => ({}) as HTMLElement,
      successMessage: '已复制。',
    }),
  )!
  return { ...copy, context, enabled, getText, scope }
}

describe('useCopyText', () => {
  it('serializes only on click and reuses a pending copy', async () => {
    let finish!: () => void
    vi.mocked(writeClipboardText).mockReturnValue(
      new Promise<void>((resolve) => {
        finish = resolve
      }),
    )
    const copy = createCopy()
    expect(copy.getText).not.toHaveBeenCalled()
    const pending = copy.copy()
    await copy.copy()
    expect(copy.isCopying.value).toBe(true)
    expect(copy.getText).toHaveBeenCalledOnce()
    expect(writeClipboardText).toHaveBeenCalledOnce()
    finish()
    await pending
    expect(copy.isCopying.value).toBe(false)
    expect(copy.feedback.value?.status).toBe('success')
  })

  it.each(['close', 'switch', 'dispose'] as const)(
    'ignores a late result after %s',
    async (action) => {
      let finish!: () => void
      vi.mocked(writeClipboardText).mockReturnValue(
        new Promise<void>((resolve) => {
          finish = resolve
        }),
      )
      const copy = createCopy()
      const pending = copy.copy()
      if (action === 'close') copy.context.value = undefined
      if (action === 'switch') copy.context.value = 'drawer:2'
      if (action === 'dispose') copy.scope.stop()
      finish()
      await pending
      expect(copy.feedback.value).toBeUndefined()
    },
  )

  it('allows retry after failure and blocks a suspended dialog', async () => {
    vi.mocked(writeClipboardText).mockRejectedValueOnce(new Error('permission denied'))
    const copy = createCopy()
    await copy.copy()
    expect(copy.isCopying.value).toBe(false)
    expect(copy.feedback.value).toMatchObject({
      status: 'error',
      message: expect.stringContaining('复制失败'),
    })
    copy.enabled.value = false
    await copy.copy()
    expect(writeClipboardText).toHaveBeenCalledOnce()
    copy.enabled.value = true
    vi.mocked(writeClipboardText).mockResolvedValueOnce()
    await copy.copy()
    expect(copy.feedback.value?.status).toBe('success')
  })
})
