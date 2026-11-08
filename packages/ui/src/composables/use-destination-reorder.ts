import { computed, nextTick, onScopeDispose, readonly, shallowRef, toValue, watch } from 'vue'
import type { CSSProperties, MaybeRefOrGetter } from 'vue'

import type { ProductDestination } from '../product/product-navigation'
import { getDestinationReorderIndex, moveItemToIndex } from './destination-reorder'
import type { DestinationReorderSlot } from './destination-reorder'
import { usePointerGestureGuard } from './use-pointer-gesture-guard'

interface UseDestinationReorderOptions {
  destinations: MaybeRefOrGetter<readonly ProductDestination[]>
  moveDestination: (id: ProductDestination['id'], offset: -1 | 1) => void
}

interface PointerReorderState {
  id: ProductDestination['id']
  pointerId: number
  handle: HTMLButtonElement
  list: HTMLOListElement
  sourceIndex: number
  targetIndex: number
  grabOffset: number
  currentClientY: number
  slots: readonly DestinationReorderSlot[]
}

/**
 * Owns the pointer geometry and keyboard grab state for the destination list. Persistence stays in
 * the parent shell: this composable requests the existing one-step move action only when a reorder
 * is committed.
 */
export function useDestinationReorder(options: UseDestinationReorderOptions) {
  const displayedDestinations = shallowRef<readonly ProductDestination[]>([
    ...toValue(options.destinations),
  ])
  const pointerReorder = shallowRef<PointerReorderState>()
  const keyboardGrabbedId = shallowRef<ProductDestination['id']>()
  const announcement = shallowRef('')
  const gestureGuard = usePointerGestureGuard({
    finish: commitPointerReorder,
    cancel: cancelPointerReorder,
  })

  const draggedDestinationId = computed(() => pointerReorder.value?.id)

  watch(
    () => toValue(options.destinations),
    (destinations) => {
      if (!pointerReorder.value) displayedDestinations.value = [...destinations]
    },
  )

  function startPointerReorder(event: PointerEvent, id: ProductDestination['id']): void {
    if (!event.isPrimary || (event.pointerType === 'mouse' && event.button !== 0)) return

    const handle = event.currentTarget as HTMLButtonElement
    const row = handle.closest('li[data-destination-id]') as HTMLLIElement | null
    const list = row?.parentElement
    if (!(list instanceof HTMLOListElement)) return

    const rowElements = [...list.children].filter(
      (element): element is HTMLLIElement =>
        element instanceof HTMLLIElement && Boolean(element.dataset.destinationId),
    )
    const sourceIndex = displayedDestinations.value.findIndex(
      (destination) => destination.id === id,
    )
    if (sourceIndex < 0 || rowElements.length !== displayedDestinations.value.length) return

    const listTop = list.getBoundingClientRect().top
    const slots = rowElements.map((element) => {
      const rect = element.getBoundingClientRect()
      return { top: rect.top - listTop, bottom: rect.bottom - listTop }
    })
    const sourceSlot = slots[sourceIndex]
    if (!sourceSlot) return

    event.preventDefault()
    keyboardGrabbedId.value = undefined
    handle.focus({ preventScroll: true })
    handle.setPointerCapture(event.pointerId)
    pointerReorder.value = {
      id,
      pointerId: event.pointerId,
      handle,
      list,
      sourceIndex,
      targetIndex: sourceIndex,
      grabOffset: clamp(
        event.clientY - listTop - sourceSlot.top,
        0,
        sourceSlot.bottom - sourceSlot.top,
      ),
      currentClientY: event.clientY,
      slots,
    }
    gestureGuard.start(event)
    announcement.value = `正在移动 ${getDestinationLabel(id)}。上下拖动后松开以完成排序。`
  }

  function updatePointerReorder(event: PointerEvent): void {
    const state = pointerReorder.value
    if (!state || state.pointerId !== event.pointerId) return

    event.preventDefault()
    const listTop = state.list.getBoundingClientRect().top
    const sourceSlot = state.slots[state.sourceIndex]
    if (!sourceSlot) return
    const draggedTop = event.clientY - listTop - state.grabOffset
    const draggedCenter = draggedTop + (sourceSlot.bottom - sourceSlot.top) / 2
    pointerReorder.value = {
      ...state,
      currentClientY: event.clientY,
      targetIndex: getDestinationReorderIndex(state.slots, state.sourceIndex, draggedCenter),
    }
  }

  function commitPointerReorder(event: PointerEvent): void {
    updatePointerReorder(event)
    const state = pointerReorder.value
    if (!state || state.pointerId !== event.pointerId) return

    event.preventDefault()
    const { id, sourceIndex, targetIndex } = state
    gestureGuard.stop()
    pointerReorder.value = undefined
    clearPointerCapture(state)

    if (sourceIndex !== targetIndex) {
      displayedDestinations.value = moveItemToIndex(
        displayedDestinations.value,
        sourceIndex,
        targetIndex,
      )
      const offset = targetIndex > sourceIndex ? 1 : -1
      for (let index = sourceIndex; index !== targetIndex; index += offset) {
        options.moveDestination(id, offset)
      }
      announcement.value = `${getDestinationLabel(id)} 已移动到第 ${targetIndex + 1} 项。`
    } else {
      announcement.value = `${getDestinationLabel(id)} 的位置未改变。`
    }

    syncControlledDestinations()
  }

  function cancelPointerReorder(event?: PointerEvent): void {
    const state = pointerReorder.value
    if (!state || (event && state.pointerId !== event.pointerId)) return

    gestureGuard.stop()
    pointerReorder.value = undefined
    clearPointerCapture(state)
    announcement.value = `已取消移动 ${getDestinationLabel(state.id)}。`
    syncControlledDestinations()
  }

  function handleLostPointerCapture(event: PointerEvent): void {
    if (pointerReorder.value?.pointerId === event.pointerId) cancelPointerReorder(event)
  }

  function handleReorderKeydown(event: KeyboardEvent, id: ProductDestination['id']): void {
    if (event.key === ' ' || event.key === 'Enter') {
      event.preventDefault()
      if (keyboardGrabbedId.value === id) {
        keyboardGrabbedId.value = undefined
        announcement.value = `已完成 ${getDestinationLabel(id)} 的排序。`
      } else {
        keyboardGrabbedId.value = id
        announcement.value = `已选中 ${getDestinationLabel(id)}。使用上下方向键移动，空格或回车完成。`
      }
      return
    }

    if (event.key === 'Escape' && keyboardGrabbedId.value === id) {
      event.preventDefault()
      keyboardGrabbedId.value = undefined
      announcement.value = `已完成 ${getDestinationLabel(id)} 的排序。`
      return
    }

    if (keyboardGrabbedId.value !== id || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) {
      return
    }

    event.preventDefault()
    const sourceIndex = displayedDestinations.value.findIndex(
      (destination) => destination.id === id,
    )
    const offset = event.key === 'ArrowUp' ? -1 : 1
    const targetIndex = sourceIndex + offset
    if (sourceIndex < 0 || targetIndex < 0 || targetIndex >= displayedDestinations.value.length) {
      announcement.value = `${getDestinationLabel(id)} 已在列表${offset < 0 ? '顶部' : '底部'}。`
      return
    }

    displayedDestinations.value = moveItemToIndex(
      displayedDestinations.value,
      sourceIndex,
      targetIndex,
    )
    options.moveDestination(id, offset)
    announcement.value = `${getDestinationLabel(id)} 已移动到第 ${targetIndex + 1} 项。`
    const handle = event.currentTarget as HTMLButtonElement
    void nextTick(() => handle.focus({ preventScroll: true }))
  }

  function getDestinationStyle(id: ProductDestination['id']): CSSProperties | undefined {
    const state = pointerReorder.value
    if (!state) return undefined
    const index = displayedDestinations.value.findIndex((destination) => destination.id === id)
    const slot = state.slots[index]
    if (index < 0 || !slot) return undefined

    if (id === state.id) {
      const firstSlot = state.slots[0]
      const lastSlot = state.slots.at(-1)
      const sourceSlot = state.slots[state.sourceIndex]
      if (!firstSlot || !lastSlot || !sourceSlot) return undefined
      const listTop = state.list.getBoundingClientRect().top
      const rowHeight = sourceSlot.bottom - sourceSlot.top
      const draggedTop = clamp(
        state.currentClientY - listTop - state.grabOffset,
        firstSlot.top,
        lastSlot.bottom - rowHeight,
      )
      return { transform: `translate3d(0, ${draggedTop - sourceSlot.top}px, 0)` }
    }

    if (
      state.targetIndex > state.sourceIndex &&
      index > state.sourceIndex &&
      index <= state.targetIndex
    ) {
      const previousSlot = state.slots[index - 1]
      if (!previousSlot) return undefined
      return { transform: `translate3d(0, ${previousSlot.top - slot.top}px, 0)` }
    }

    if (
      state.targetIndex < state.sourceIndex &&
      index >= state.targetIndex &&
      index < state.sourceIndex
    ) {
      const nextSlot = state.slots[index + 1]
      if (!nextSlot) return undefined
      return { transform: `translate3d(0, ${nextSlot.top - slot.top}px, 0)` }
    }

    return undefined
  }

  function isDestinationShifted(id: ProductDestination['id']): boolean {
    return Boolean(getDestinationStyle(id)) && id !== pointerReorder.value?.id
  }

  function getDestinationLabel(id: ProductDestination['id']): string {
    return displayedDestinations.value.find((destination) => destination.id === id)?.label ?? id
  }

  function syncControlledDestinations(): void {
    void nextTick(() => {
      if (!pointerReorder.value) {
        displayedDestinations.value = [...toValue(options.destinations)]
      }
    })
  }

  onScopeDispose(() => {
    const state = pointerReorder.value
    pointerReorder.value = undefined
    if (state) clearPointerCapture(state)
  })

  return {
    displayedDestinations: readonly(displayedDestinations),
    draggedDestinationId,
    keyboardGrabbedId: readonly(keyboardGrabbedId),
    announcement: readonly(announcement),
    startPointerReorder,
    updatePointerReorder,
    commitPointerReorder,
    cancelPointerReorder,
    handleLostPointerCapture,
    handleReorderKeydown,
    getDestinationStyle,
    isDestinationShifted,
  }
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum)
}

function clearPointerCapture(state: PointerReorderState): void {
  if (state.handle.hasPointerCapture(state.pointerId)) {
    state.handle.releasePointerCapture(state.pointerId)
  }
}
