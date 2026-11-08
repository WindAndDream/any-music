export interface QueueReorderSlot {
  id: string
  left: number
  top: number
  width: number
  height: number
}

/** 在拖动开始时的槽位上判断落点，浮起的卡片和让位动画不会改变命中结果。 */
export function findQueueReorderSlot(
  slots: readonly QueueReorderSlot[],
  x: number,
  y: number,
): QueueReorderSlot | undefined {
  let nearest: QueueReorderSlot | undefined
  let distance = Infinity
  for (const slot of slots) {
    const dx = x - slot.left - slot.width / 2
    const dy = y - slot.top - slot.height / 2
    const next = dx * dx + dy * dy
    if (next < distance) {
      nearest = slot
      distance = next
    }
  }
  return nearest
}

/** 歌曲网格按原始槽位让位；高低不同的平台区块按源区块高度整体平移。 */
export function getQueueReorderOffsets(
  slots: readonly QueueReorderSlot[],
  sourceIndex: number,
  targetIndex: number,
  kind: 'track' | 'platform',
): ReadonlyMap<string, { x: number; y: number }> {
  const offsets = new Map<string, { x: number; y: number }>()
  const source = slots[sourceIndex]
  if (!source || sourceIndex === targetIndex) return offsets
  const direction = targetIndex > sourceIndex ? 1 : -1
  const adjacent = slots[sourceIndex + direction]
  if (!adjacent) return offsets
  const groupShift =
    direction > 0
      ? source.top - adjacent.top
      : source.top + source.height - adjacent.top - adjacent.height
  for (let index = sourceIndex + direction; index !== targetIndex + direction; index += direction) {
    const slot = slots[index]
    const destination = slots[index - direction]
    if (!slot || !destination) continue
    offsets.set(
      slot.id,
      kind === 'platform'
        ? { x: 0, y: groupShift }
        : { x: destination.left - slot.left, y: destination.top - slot.top },
    )
  }
  return offsets
}
