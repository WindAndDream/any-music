import { onScopeDispose, toValue } from 'vue'
import type { MaybeRefOrGetter } from 'vue'

import { usePointerGestureGuard } from './use-pointer-gesture-guard'

interface UseLongPressDragOptions {
  target: MaybeRefOrGetter<HTMLElement | null>
  startDrag: (event: PointerEvent, id: string) => void
  cancelDrag: () => void
}

const HOLD_DELAY_MS = 500
const MOVE_TOLERANCE_PX = 8

/** 短按保留原有操作，长按才交给网格；等待期间不占用原生滚动和指针捕获。 */
export function useLongPressDrag(options: UseLongPressDragOptions) {
  let press: { event: PointerEvent; element: HTMLElement; activated: boolean } | undefined
  let holdTimer: ReturnType<typeof setTimeout> | undefined
  let clickTimer: ReturnType<typeof setTimeout> | undefined
  let clickTarget: HTMLElement | undefined
  const gestureGuard = usePointerGestureGuard({ finish: finishPress, cancel })

  function clearClickGuard(): void {
    if (!clickTarget) return
    clearTimeout(clickTimer)
    clickTimer = undefined
    clickTarget?.removeEventListener('click', suppressClick, { capture: true })
    clickTarget = undefined
    window.removeEventListener('pointerdown', clearClickGuard, { capture: true })
  }

  function suppressClick(event: MouseEvent): void {
    // 保留辅助技术和键盘激活；松手后的指针点击不能触发起点或落点的操作。
    if (event.detail === 0) return
    event.preventDefault()
    event.stopImmediatePropagation()
    clearClickGuard()
  }

  function finishPress(): void {
    if (!press) return
    gestureGuard.stop()
    clearTimeout(holdTimer)
    holdTimer = undefined
    press?.element.removeEventListener('touchmove', handleTouchMove)
    press = undefined
    window.removeEventListener('pointermove', handleMove, { capture: true })
    window.removeEventListener('pointerdown', handleAdditionalPointer, { capture: true })
    window.removeEventListener('scroll', handleScroll, { capture: true })
    window.removeEventListener('resize', cancel)
    if (clickTarget) clickTimer = setTimeout(clearClickGuard, 800)
  }

  function cancel(): void {
    const wasActivated = press?.activated
    finishPress()
    if (wasActivated) options.cancelDrag()
  }

  function handleMove(event: PointerEvent): void {
    if (!press || event.pointerId !== press.event.pointerId || press.activated) return
    if (
      Math.hypot(event.clientX - press.event.clientX, event.clientY - press.event.clientY) >
      MOVE_TOLERANCE_PX
    )
      cancel()
  }

  function handleTouchMove(event: TouchEvent): void {
    if (event.touches.length > 1) cancel()
    // touch-action 在手势开始后修改无效；仅长按成功后取消原生 touchmove 的滚动。
    if (press?.activated && event.cancelable) event.preventDefault()
  }

  function handleAdditionalPointer(event: PointerEvent): void {
    if (press && event.pointerId !== press.event.pointerId) cancel()
  }

  function handleScroll(): void {
    if (!press?.activated) cancel()
  }

  function start(event: PointerEvent, id: string): void {
    if (press || event.button !== 0 || event.isPrimary === false) return
    const element = event.currentTarget as HTMLElement | null
    const target = toValue(options.target)
    if (!element || !target) return
    clearClickGuard()
    press = { event, element, activated: false }
    gestureGuard.start(event)
    window.addEventListener('pointermove', handleMove, { capture: true })
    window.addEventListener('pointerdown', handleAdditionalPointer, { capture: true })
    window.addEventListener('scroll', handleScroll, { capture: true })
    window.addEventListener('resize', cancel)
    element.addEventListener('touchmove', handleTouchMove, { passive: false })
    holdTimer = setTimeout(() => {
      holdTimer = undefined
      if (
        !press ||
        element.isConnected === false ||
        target.isConnected === false ||
        element.closest('[inert], [hidden], [aria-hidden="true"]')
      ) {
        cancel()
        return
      }
      press.activated = true
      clickTarget = target
      target.addEventListener('click', suppressClick, { capture: true })
      // 下一次独立按下即清除保护，不吞掉用户随后主动点击的操作。
      window.addEventListener('pointerdown', clearClickGuard, { capture: true })
      element.focus({ preventScroll: true })
      options.startDrag(event, id)
    }, HOLD_DELAY_MS)
  }

  onScopeDispose(() => {
    cancel()
    clearClickGuard()
  })
  return { start, cancel, finish: finishPress }
}
