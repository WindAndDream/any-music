import { computed, onScopeDispose, readonly, shallowRef, toValue, watch } from 'vue'
import type { MaybeRefOrGetter } from 'vue'

import { calculatePointerPositionMs, clampPlaybackPositionMs } from '../precision-seek'

interface UseCompactAudioSeekOptions {
  disabled: MaybeRefOrGetter<boolean>
  durationMs: MaybeRefOrGetter<number | undefined>
  positionMs: MaybeRefOrGetter<number>
  seek: (positionMs: number) => void
}

/** 顶边时间轴独占手势并锁定横向意图；拖动仅预览，松手只提交一次跳转。 */
export function useCompactAudioSeek(options: UseCompactAudioSeekOptions) {
  const draftMs = shallowRef<number>()
  const durationMs = computed(() => {
    const duration = toValue(options.durationMs)
    return duration !== undefined && Number.isFinite(duration) && duration > 0
      ? Math.round(duration)
      : 0
  })
  const disabled = computed(() => toValue(options.disabled) || durationMs.value <= 0)
  const positionMs = computed(() =>
    clampPlaybackPositionMs(draftMs.value ?? toValue(options.positionMs), durationMs.value),
  )
  let gesture:
    | {
        id: number
        x: number
        y: number
        target: HTMLElement
        axis?: 'horizontal' | 'vertical'
      }
    | undefined

  function cancel(): void {
    const previous = gesture
    gesture = undefined
    draftMs.value = undefined
    if (previous?.target.hasPointerCapture(previous.id))
      previous.target.releasePointerCapture(previous.id)
  }

  function updateDraft(clientX: number): void {
    if (!gesture) return
    const bounds = gesture.target.getBoundingClientRect()
    draftMs.value = calculatePointerPositionMs(clientX, bounds.left, bounds.width, durationMs.value)
  }

  function handlePointerDown(event: PointerEvent): void {
    if (disabled.value || gesture || !event.isPrimary || event.button !== 0) return
    const target = event.currentTarget
    if (!(target instanceof HTMLElement)) return
    gesture = { id: event.pointerId, x: event.clientX, y: event.clientY, target }
    target.setPointerCapture(event.pointerId)
    target.focus({ preventScroll: true })
  }

  function handlePointerMove(event: PointerEvent): void {
    if (!gesture || gesture.id !== event.pointerId) return
    const deltaX = Math.abs(event.clientX - gesture.x)
    const deltaY = Math.abs(event.clientY - gesture.y)
    if (!gesture.axis) {
      if (Math.max(deltaX, deltaY) < 8) return
      if (deltaX > deltaY * 1.2) gesture.axis = 'horizontal'
      else if (deltaY > deltaX * 1.2) gesture.axis = 'vertical'
      else return
    }
    if (gesture.axis === 'horizontal') {
      event.preventDefault()
      updateDraft(event.clientX)
    }
  }

  function handlePointerUp(event: PointerEvent): void {
    if (!gesture || gesture.id !== event.pointerId) return
    handlePointerMove(event)
    const isTap =
      !gesture.axis && Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) < 8
    if (!disabled.value && (gesture.axis === 'horizontal' || isTap)) {
      updateDraft(event.clientX)
      options.seek(positionMs.value)
    }
    cancel()
  }

  function handlePointerCancel(event: PointerEvent): void {
    if (gesture?.id === event.pointerId) cancel()
  }

  function handleKeydown(event: KeyboardEvent): void {
    if (disabled.value) return
    const steps: Record<string, number> = {
      ArrowLeft: -5000,
      ArrowDown: -5000,
      ArrowRight: 5000,
      ArrowUp: 5000,
    }
    let next = steps[event.key] !== undefined ? positionMs.value + steps[event.key]! : undefined
    if (event.key === 'Home') next = 0
    if (event.key === 'End') next = durationMs.value
    if (next === undefined) return
    event.preventDefault()
    event.stopPropagation()
    options.seek(clampPlaybackPositionMs(next, durationMs.value))
  }

  watch(
    [disabled, durationMs],
    ([isDisabled, duration], [, previousDuration]) => {
      if (isDisabled || duration !== previousDuration) cancel()
    },
    { flush: 'sync' },
  )
  onScopeDispose(cancel)
  return {
    disabled,
    durationMs,
    positionMs,
    isSeeking: computed(() => draftMs.value !== undefined),
    draftMs: readonly(draftMs),
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    handlePointerCancel,
    handleKeydown,
  }
}
