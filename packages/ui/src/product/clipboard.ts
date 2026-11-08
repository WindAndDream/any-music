/** 浏览器剪贴板优先；非安全宿主页或权限受限时，在当前弹层内借用原生选择复制。 */
export async function writeClipboardText(text: string, container: HTMLElement): Promise<void> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return
    }
  } catch {
    // Userscript 的宿主页可能不开放 Clipboard API；仍可尝试用户点击触发的传统复制。
  }

  if (!container.isConnected) throw new Error('Clipboard dialog was closed')
  const document = container.ownerDocument
  const root = container.getRootNode() as Document | ShadowRoot
  const activeElement = root.activeElement as HTMLElement | null
  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.readOnly = true
  textarea.style.cssText = 'position:fixed;inset:0;inline-size:1px;block-size:1px;opacity:0;'
  container.append(textarea)
  try {
    textarea.focus({ preventScroll: true })
    textarea.select()
    if (!document.execCommand?.('copy')) throw new Error('Clipboard copy was unavailable')
  } finally {
    textarea.remove()
    activeElement?.focus({ preventScroll: true })
  }
}
