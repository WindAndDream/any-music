import { afterEach, describe, expect, it, vi } from 'vitest'

import { writeClipboardText } from '../../src/product/clipboard'

afterEach(() => vi.unstubAllGlobals())

function createContainer(copied = true) {
  const textarea = {
    value: '',
    readOnly: false,
    style: { cssText: '' },
    focus: vi.fn(),
    select: vi.fn(),
    remove: vi.fn(),
  }
  const activeElement = { focus: vi.fn() }
  const execCommand = vi.fn(() => copied)
  const container = {
    isConnected: true,
    ownerDocument: { createElement: vi.fn(() => textarea), execCommand },
    getRootNode: () => ({ activeElement }),
    append: vi.fn(),
  } as unknown as HTMLElement
  return { container, textarea, activeElement, execCommand }
}

describe('writeClipboardText', () => {
  it('writes native clipboard text without creating a selection', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    const { container, execCommand } = createContainer()
    await writeClipboardText('{"name":"音乐"}', container)
    expect(writeText).toHaveBeenCalledExactlyOnceWith('{"name":"音乐"}')
    expect(execCommand).not.toHaveBeenCalled()
  })

  it.each(['absent', 'rejected'] as const)(
    'falls back within the active Shadow dialog when clipboard is %s',
    async (kind) => {
      vi.stubGlobal(
        'navigator',
        kind === 'absent'
          ? {}
          : { clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) } },
      )
      const { container, textarea, activeElement, execCommand } = createContainer()
      await writeClipboardText('完整 JSON', container)
      expect(textarea.value).toBe('完整 JSON')
      expect(container.append).toHaveBeenCalledExactlyOnceWith(textarea)
      expect(execCommand).toHaveBeenCalledExactlyOnceWith('copy')
      expect(textarea.remove).toHaveBeenCalledOnce()
      expect(activeElement.focus).toHaveBeenCalledExactlyOnceWith({ preventScroll: true })
    },
  )

  it('reports copy failure and restores focus even when selection copy fails', async () => {
    vi.stubGlobal('navigator', {})
    const { container, textarea, activeElement } = createContainer(false)
    await expect(writeClipboardText('JSON', container)).rejects.toThrow()
    expect(textarea.remove).toHaveBeenCalledOnce()
    expect(activeElement.focus).toHaveBeenCalledOnce()
  })

  it('does not move focus into a dialog closed while native clipboard was pending', async () => {
    let reject!: (error: Error) => void
    vi.stubGlobal('navigator', {
      clipboard: {
        writeText: () =>
          new Promise<void>((_resolve, rejectPromise) => {
            reject = rejectPromise
          }),
      },
    })
    const { container, execCommand, textarea } = createContainer()
    const pending = writeClipboardText('JSON', container)
    Object.assign(container, { isConnected: false })
    reject(new Error('denied'))
    await expect(pending).rejects.toThrow('closed')
    expect(execCommand).not.toHaveBeenCalled()
    expect(textarea.focus).not.toHaveBeenCalled()
  })
})
