import { describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick, shallowRef } from 'vue'

import { useCatalogScrollRestoration } from '#workbench/features/music-sources/use-catalog-scroll-restoration'

function createView() {
  const active = shallowRef(true)
  const container = { scrollTop: 360, scrollTo: vi.fn() }
  const scope = effectScope()
  scope.run(() =>
    useCatalogScrollRestoration({
      active,
      container: () => container as unknown as HTMLElement,
    }),
  )
  return { active, container, stop: () => scope.stop() }
}

describe('useCatalogScrollRestoration', () => {
  it('restores the catalog position after visiting another view without scrolling on initial mount', async () => {
    const view = createView()
    await nextTick()
    expect(view.container.scrollTo).not.toHaveBeenCalled()
    view.active.value = false
    await nextTick()
    view.container.scrollTop = 80
    view.active.value = true
    await nextTick()
    await nextTick()
    expect(view.container.scrollTo).toHaveBeenCalledExactlyOnceWith({
      top: 360,
      behavior: 'instant',
    })
    view.stop()
  })

  it.each(['leave', 'dispose'] as const)('cancels pending restoration on %s', async (action) => {
    const view = createView()
    view.active.value = false
    await nextTick()
    view.active.value = true
    await nextTick()
    if (action === 'leave') view.active.value = false
    else view.stop()
    await nextTick()
    expect(view.container.scrollTo).not.toHaveBeenCalled()
    view.stop()
  })
})
