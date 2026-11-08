const KEYBOARD_EVENT_TYPES = ['keydown', 'keypress', 'keyup'] as const

interface KeyboardEventTarget {
  addEventListener(
    type: string,
    listener: EventListener,
    options?: boolean | AddEventListenerOptions,
  ): void
  removeEventListener(
    type: string,
    listener: EventListener,
    options?: boolean | EventListenerOptions,
  ): void
}

export interface HostShortcutCaptureGuardOptions {
  hostTagName: string
  shortcutCodes: ReadonlySet<string>
}

function stopKeyboardEventAtBoundary(event: Event): void {
  event.stopPropagation()
}

/** 允许应用先消费键盘事件，再阻止组合事件继续冒泡到宿主页快捷键。 */
export function installKeyboardEventBoundary(target: KeyboardEventTarget): () => void {
  for (const type of KEYBOARD_EVENT_TYPES)
    target.addEventListener(type, stopKeyboardEventAtBoundary)

  return () => {
    for (const type of KEYBOARD_EVENT_TYPES) {
      target.removeEventListener(type, stopKeyboardEventAtBoundary)
    }
  }
}

/**
 * 在 document-start 截断宿主页捕获阶段的已知冲突快捷键。
 * 仅匹配来自正式 Shadow Host 的事件，不影响页面自身输入和快捷键。
 */
export function installHostShortcutCaptureGuard(
  target: KeyboardEventTarget,
  options: HostShortcutCaptureGuardOptions,
): () => void {
  const normalizedHostTagName = options.hostTagName.toLowerCase()
  const stopConflictingShortcut: EventListener = (event) => {
    const keyboardEvent = event as KeyboardEvent
    if (!options.shortcutCodes.has(keyboardEvent.code)) return
    if (!event.composedPath().some((node) => hasLocalName(node, normalizedHostTagName))) return
    event.stopImmediatePropagation()
  }

  for (const type of KEYBOARD_EVENT_TYPES) {
    target.addEventListener(type, stopConflictingShortcut, { capture: true })
  }

  return () => {
    for (const type of KEYBOARD_EVENT_TYPES) {
      target.removeEventListener(type, stopConflictingShortcut, { capture: true })
    }
  }
}

function hasLocalName(target: EventTarget, expectedLocalName: string): boolean {
  return (
    'localName' in target &&
    typeof target.localName === 'string' &&
    target.localName.toLowerCase() === expectedLocalName
  )
}
