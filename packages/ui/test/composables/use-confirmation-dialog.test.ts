import { afterEach, describe, expect, it, vi } from 'vitest'

import { createConfirmationDialogController } from '../../src/composables/use-confirmation-dialog'

describe('confirmation dialog controller', () => {
  it('keeps structured consequences separate from the question and snapshots their text', async () => {
    const controller = createConfirmationDialogController()
    const details = [{ label: '会保留', text: '歌曲与账号名称历史' }]
    const result = controller.confirm({ title: '删除账号', message: '确认删除“99”？', details })
    details[0]!.text = 'changed'
    expect(controller.activeRequest.value?.details).toEqual([
      { label: '会保留', text: '歌曲与账号名称历史' },
    ])
    controller.cancel()
    await expect(result).resolves.toBe(false)
  })
  afterEach(() => vi.unstubAllGlobals())

  it('normalizes a request and resolves it from the visible dialog action', async () => {
    const controller = createConfirmationDialogController()
    const result = controller.confirm({
      title: '删除歌单',
      message: '确定删除吗？',
      tone: 'danger',
    })

    expect(controller.activeRequest.value).toMatchObject({
      title: '删除歌单',
      message: '确定删除吗？',
      confirmLabel: '确认',
      cancelLabel: '取消',
      tone: 'danger',
    })

    controller.accept()

    await expect(result).resolves.toBe(true)
    expect(controller.activeRequest.value).toBeUndefined()
  })

  it('rejects a second request while one is visible to prevent stale destructive actions', async () => {
    const controller = createConfirmationDialogController()
    const firstResult = controller.confirm({ title: '第一项', message: '第一项说明' })

    await expect(controller.confirm({ title: '第二项', message: '第二项说明' })).resolves.toBe(
      false,
    )
    expect(controller.activeRequest.value?.title).toBe('第一项')

    controller.cancel()
    await expect(firstResult).resolves.toBe(false)
  })

  it('cancels the pending promise during scope disposal and stays closed afterwards', async () => {
    const controller = createConfirmationDialogController()
    const pendingResult = controller.confirm({ title: '离开页面', message: '尚未选择' })

    controller.dispose()

    await expect(pendingResult).resolves.toBe(false)
    await expect(controller.confirm({ title: '已卸载', message: '不应重新打开' })).resolves.toBe(
      false,
    )
    expect(controller.activeRequest.value).toBeUndefined()
  })

  it('captures the focused control through a Shadow Root before opening', async () => {
    class TestHtmlElement {
      readonly shadowRoot?: { activeElement: TestHtmlElement }

      constructor(shadowRoot?: { activeElement: TestHtmlElement }) {
        this.shadowRoot = shadowRoot
      }
    }

    const trigger = new TestHtmlElement()
    const host = new TestHtmlElement({ activeElement: trigger })
    vi.stubGlobal('HTMLElement', TestHtmlElement)
    vi.stubGlobal('document', { activeElement: host })

    const controller = createConfirmationDialogController()
    const result = controller.confirm({ title: '清空播放历史', message: '确认清空吗？' })

    expect(controller.activeRequest.value?.returnFocusTarget).toBe(trigger)
    controller.cancel()
    await expect(result).resolves.toBe(false)
  })
})
