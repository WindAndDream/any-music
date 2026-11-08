import { onScopeDispose } from 'vue'

interface UsePointerGestureGuardOptions {
  finish: (event: PointerEvent) => void
  cancel: () => void
}

/** Keeps an active gesture bounded even when its control misses the terminal pointer event. */
export function usePointerGestureGuard(options: UsePointerGestureGuardOptions) {
  let pointerId: number | undefined
  let gestureWindow: Window | undefined
  let gestureDocument: Document | undefined

  function stop(): void {
    pointerId = undefined
    gestureWindow?.removeEventListener('pointerup', finish, true)
    gestureWindow?.removeEventListener('pointercancel', cancelPointer, true)
    gestureWindow?.removeEventListener('pointermove', checkButtons, true)
    gestureWindow?.removeEventListener('blur', cancel)
    gestureWindow?.removeEventListener('keydown', handleKeydown, true)
    gestureDocument?.removeEventListener('visibilitychange', handleVisibilityChange)
    gestureWindow = undefined
    gestureDocument = undefined
  }

  function cancel(): void {
    stop()
    options.cancel()
  }

  function finish(event: PointerEvent): void {
    if (event.pointerId !== pointerId) return
    stop()
    options.finish(event)
  }

  function cancelPointer(event: PointerEvent): void {
    if (event.pointerId === pointerId) cancel()
  }

  function checkButtons(event: PointerEvent): void {
    // A release outside the window may produce no pointerup here. Hovering back must not drag.
    if (
      event.pointerId === pointerId &&
      (event.pointerType === 'mouse' || event.pointerType === 'pen') &&
      (event.buttons & 1) === 0
    )
      cancel()
  }

  function handleKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Escape') return
    event.stopPropagation()
    cancel()
  }

  function handleVisibilityChange(): void {
    if (gestureDocument?.visibilityState === 'hidden') cancel()
  }

  function start(event: PointerEvent): void {
    stop()
    pointerId = event.pointerId
    gestureWindow = typeof window !== 'undefined' ? window : undefined
    gestureDocument = typeof document !== 'undefined' ? document : undefined
    gestureWindow?.addEventListener('pointerup', finish, true)
    gestureWindow?.addEventListener('pointercancel', cancelPointer, true)
    gestureWindow?.addEventListener('pointermove', checkButtons, true)
    gestureWindow?.addEventListener('blur', cancel)
    gestureWindow?.addEventListener('keydown', handleKeydown, true)
    gestureDocument?.addEventListener('visibilitychange', handleVisibilityChange)
  }

  onScopeDispose(stop)
  return { start, stop }
}
