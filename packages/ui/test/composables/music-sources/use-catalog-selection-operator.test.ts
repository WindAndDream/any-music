import { describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick, shallowRef } from 'vue'

import { useCatalogSelectionOperator } from '../../../src/composables/music-sources/use-catalog-selection-operator'

describe('useCatalogSelectionOperator', () => {
  it('opens only explicitly, stays open with no selection and clears selection on close', async () => {
    const scope = effectScope()
    const open = shallowRef(false)
    const selected = shallowRef<string[]>([])
    const clearSelection = vi.fn(() => {
      selected.value = []
    })
    scope.run(() => useCatalogSelectionOperator({ context: 'tracks', open, clearSelection }))
    selected.value = ['one']
    await nextTick()
    expect(open.value).toBe(false)
    open.value = true
    selected.value = []
    await nextTick()
    expect(open.value).toBe(true)
    selected.value = ['two']
    open.value = false
    expect(selected.value).toEqual([])
    expect(clearSelection).toHaveBeenCalledOnce()
    await nextTick()
    expect(open.value).toBe(false)
    scope.stop()
  })

  it('retains an explicit mode across presentation replacement without clearing on unmount', () => {
    const open = shallowRef(true)
    const clearSelection = vi.fn()
    const mount = () => {
      const scope = effectScope()
      scope.run(() => useCatalogSelectionOperator({ context: 'tracks', open, clearSelection }))
      return scope
    }
    const first = mount()
    first.stop()
    const second = mount()
    expect(open.value).toBe(true)
    expect(clearSelection).not.toHaveBeenCalled()
    second.stop()
    open.value = false
    expect(clearSelection).not.toHaveBeenCalled()
  })

  it('leaves selection mode on a context change and disposes its watchers', () => {
    const scope = effectScope()
    const context = shallowRef<string | undefined>('drawers')
    const open = shallowRef(true)
    const clearSelection = vi.fn()
    scope.run(() => useCatalogSelectionOperator({ context, open, clearSelection }))
    context.value = 'drawer:1'
    expect(open.value).toBe(false)
    expect(clearSelection).toHaveBeenCalledOnce()
    open.value = true
    context.value = undefined
    expect(open.value).toBe(false)
    scope.stop()
    open.value = true
    context.value = 'drawers'
    expect(open.value).toBe(true)
    expect(clearSelection).toHaveBeenCalledTimes(2)
  })
})
