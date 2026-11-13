import { describe, expect, it, vi } from 'vitest'

import { retainNativeScrollAnchor } from '../../src/composables/native-scroll-anchor'

function createRoot(initial = '', initialPriority = '') {
  const declarations = new Map<string, { value: string; priority: string }>()
  if (initial) declarations.set('overflow-anchor', { value: initial, priority: initialPriority })
  const style = {
    getPropertyValue: (name: string) => declarations.get(name)?.value ?? '',
    getPropertyPriority: (name: string) => declarations.get(name)?.priority ?? '',
    setProperty: vi.fn((name: string, value: string, priority = '') => {
      declarations.set(name, { value, priority })
    }),
    removeProperty: vi.fn((name: string) => {
      const previous = declarations.get(name)?.value ?? ''
      declarations.delete(name)
      return previous
    }),
  }
  return { root: { style } as unknown as HTMLElement, style }
}

describe('native scroll anchor leases (Node style fixture; no browser anchoring)', () => {
  it('keeps a shared root suppressed until its final independent owner releases it', () => {
    const { root, style } = createRoot('auto', 'important')
    const releasePresentation = retainNativeScrollAnchor(root)
    const releaseDrag = retainNativeScrollAnchor(root)
    expect(style.setProperty).toHaveBeenCalledExactlyOnceWith('overflow-anchor', 'none')
    releasePresentation()
    expect(style.getPropertyValue('overflow-anchor')).toBe('none')
    expect(style.removeProperty).not.toHaveBeenCalled()
    releaseDrag()
    expect(style.getPropertyValue('overflow-anchor')).toBe('auto')
    expect(style.getPropertyPriority('overflow-anchor')).toBe('important')
  })

  it('makes duplicate releases harmless while another owner still holds the root', () => {
    const { root, style } = createRoot('auto')
    const releaseFirst = retainNativeScrollAnchor(root)
    const releaseSecond = retainNativeScrollAnchor(root)
    releaseFirst()
    releaseFirst()
    expect(style.getPropertyValue('overflow-anchor')).toBe('none')
    expect(style.setProperty).toHaveBeenCalledTimes(1)
    releaseSecond()
    releaseSecond()
    expect(style.setProperty).toHaveBeenCalledTimes(2)
    expect(style.getPropertyValue('overflow-anchor')).toBe('auto')
  })

  it.each([
    ['auto', ''],
    ['auto', 'important'],
    ['none', 'important'],
  ])('restores the original %s declaration and priority %s', (value, priority) => {
    const { root, style } = createRoot(value, priority)
    const release = retainNativeScrollAnchor(root)
    expect(style.getPropertyValue('overflow-anchor')).toBe('none')
    release()
    expect(style.setProperty).toHaveBeenLastCalledWith('overflow-anchor', value, priority)
    expect(style.getPropertyValue('overflow-anchor')).toBe(value)
    expect(style.getPropertyPriority('overflow-anchor')).toBe(priority)
  })

  it('removes its temporary declaration when the root originally inherited anchoring', () => {
    const { root, style } = createRoot()
    const release = retainNativeScrollAnchor(root)
    release()
    release()
    expect(style.removeProperty).toHaveBeenCalledExactlyOnceWith('overflow-anchor')
    expect(style.getPropertyValue('overflow-anchor')).toBe('')
    expect(style.getPropertyPriority('overflow-anchor')).toBe('')
  })

  it.each([
    ['auto', 'important'],
    ['none', 'important'],
  ])('preserves an external %s declaration with priority %s', (value, priority) => {
    const { root, style } = createRoot('auto')
    const release = retainNativeScrollAnchor(root)
    style.setProperty('overflow-anchor', value, priority)
    release()
    expect(style.setProperty).toHaveBeenCalledTimes(2)
    expect(style.getPropertyValue('overflow-anchor')).toBe(value)
    expect(style.getPropertyPriority('overflow-anchor')).toBe(priority)
  })

  it('preserves an external removal instead of restoring the captured declaration', () => {
    const { root, style } = createRoot('auto', 'important')
    const release = retainNativeScrollAnchor(root)
    style.removeProperty('overflow-anchor')
    release()
    expect(style.getPropertyValue('overflow-anchor')).toBe('')
    expect(style.setProperty).toHaveBeenCalledTimes(1)
  })

  it('starts a fresh lifetime after the last release and rejects stale duplicate releases', () => {
    const { root, style } = createRoot('auto')
    const releaseOld = retainNativeScrollAnchor(root)
    releaseOld()
    style.setProperty('overflow-anchor', 'none', 'important')
    const releaseCurrent = retainNativeScrollAnchor(root)
    releaseOld()
    expect(style.getPropertyValue('overflow-anchor')).toBe('none')
    expect(style.getPropertyPriority('overflow-anchor')).toBe('')
    releaseCurrent()
    expect(style.getPropertyValue('overflow-anchor')).toBe('none')
    expect(style.getPropertyPriority('overflow-anchor')).toBe('important')
  })

  it('keeps different scroll roots independent', () => {
    const first = createRoot('auto', 'important')
    const second = createRoot()
    const releaseFirst = retainNativeScrollAnchor(first.root)
    const releaseSecond = retainNativeScrollAnchor(second.root)
    releaseFirst()
    expect(first.style.getPropertyValue('overflow-anchor')).toBe('auto')
    expect(second.style.getPropertyValue('overflow-anchor')).toBe('none')
    releaseSecond()
    expect(second.style.getPropertyValue('overflow-anchor')).toBe('')
  })
})
