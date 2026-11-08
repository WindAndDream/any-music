import { onScopeDispose, readonly, shallowRef, toValue, watch } from 'vue'
import type { MaybeRefOrGetter } from 'vue'

import { usePointerGestureGuard } from '../use-pointer-gesture-guard'

interface UsePlayerControlPagerOptions {
  /** 由外层布局决定是否启用分页，退出移动布局才重置当前页。 */
  enabled: MaybeRefOrGetter<boolean>
  /** 完整播放器暂时遮住控制栏时只暂停交互，保留用户选择的页。 */
  suspended?: MaybeRefOrGetter<boolean>
}

/** 迷你播放器的两页展示状态；保留右滑查看设置、左滑返回的既有操作。 */
export function usePlayerControlPager(options: UsePlayerControlPagerOptions) {
  const isActionsVisible = shallowRef(false)
  let swipeStart:
    | { pointerId: number; x: number; y: number; axis?: 'horizontal' | 'vertical' }
    | undefined
  let captureTarget: HTMLElement | undefined
  let shouldSuppressClick = false
  let wheelDistance = 0
  let lastWheelAt = 0
  let wheelLockedUntil = 0
  const gestureGuard = usePointerGestureGuard({ finish: handlePointerUp, cancel: releasePointer })

  function canInteract(): boolean {
    return toValue(options.enabled) && !toValue(options.suspended)
  }

  function releasePointer(): void {
    gestureGuard.stop()
    const previous = swipeStart
    const target = captureTarget
    swipeStart = undefined
    captureTarget = undefined
    if (previous && target?.hasPointerCapture(previous.pointerId)) {
      target.releasePointerCapture(previous.pointerId)
    }
  }

  function showActions(): void {
    if (canInteract()) isActionsVisible.value = true
  }

  function showPlayback(): void {
    if (canInteract()) isActionsVisible.value = false
  }

  function handlePointerDown(event: PointerEvent): void {
    if (!canInteract() || !event.isPrimary || event.button !== 0 || swipeStart) return
    shouldSuppressClick = false
    swipeStart = { pointerId: event.pointerId, x: event.clientX, y: event.clientY }
    gestureGuard.start(event)
  }

  function handlePointerMove(event: PointerEvent): void {
    if (!swipeStart || event.pointerId !== swipeStart.pointerId) return
    const deltaX = event.clientX - swipeStart.x
    const deltaY = event.clientY - swipeStart.y
    if (!swipeStart.axis) {
      if (Math.max(Math.abs(deltaX), Math.abs(deltaY)) < 8) return
      if (Math.abs(deltaX) > Math.abs(deltaY) * 1.2) swipeStart.axis = 'horizontal'
      else if (Math.abs(deltaY) > Math.abs(deltaX) * 1.2) swipeStart.axis = 'vertical'
      else return
    }
    if (swipeStart.axis !== 'horizontal') return
    // 鼠标横拖也走分页，阻止文字选中和图片默认拖拽抢占手势。
    event.preventDefault()
    // 只有确认水平意图后才捕获指针，普通按钮点击和纵向展开仍由原控件处理。
    shouldSuppressClick = true
    const target = event.currentTarget
    if (!captureTarget && target instanceof HTMLElement) {
      captureTarget = target
      target.setPointerCapture(event.pointerId)
    }
  }

  function handlePointerUp(event: PointerEvent): void {
    if (!swipeStart || event.pointerId !== swipeStart.pointerId) return
    const deltaX = event.clientX - swipeStart.x
    const deltaY = event.clientY - swipeStart.y
    const isVertical = swipeStart.axis === 'vertical'
    releasePointer()
    if (
      !canInteract() ||
      isVertical ||
      Math.abs(deltaX) < 48 ||
      Math.abs(deltaX) < Math.abs(deltaY) * 1.2
    )
      return
    shouldSuppressClick = true
    isActionsVisible.value = deltaX > 0
  }

  function handlePointerCancel(event: PointerEvent): void {
    if (event.pointerId === swipeStart?.pointerId) releasePointer()
  }

  function handleClick(event: MouseEvent): void {
    // 滑动结束生成的 click 不能下载或切歌；键盘触发的 click 始终保留。
    if (!canInteract() || !shouldSuppressClick || event.detail === 0) return
    event.preventDefault()
    event.stopPropagation()
    shouldSuppressClick = false
  }

  function handleWheel(event: WheelEvent): void {
    if (!canInteract() || event.ctrlKey || swipeStart) return
    const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY
    if (!delta) return
    const now = Date.now()
    // 滚轮和触控板的同一次惯性输入只翻一页，反向输入需等待上一页切换完成。
    if (now < wheelLockedUntil) {
      event.preventDefault()
      return
    }
    if (delta > 0 === isActionsVisible.value) return
    event.preventDefault()
    if (now - lastWheelAt > 160 || Math.sign(delta) !== Math.sign(wheelDistance)) wheelDistance = 0
    lastWheelAt = now
    wheelDistance += delta * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 48 : 1)
    if (Math.abs(wheelDistance) < 32) return
    isActionsVisible.value = delta > 0
    wheelDistance = 0
    wheelLockedUntil = now + 300
  }

  watch(
    [() => toValue(options.enabled), () => toValue(options.suspended)],
    ([enabled, suspended]) => {
      if (enabled && !suspended) return
      releasePointer()
      shouldSuppressClick = false
      wheelDistance = 0
      wheelLockedUntil = 0
      if (!enabled) isActionsVisible.value = false
    },
    { flush: 'sync' },
  )
  onScopeDispose(releasePointer)

  return {
    isActionsVisible: readonly(isActionsVisible),
    showActions,
    showPlayback,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    handlePointerCancel,
    handleClick,
    handleWheel,
  }
}
