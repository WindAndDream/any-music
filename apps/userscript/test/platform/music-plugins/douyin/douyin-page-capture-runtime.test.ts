import { beforeEach, describe, expect, it, vi } from 'vitest'

const gmMocks = vi.hoisted(() => ({
  addValueChangeListener: vi.fn(),
  deleteValue: vi.fn(),
  openInTab: vi.fn(),
  removeValueChangeListener: vi.fn(),
  setValue: vi.fn(),
}))

vi.mock('$', () => ({
  GM_addValueChangeListener: gmMocks.addValueChangeListener,
  GM_deleteValue: gmMocks.deleteValue,
  GM_openInTab: gmMocks.openInTab,
  GM_removeValueChangeListener: gmMocks.removeValueChangeListener,
  GM_setValue: gmMocks.setValue,
  unsafeWindow: { location: { href: 'https://example.com/' } },
}))

import {
  createDouyinPageBridgeFailure,
  createDouyinPageBridgeSuccess,
  parseDouyinPageBridgeTask,
} from '@/platform/music-plugins/douyin/douyin-page-bridge'
import type { DouyinPageBridgeMessage } from '@/platform/music-plugins/douyin/douyin-page-bridge'
import { douyinProtectedPageSource } from '@/platform/music-plugins/douyin/douyin-page-capture-runtime'

describe('Douyin page-fallback runtime', () => {
  let receiveMessage: (name: string, oldValue: unknown, newValue: unknown) => void
  let tab: { closed: boolean; close: ReturnType<typeof vi.fn>; onclose?: () => void }

  beforeEach(() => {
    vi.clearAllMocks()
    gmMocks.addValueChangeListener.mockImplementation((_key, listener) => {
      receiveMessage = listener
      return 7
    })
    tab = { closed: false, close: vi.fn() }
    gmMocks.openInTab.mockReturnValue(tab)
  })

  it('opens the fallback page in the background and closes it only after success', async () => {
    const result = douyinProtectedPageSource.getCapturedAwemePage('self-favorites', 18)
    await vi.waitFor(() => expect(gmMocks.openInTab).toHaveBeenCalledOnce())
    const [url, options] = gmMocks.openInTab.mock.calls[0]!
    const task = parseDouyinPageBridgeTask(String(url))!

    expect(options).toMatchObject({ active: false, insert: true, setParent: true })
    receiveMessage(
      'result',
      undefined,
      createDouyinPageBridgeSuccess(task, {
        aweme_list: [{ aweme_id: 'liked-after-verification' }],
        has_more: 0,
      }),
    )

    await expect(result).resolves.toMatchObject({
      aweme_list: [{ aweme_id: 'liked-after-verification' }],
    })
    expect(tab.close).toHaveBeenCalledOnce()
  })

  it('keeps the background tab open when manual verification remains unavailable', async () => {
    const result = douyinProtectedPageSource.getCapturedAwemePage('self-collected-videos', 0)
    await vi.waitFor(() => expect(gmMocks.openInTab).toHaveBeenCalledOnce())
    const task = parseDouyinPageBridgeTask(String(gmMocks.openInTab.mock.calls[0]?.[0]))!
    const failure: DouyinPageBridgeMessage = createDouyinPageBridgeFailure(
      task,
      'verification-required',
    )

    receiveMessage('result', undefined, failure)

    await expect(result).rejects.toThrow('安全验证尚未完成')
    expect(tab.close).not.toHaveBeenCalled()
  })
})
