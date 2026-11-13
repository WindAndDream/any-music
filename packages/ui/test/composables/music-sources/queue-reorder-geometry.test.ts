import { describe, expect, it } from 'vitest'

import {
  findQueueReorderSlot,
  getQueueReorderOffsets,
  type QueueReorderSlot,
} from '../../../src/composables/music-sources/queue-reorder-geometry'

describe('queue reorder geometry', () => {
  it('finds fixed slots in two dimensions and shifts cards across grid rows', () => {
    const slots: QueueReorderSlot[] = [
      { id: 'a', left: 0, top: 0, width: 100, height: 100 },
      { id: 'b', left: 110, top: 0, width: 100, height: 100 },
      { id: 'c', left: 0, top: 110, width: 100, height: 100 },
      { id: 'd', left: 110, top: 110, width: 100, height: 100 },
    ]
    expect(findQueueReorderSlot(slots, 160, 50)?.id).toBe('b')
    expect(findQueueReorderSlot(slots, 160, 160)?.id).toBe('d')
    expect([...getQueueReorderOffsets(slots, 0, 3, 'track')]).toEqual([
      ['b', { x: -110, y: 0 }],
      ['c', { x: 110, y: -110 }],
      ['d', { x: -110, y: 0 }],
    ])
    expect(getQueueReorderOffsets(slots, 0, 0, 'track').size).toBe(0)
  })

  it('keeps differently sized platform groups contiguous in both directions', () => {
    const slots: QueueReorderSlot[] = [
      { id: 'a', left: 0, top: 0, width: 300, height: 100 },
      { id: 'b', left: 0, top: 110, width: 300, height: 200 },
      { id: 'c', left: 0, top: 320, width: 300, height: 300 },
    ]
    expect([...getQueueReorderOffsets(slots, 0, 2, 'platform')]).toEqual([
      ['b', { x: 0, y: -110 }],
      ['c', { x: 0, y: -110 }],
    ])
    expect([...getQueueReorderOffsets(slots, 2, 0, 'platform')]).toEqual([
      ['b', { x: 0, y: 310 }],
      ['a', { x: 0, y: 310 }],
    ])
  })
})
