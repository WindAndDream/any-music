import { describe, expect, it, vi } from 'vitest'

import {
  installHostShortcutCaptureGuard,
  installKeyboardEventBoundary,
} from '@/platform/dom/keyboard-event-boundary'

const HOST_TAG_NAME = 'any-music-root'

describe('keyboard event boundary', () => {
  it.each(['keydown', 'keypress', 'keyup'])(
    'stops %s events at the Shadow Root boundary',
    (type) => {
      const target = new RecordingEventTarget()
      const stopPropagation = vi.fn()

      const uninstall = installKeyboardEventBoundary(target)
      target.emit(type, createKeyboardEvent({ stopPropagation }))

      expect(stopPropagation).toHaveBeenCalledOnce()

      uninstall()
      target.emit(type, createKeyboardEvent({ stopPropagation }))
      expect(stopPropagation).toHaveBeenCalledOnce()
    },
  )

  it.each(['KeyA', 'KeyD'])(
    'stops the known %s shortcut when the event path contains the production app host',
    (code) => {
      const target = new RecordingEventTarget()
      const stopImmediatePropagation = vi.fn()
      const preventDefault = vi.fn()

      installHostShortcutCaptureGuard(target, {
        hostTagName: HOST_TAG_NAME.toUpperCase(),
        shortcutCodes: new Set(['KeyA', 'KeyD']),
      })
      target.emit(
        'keydown',
        createKeyboardEvent({
          code,
          path: [{ localName: HOST_TAG_NAME } as unknown as EventTarget],
          preventDefault,
          stopImmediatePropagation,
        }),
      )

      expect(stopImmediatePropagation).toHaveBeenCalledOnce()
      expect(preventDefault).not.toHaveBeenCalled()
    },
  )

  it('leaves unrelated keys and events outside the production app unchanged', () => {
    const target = new RecordingEventTarget()
    const stopImmediatePropagation = vi.fn()
    const uninstall = installHostShortcutCaptureGuard(target, {
      hostTagName: HOST_TAG_NAME,
      shortcutCodes: new Set(['KeyA', 'KeyD']),
    })

    target.emit(
      'keydown',
      createKeyboardEvent({
        code: 'KeyS',
        path: [{ localName: HOST_TAG_NAME } as unknown as EventTarget],
        stopImmediatePropagation,
      }),
    )
    target.emit(
      'keydown',
      createKeyboardEvent({
        code: 'KeyA',
        path: [{ localName: 'main' } as unknown as EventTarget],
        stopImmediatePropagation,
      }),
    )

    expect(stopImmediatePropagation).not.toHaveBeenCalled()

    uninstall()
    target.emit(
      'keydown',
      createKeyboardEvent({
        code: 'KeyA',
        path: [{ localName: HOST_TAG_NAME } as unknown as EventTarget],
        stopImmediatePropagation,
      }),
    )
    expect(stopImmediatePropagation).not.toHaveBeenCalled()
  })
})

interface KeyboardEventOverrides {
  code?: string
  path?: EventTarget[]
  preventDefault?: () => void
  stopImmediatePropagation?: () => void
  stopPropagation?: () => void
}

function createKeyboardEvent(overrides: KeyboardEventOverrides = {}): Event {
  return {
    code: overrides.code ?? '',
    composedPath: () => overrides.path ?? [],
    preventDefault: overrides.preventDefault ?? vi.fn(),
    stopImmediatePropagation: overrides.stopImmediatePropagation ?? vi.fn(),
    stopPropagation: overrides.stopPropagation ?? vi.fn(),
  } as unknown as Event
}

/** 最小化模拟 DOM EventTarget，测试监听和清理而不引入浏览器环境。 */
class RecordingEventTarget {
  readonly #listeners = new Map<string, Set<EventListener>>()

  addEventListener(type: string, listener: EventListener): void {
    const listeners = this.#listeners.get(type) ?? new Set<EventListener>()
    listeners.add(listener)
    this.#listeners.set(type, listeners)
  }

  removeEventListener(type: string, listener: EventListener): void {
    this.#listeners.get(type)?.delete(listener)
  }

  emit(type: string, event: Event): void {
    for (const listener of this.#listeners.get(type) ?? []) listener(event)
  }
}
