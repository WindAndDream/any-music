import { computed, onScopeDispose, readonly, shallowRef, toValue, watch } from 'vue'
import type { MaybeRefOrGetter } from 'vue'

import { useBackHandler } from '../use-back-navigation'
import { usePointerGestureGuard } from '../use-pointer-gesture-guard'
interface UseMobilePlayerSheetOptions {
  enabled: MaybeRefOrGetter<boolean>
  getHeight: () => number
  /** 详情已滚动时先交回内容滚动；回到顶部后才能下拉收起。 */
  getScrollTop?: () => number
}

/** 纵向展开只跟随位移，不用长按计时器自动弹出；锁定方向后允许反向拖回。 */
export function useMobilePlayerSheet(options: UseMobilePlayerSheetOptions) {
  const isExpanded = shallowRef(false)
  const dragProgress = shallowRef<number>()
  const isDragging = computed(() => dragProgress.value !== undefined)
  const isVisible = computed(() => isExpanded.value || (dragProgress.value ?? 0) > 0)
  const offsetPercentage = computed(
    () => (1 - (dragProgress.value ?? (isExpanded.value ? 1 : 0))) * 100,
  )
  let gesture:
    | {
        id: number
        x: number
        y: number
        height: number
        startedExpanded: boolean
        axis?: 'horizontal' | 'vertical'
        target: HTMLElement
      }
    | undefined
  let shouldSuppressClick = false
  const gestureGuard = usePointerGestureGuard({ finish: handlePointerEnd, cancel: releasePointer })

  function releasePointer(): void {
    gestureGuard.stop()
    const previous = gesture
    gesture = undefined
    if (previous?.target.hasPointerCapture(previous.id)) {
      previous.target.releasePointerCapture(previous.id)
    }
    dragProgress.value = undefined
  }

  function expand(): void {
    if (!toValue(options.enabled)) return
    releasePointer()
    isExpanded.value = true
  }

  function collapse(): void {
    releasePointer()
    isExpanded.value = false
  }

  function handlePointerDown(event: PointerEvent): void {
    if (!toValue(options.enabled) || gesture || !event.isPrimary || event.button !== 0) return
    // 新点击总是解除上一次拖动的保护，包括不参与展开的播放/设置按钮。
    shouldSuppressClick = false
    const eventTarget = event.target
    const target =
      eventTarget instanceof HTMLElement
        ? eventTarget
        : eventTarget instanceof Element
          ? eventTarget.parentElement
          : null
    if (!(target instanceof HTMLElement)) return
    // 顶边进度与普通按钮独占各自输入；文字/空白区域和展开手柄才接管纵向操作。
    if (
      target.closest(
        '[data-player-seek], [role="slider"], button:not([data-player-sheet-handle]), input, select, textarea, a, [contenteditable="true"]',
      )
    )
      return
    if (isExpanded.value && (options.getScrollTop?.() ?? 0) > 0) return
    gesture = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      height: Math.max(1, options.getHeight()),
      startedExpanded: isExpanded.value,
      target,
    }
    gestureGuard.start(event)
    target.setPointerCapture(event.pointerId)
  }

  function handlePointerMove(event: PointerEvent): void {
    if (!gesture || gesture.id !== event.pointerId) return
    const deltaX = event.clientX - gesture.x
    const deltaY = event.clientY - gesture.y
    if (!gesture.axis) {
      if (Math.max(Math.abs(deltaX), Math.abs(deltaY)) < 8) return
      if (Math.abs(deltaX) > Math.abs(deltaY) * 1.2) gesture.axis = 'horizontal'
      else if (Math.abs(deltaY) > Math.abs(deltaX) * 1.2) gesture.axis = 'vertical'
      else return
    }
    // 空白展开按钮上的横拖也需抑制合成 click，避免分页器外的落点误展开。
    shouldSuppressClick = true
    // 水平意图交给分页器，后续即使拐弯也不能突然展开播放器。
    if (gesture.axis === 'horizontal') return
    event.preventDefault()
    dragProgress.value = Math.max(
      0,
      Math.min(1, (gesture.startedExpanded ? 1 : 0) - deltaY / gesture.height),
    )
  }

  function handlePointerEnd(event: PointerEvent): void {
    if (!gesture || gesture.id !== event.pointerId) return
    handlePointerMove(event)
    if (gesture.axis === 'vertical') {
      const deltaY = event.clientY - gesture.y
      const threshold = Math.min(140, gesture.height * 0.22)
      isExpanded.value = gesture.startedExpanded ? deltaY < threshold : -deltaY >= threshold
    }
    releasePointer()
  }

  function handlePointerCancel(event: PointerEvent): void {
    if (gesture?.id === event.pointerId) releasePointer()
  }

  function handleClick(event: MouseEvent): void {
    if (!shouldSuppressClick || event.detail === 0) return
    shouldSuppressClick = false
    event.preventDefault()
    event.stopPropagation()
  }

  watch(
    () => toValue(options.enabled),
    (enabled) => {
      if (!enabled) collapse()
    },
    { flush: 'sync' },
  )
  onScopeDispose(releasePointer)
  useBackHandler({
    active: () => isExpanded.value,
    handle: collapse,
    layer: 'player',
  })

  return {
    isExpanded: readonly(isExpanded),
    isVisible,
    isDragging,
    offsetPercentage,
    expand,
    collapse,
    handlePointerDown,
    handlePointerMove,
    handlePointerEnd,
    handlePointerCancel,
    handleClick,
  }
}
