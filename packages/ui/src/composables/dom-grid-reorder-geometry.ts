import type { GridReorderGeometryInput, GridReorderGeometrySession } from './grid-reorder-geometry'
import {
  findQueueReorderSlot,
  getQueueReorderOffsets,
  type QueueReorderSlot,
} from './music-sources/queue-reorder-geometry'

interface DomGridReorderGeometryOptions<Kind extends string> {
  attributePrefix: string
  getGroupElement?: (kind: Kind, element: HTMLElement) => HTMLElement | null
  includeOtherGroups?: boolean
  vertical?: boolean
}

/** Cache stable DOM slots; only actual root-height changes refresh their natural geometry. */
export function createDomGridReorderGeometry<Kind extends string>(
  input: GridReorderGeometryInput<Kind>,
  options: DomGridReorderGeometryOptions<Kind>,
): GridReorderGeometrySession | undefined {
  const { container, bounds, ids, kind, eligibleIds, sourceId } = input
  const elements = [
    ...container.querySelectorAll<HTMLElement>(
      `[data-${options.attributePrefix}-drop-kind="${kind}"]`,
    ),
  ]
  const byId = new Map(
    elements.map((element) => [element.dataset[`${options.attributePrefix}DropId`], element]),
  )
  let measuredSlots = ids.flatMap((id) => {
    const element = byId.get(id)
    if (!element || (!eligibleIds.has(id) && !options.includeOtherGroups)) return []
    return [measureSlot(id, element.getBoundingClientRect(), bounds)]
  })
  let slots = measuredSlots.filter((slot) => eligibleIds.has(slot.id))
  const sourceIndex = slots.findIndex((slot) => slot.id === sourceId)
  const sourceSlot = slots[sourceIndex]
  const sourceElement = byId.get(sourceId)
  if (!sourceSlot || !sourceElement) return undefined
  const groupElement = options.getGroupElement?.(kind, sourceElement)
  let domain = groupElement
    ? measureSlot('', groupElement.getBoundingClientRect(), bounds)
    : undefined
  return {
    // Replace snapshots rather than mutating the pointer-down source kept by the controller.
    get sourceSlot() {
      return slots[sourceIndex]!
    },
    sourceElement,
    getMountedElement: (id) => byId.get(id),
    get domain() {
      return domain
    },
    allowsHeightChanges: true,
    refreshHeight: () => {
      const origin = container.getBoundingClientRect()
      const scrollDelta = (container.scrollTop ?? input.initialScrollTop) - input.initialScrollTop
      const next: QueueReorderSlot[] = []
      for (const previous of measuredSlots) {
        const element = byId.get(previous.id)!
        if (element.isConnected === false) return false
        const slot = measureSlot(previous.id, element.getBoundingClientRect(), origin)
        slot.top += scrollDelta
        // Density/columns/gaps are spatial changes, not a natural-height refresh.
        if (Math.abs(slot.left - previous.left) > 1 || Math.abs(slot.width - previous.width) > 1)
          return false
        next.push(slot)
      }
      measuredSlots = next
      slots = next.filter((slot) => eligibleIds.has(slot.id))
      if (groupElement) {
        domain = measureSlot('', groupElement.getBoundingClientRect(), origin)
        domain.top += scrollDelta
      }
      return true
    },
    findSlot: (x, y) => findQueueReorderSlot(measuredSlots, x, y),
    getOffsets: (targetId) => {
      const targetIndex = slots.findIndex((slot) => slot.id === targetId)
      return getQueueReorderOffsets(
        slots,
        sourceIndex,
        targetIndex < 0 ? sourceIndex : targetIndex,
        options.vertical ? 'platform' : 'track',
      )
    },
  }
}

function measureSlot(id: string, rect: DOMRect, origin: DOMRect): QueueReorderSlot {
  return {
    id,
    left: rect.left - origin.left,
    top: rect.top - origin.top,
    width: rect.width,
    height: rect.height,
  }
}
