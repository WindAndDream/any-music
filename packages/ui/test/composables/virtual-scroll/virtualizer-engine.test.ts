import { useVirtualizer } from '@tanstack/vue-virtual'
import { describe, expect, it, vi } from 'vitest'
import { computed, effectScope, nextTick, shallowRef } from 'vue'

describe('selected Vue virtualizer integration', () => {
  it('accepts reactive stable keys and list offset, bounds its range, disables and cleans injected observers', async () => {
    const keys = shallowRef(Array.from({ length: 1_000 }, (_, index) => `occurrence:${index}`))
    const enabled = shallowRef(true)
    const root = {
      ownerDocument: { defaultView: null },
      scrollHeight: 20_060,
      clientHeight: 100,
      scrollTop: 60,
    } as unknown as HTMLElement
    const stopRect = vi.fn(),
      stopOffset = vi.fn()
    const scope = effectScope()
    const virtualizer = scope.run(() =>
      useVirtualizer<HTMLElement, HTMLElement>(
        computed(() => ({
          count: keys.value.length,
          enabled: enabled.value,
          getScrollElement: () => root,
          getItemKey: (index: number) => keys.value[index]!,
          estimateSize: () => 20,
          scrollMargin: 60,
          observeElementRect: (_instance, notify) => {
            notify({ width: 500, height: 100 })
            return stopRect
          },
          observeElementOffset: (_instance, notify) => {
            notify(60, false)
            return stopOffset
          },
          scrollToFn: vi.fn(),
        })),
      ),
    )!
    try {
      const items = virtualizer.value.getVirtualItems()
      expect(items.length).toBeGreaterThan(0)
      expect(items.length).toBeLessThanOrEqual(7)
      expect(items[0]?.key).toBe('occurrence:0')
      expect(items[0]?.start).toBe(60)
      expect(virtualizer.value.getTotalSize()).toBe(20_000)
      keys.value = keys.value.toReversed()
      await nextTick()
      expect(virtualizer.value.options.getItemKey(0)).toBe('occurrence:999')
      enabled.value = false
      await nextTick()
      expect(virtualizer.value.getVirtualItems()).toEqual([])
      expect(stopRect).toHaveBeenCalledOnce()
      expect(stopOffset).toHaveBeenCalledOnce()
    } finally {
      scope.stop()
    }
    expect(stopRect).toHaveBeenCalledOnce()
    expect(stopOffset).toHaveBeenCalledOnce()
  })
})
