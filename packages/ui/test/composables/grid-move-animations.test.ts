import { describe, expect, it, vi } from 'vitest'

import {
  createGridMoveAnimations,
  retainGridMotionVisibility,
} from '../../src/composables/grid-move-animations'

function element() {
  const attributes = new Map<string, string>()
  return {
    attributes,
    getAttribute: (key: string) => attributes.get(key) ?? null,
    setAttribute: (key: string, value: string) => attributes.set(key, value),
    removeAttribute: (key: string) => attributes.delete(key),
  } as unknown as HTMLElement & { attributes: Map<string, string> }
}

describe('shared move rendering lease', () => {
  it('keeps overlapping owners and restores a pre-existing marker only after the last release', () => {
    const slot = element()
    slot.setAttribute('data-am-grid-moving', 'external')
    const first = retainGridMotionVisibility(slot)
    const second = retainGridMotionVisibility(slot)
    first()
    first()
    expect(slot.getAttribute('data-am-grid-moving')).toBe('')
    second()
    expect(slot.getAttribute('data-am-grid-moving')).toBe('external')
  })

  it('cleans a failed animation and releases unused holds after a zero-distance rebase', () => {
    const slot = element()
    const owner = createGridMoveAnimations()
    const surface = {
      animate: vi.fn(() => {
        throw new Error('unavailable')
      }),
    } as unknown as HTMLElement
    expect(() => owner.animate(slot, surface, [], {})).toThrow('unavailable')
    expect(slot.getAttribute('data-am-grid-moving')).toBeNull()
    owner.retain(slot)
    owner.interrupt()
    expect(slot.getAttribute('data-am-grid-moving')).toBe('')
    owner.prune(new Set())
    expect(slot.getAttribute('data-am-grid-moving')).toBeNull()
  })
})
