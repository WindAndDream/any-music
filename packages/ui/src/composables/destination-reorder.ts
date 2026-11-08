/**
 * Geometry used by the pointer reorder preview. Coordinates are relative to the list so a
 * surrounding bottom sheet can scroll without invalidating the measured slots.
 */
export interface DestinationReorderSlot {
  top: number
  bottom: number
}

/** Return a new list with one item inserted at another index without mutating the input. */
export function moveItemToIndex<T>(
  items: readonly T[],
  sourceIndex: number,
  targetIndex: number,
): T[] {
  if (
    sourceIndex < 0 ||
    sourceIndex >= items.length ||
    targetIndex < 0 ||
    targetIndex >= items.length ||
    sourceIndex === targetIndex
  ) {
    return [...items]
  }

  const nextItems = [...items]
  const [item] = nextItems.splice(sourceIndex, 1)
  if (item === undefined) return nextItems
  nextItems.splice(targetIndex, 0, item)
  return nextItems
}

/**
 * Change slots only after the dragged row's center crosses another row's center. This avoids
 * jitter around the starting position and makes pointer and touch movement feel predictable.
 */
export function getDestinationReorderIndex(
  slots: readonly DestinationReorderSlot[],
  sourceIndex: number,
  draggedCenter: number,
): number {
  if (sourceIndex < 0 || sourceIndex >= slots.length) return sourceIndex

  const sourceSlot = slots[sourceIndex]
  if (!sourceSlot) return sourceIndex
  const sourceCenter = (sourceSlot.top + sourceSlot.bottom) / 2

  if (draggedCenter < sourceCenter) {
    let targetIndex = sourceIndex
    for (let index = sourceIndex - 1; index >= 0; index -= 1) {
      const slot = slots[index]
      if (!slot || draggedCenter >= (slot.top + slot.bottom) / 2) break
      targetIndex = index
    }
    return targetIndex
  }

  let targetIndex = sourceIndex
  for (let index = sourceIndex + 1; index < slots.length; index += 1) {
    const slot = slots[index]
    if (!slot || draggedCenter <= (slot.top + slot.bottom) / 2) break
    targetIndex = index
  }

  return targetIndex
}
