import { onScopeDispose, readonly, shallowRef, toValue, watch } from 'vue'
import type { MaybeRefOrGetter } from 'vue'

import { usePointerGestureGuard } from '../use-pointer-gesture-guard'

interface UseCatalogHeadingCollapseOptions {
  collapsed: MaybeRefOrGetter<boolean>
  /** 手机只允许纵向拖动；所有点击入口（包括拖动后的合成点击）均不切换。 */
  dragOnly?: MaybeRefOrGetter<boolean>
  /** 复用顶部栏的全部非控件区域，包括标题与统计文字。 */
  gestureTarget?: MaybeRefOrGetter<HTMLElement | null>
  updateCollapsed: (collapsed: boolean) => void
}

function isInteractiveControl(event: Event): boolean {
  const target = event.target as Element | null
  const element = typeof target?.closest === 'function' ? target : target?.parentElement
  return Boolean(
    element?.closest(
      'button, a, input, select, textarea, [role="button"], [contenteditable]:not([contenteditable="false"])',
    ),
  )
}

/** 手柄独占纵向手势；松手才提交，反向拖回、取消和横向移动都不切换顶部信息。 */
export function useCatalogHeadingCollapse(options: UseCatalogHeadingCollapseOptions) {
  const isDragging = shallowRef(false)
  const dragOffset = shallowRef(0)
  let suppressPointerClick = false
  const gestureGuard = usePointerGestureGuard({ finish: handlePointerUp, cancel })
  let gesture:
    | {
        id: number
        x: number
        y: number
        target: HTMLElement
        hasMoved: boolean
        axis?: 'horizontal' | 'vertical'
      }
    | undefined

  function releaseGesture(): void {
    gestureGuard.stop()
    const previous = gesture
    gesture = undefined
    isDragging.value = false
    dragOffset.value = 0
    if (previous?.target.hasPointerCapture(previous.id))
      previous.target.releasePointerCapture(previous.id)
  }

  function cancel(): void {
    if (gesture) suppressPointerClick = true
    releaseGesture()
  }

  function handlePointerDown(event: PointerEvent): void {
    if (gesture || !event.isPrimary || event.button !== 0) return
    const target = event.currentTarget
    if (!(target instanceof HTMLElement)) return
    suppressPointerClick = false
    gesture = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      target,
      hasMoved: false,
    }
    gestureGuard.start(event)
    target.setPointerCapture(event.pointerId)
    target.focus({ preventScroll: true })
  }

  function handlePointerMove(event: PointerEvent): void {
    if (!gesture || gesture.id !== event.pointerId) return
    const deltaX = Math.abs(event.clientX - gesture.x)
    const deltaY = Math.abs(event.clientY - gesture.y)
    if (Math.max(deltaX, deltaY) >= 8) gesture.hasMoved = true
    if (!gesture.axis) {
      if (!gesture.hasMoved) return
      if (deltaY > deltaX * 1.2) gesture.axis = 'vertical'
      else if (deltaX > deltaY * 1.2) gesture.axis = 'horizontal'
      else return
    }
    if (gesture.axis === 'vertical') {
      event.preventDefault()
      isDragging.value = true
      dragOffset.value = Math.max(-10, Math.min(10, (event.clientY - gesture.y) / 3))
    }
  }

  function handlePointerUp(event: PointerEvent): void {
    if (!gesture || gesture.id !== event.pointerId) return
    handlePointerMove(event)
    const deltaY = event.clientY - gesture.y
    const nextCollapsed =
      gesture.axis === 'vertical' && Math.abs(deltaY) >= 24 ? deltaY < 0 : undefined
    // 原生按钮在 pointerup 后仍可能派发 click；拖动（包括拖回原点）不能再切换一次。
    suppressPointerClick = gesture.hasMoved
    releaseGesture()
    if (nextCollapsed !== undefined && nextCollapsed !== toValue(options.collapsed))
      options.updateCollapsed(nextCollapsed)
  }

  function handlePointerCancel(event: PointerEvent): void {
    if (gesture?.id === event.pointerId) cancel()
  }

  function handleClick(event: MouseEvent): void {
    if (toValue(options.dragOnly)) {
      suppressPointerClick = false
      event.preventDefault()
      return
    }
    if (suppressPointerClick && event.detail !== 0) {
      suppressPointerClick = false
      event.preventDefault()
      return
    }
    suppressPointerClick = false
    options.updateCollapsed(!toValue(options.collapsed))
  }

  function handleKeydown(event: KeyboardEvent): void {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
    event.preventDefault()
    event.stopPropagation()
    cancel()
    const nextCollapsed = event.key === 'ArrowUp'
    if (nextCollapsed !== toValue(options.collapsed)) options.updateCollapsed(nextCollapsed)
  }

  watch([() => toValue(options.collapsed), () => toValue(options.dragOnly)], cancel, {
    flush: 'sync',
  })
  watch(
    () => toValue(options.gestureTarget),
    (target, _previous, onCleanup) => {
      if (!target) return
      const start = (event: PointerEvent): void => {
        if (isInteractiveControl(event)) return
        handlePointerDown(event)
      }
      const move = (event: PointerEvent): void => {
        if (gesture?.target === target) handlePointerMove(event)
      }
      const finish = (event: PointerEvent): void => {
        if (gesture?.target === target) handlePointerUp(event)
      }
      const abort = (event: PointerEvent): void => {
        if (gesture?.target === target) handlePointerCancel(event)
      }
      const click = (event: MouseEvent): void => {
        // Header text remains selectable/clickable; only a drag or the handle toggles it.
        if (!isInteractiveControl(event) && suppressPointerClick) {
          suppressPointerClick = false
          event.preventDefault()
        }
      }
      target.addEventListener('pointerdown', start)
      target.addEventListener('pointermove', move)
      target.addEventListener('pointerup', finish)
      target.addEventListener('pointercancel', abort)
      target.addEventListener('lostpointercapture', abort)
      target.addEventListener('click', click)
      onCleanup(() => {
        if (gesture?.target === target) cancel()
        target.removeEventListener('pointerdown', start)
        target.removeEventListener('pointermove', move)
        target.removeEventListener('pointerup', finish)
        target.removeEventListener('pointercancel', abort)
        target.removeEventListener('lostpointercapture', abort)
        target.removeEventListener('click', click)
      })
    },
    { immediate: true, flush: 'sync' },
  )
  onScopeDispose(cancel)
  return {
    isDragging: readonly(isDragging),
    dragOffset: readonly(dragOffset),
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    handlePointerCancel,
    handleClick,
    handleKeydown,
  }
}
