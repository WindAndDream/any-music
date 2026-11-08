import { onMounted, onScopeDispose, onUpdated, readonly, shallowRef, toValue } from 'vue'
import type { MaybeRefOrGetter } from 'vue'

import { usePointerGestureGuard } from '../use-pointer-gesture-guard'

interface CatalogOperatorScrollOptions {
  container: MaybeRefOrGetter<HTMLElement | null>
  viewport: MaybeRefOrGetter<HTMLElement | null>
  content: MaybeRefOrGetter<HTMLElement | null>
}

/** 原生滚动承载按钮和键盘焦点；横拖只接管水平意图，纵向输入仍交给列表。 */
export function useCatalogOperatorScroll(options: CatalogOperatorScrollOptions) {
  const hasOverflow = shallowRef(false)
  const isAtEnd = shallowRef(false)
  let observer: ResizeObserver | undefined
  let gesture:
    | { id: number; x: number; y: number; left: number; target: HTMLElement; axis?: 'x' | 'y' }
    | undefined
  let suppressClick = false
  const gestureGuard = usePointerGestureGuard({ finish: handlePointerUp, cancel: releasePointer })

  function updateScroll(): void {
    const viewport = toValue(options.viewport)
    if (!viewport) return
    const availableWidth = toValue(options.container)?.clientWidth ?? viewport.clientWidth
    const contentWidth = toValue(options.content)?.scrollWidth ?? viewport.scrollWidth
    const maximum = Math.max(0, viewport.scrollWidth - viewport.clientWidth)
    // 按整行宽度判断是否放得下，避免已显示的箭头占位让按钮一直停留在滚动布局。
    hasOverflow.value = contentWidth > availableWidth + 1
    isAtEnd.value = hasOverflow.value && maximum > 1 && viewport.scrollLeft >= maximum - 1
    if (!hasOverflow.value) releasePointer()
  }

  function advance(): void {
    const viewport = toValue(options.viewport)
    if (!viewport || !hasOverflow.value) return
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const nextButton = Array.from(toValue(options.content)?.children ?? []).find(
      (element) =>
        element instanceof HTMLElement &&
        element.offsetLeft > viewport.scrollLeft + 1 &&
        element.offsetLeft + element.offsetWidth > viewport.scrollLeft + viewport.clientWidth,
    ) as HTMLElement | undefined
    viewport.scrollTo({
      left: isAtEnd.value
        ? 0
        : (nextButton?.offsetLeft ?? viewport.scrollLeft + viewport.clientWidth),
      behavior: reducedMotion ? 'instant' : 'smooth',
    })
  }

  function releasePointer(): void {
    gestureGuard.stop()
    const previous = gesture
    gesture = undefined
    if (previous?.target.hasPointerCapture(previous.id)) {
      previous.target.releasePointerCapture(previous.id)
    }
  }

  function handlePointerDown(event: PointerEvent): void {
    if (gesture || !event.isPrimary || event.button !== 0) return
    suppressClick = false
    const viewport = toValue(options.viewport)
    if (!viewport || !hasOverflow.value) return
    gesture = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      left: viewport.scrollLeft,
      target: viewport,
    }
    gestureGuard.start(event)
  }

  function handlePointerMove(event: PointerEvent): void {
    if (!gesture || gesture.id !== event.pointerId) return
    const deltaX = event.clientX - gesture.x
    const deltaY = event.clientY - gesture.y
    if (!gesture.axis) {
      if (Math.max(Math.abs(deltaX), Math.abs(deltaY)) < 8) return
      if (Math.abs(deltaX) > Math.abs(deltaY) * 1.2) gesture.axis = 'x'
      else if (Math.abs(deltaY) > Math.abs(deltaX) * 1.2) gesture.axis = 'y'
      else return
    }
    if (gesture.axis !== 'x') return
    event.preventDefault()
    suppressClick = true
    if (!gesture.target.hasPointerCapture(event.pointerId))
      gesture.target.setPointerCapture(event.pointerId)
    gesture.target.scrollLeft = Math.max(
      0,
      Math.min(gesture.target.scrollWidth - gesture.target.clientWidth, gesture.left - deltaX),
    )
    updateScroll()
  }

  function handlePointerUp(event: PointerEvent): void {
    if (gesture?.id !== event.pointerId) return
    handlePointerMove(event)
    releasePointer()
  }

  function handlePointerCancel(event: PointerEvent): void {
    if (gesture?.id === event.pointerId) releasePointer()
  }

  function handleClick(event: MouseEvent): void {
    if (!suppressClick || event.detail === 0) return
    suppressClick = false
    event.preventDefault()
    event.stopPropagation()
  }

  onMounted(() => {
    updateScroll()
    if (typeof ResizeObserver === 'undefined') return
    observer = new ResizeObserver(updateScroll)
    for (const element of [
      toValue(options.container),
      toValue(options.viewport),
      toValue(options.content),
    ]) {
      if (element) observer.observe(element)
    }
  })
  // 恢复原名按钮随选择出现或消失，重新计算边缘状态，不保留失效的箭头。
  onUpdated(updateScroll)
  onScopeDispose(() => {
    observer?.disconnect()
    releasePointer()
  })

  return {
    hasOverflow: readonly(hasOverflow),
    isAtEnd: readonly(isAtEnd),
    updateScroll,
    advance,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    handlePointerCancel,
    handleClick,
  }
}
