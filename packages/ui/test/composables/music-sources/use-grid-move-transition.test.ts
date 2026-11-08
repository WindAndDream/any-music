import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, KeepAlive, nextTick, shallowRef } from 'vue'

import { useGridMoveTransition } from '../../../src/composables/music-sources/use-grid-move-transition'
import { mountCatalogComponent } from '../../components/music-sources/catalog-test-renderer'

const views: ReturnType<typeof mountCatalogComponent>[] = []
const matchMedia = vi.fn(() => ({ matches: false }))
beforeEach(() => {
  matchMedia.mockReturnValue({ matches: false })
  vi.stubGlobal('window', { matchMedia })
  vi.stubGlobal('getComputedStyle', () => ({
    getPropertyValue: (name: string) => (name === '--am-motion-normal' ? '220ms' : 'ease'),
  }))
})
afterEach(() => {
  for (const view of views.splice(0)) view.unmount()
  vi.unstubAllGlobals()
})

function mountGrid(count = 30) {
  const keys = shallowRef(Array.from({ length: count }, (_, index) => String(index)))
  const layout = shallowRef('standard:1')
  const enabled = shallowRef(true)
  const selected = shallowRef(false)
  const active = shallowRef(true)
  const origin = shallowRef(0)
  const scale = shallowRef(1)
  let renderedKeys = keys.value
  let renderedOrigin = 0
  let renderedScale = 1
  let renderedColumns = 3
  const visualOffsets = new Map<string, { x: number; y: number }>()
  const animations: Animation[] = []
  const reads = vi.fn((id: string) => {
    const index = renderedKeys.indexOf(id)
    const offset = visualOffsets.get(id) ?? { x: 0, y: 0 }
    return {
      left: ((index % renderedColumns) * 100 + offset.x) * renderedScale,
      top: renderedOrigin + (Math.floor(index / renderedColumns) * 100 + offset.y) * renderedScale,
    }
  })
  const animate = vi.fn(function (
    this: { id: string },
    _frames: Keyframe[],
    _options: KeyframeAnimationOptions,
  ) {
    const animation = Object.assign(new EventTarget(), {
      cancel: vi.fn(() => visualOffsets.delete(this.id)),
    }) as unknown as Animation
    animations.push(animation)
    return animation
  })
  const document = Object.assign(new EventTarget(), { visibilityState: 'visible' })
  const children = new Map(
    keys.value.map((id) => [
      id,
      {
        id,
        getBoundingClientRect: () => reads(id),
        animate,
        attributes: new Map<string, string>(),
        getAttribute(name: string) {
          return this.attributes.get(name) ?? null
        },
        setAttribute(name: string, value: string) {
          this.attributes.set(name, value)
        },
        removeAttribute(name: string) {
          this.attributes.delete(name)
        },
      },
    ]),
  )
  const element = {
    animate,
    ownerDocument: document,
    offsetWidth: 400,
    offsetHeight: count * 100,
    getBoundingClientRect: vi.fn(() => ({
      left: 0,
      top: renderedOrigin,
      width: 400 * renderedScale,
      height: count * 100 * renderedScale,
    })),
    get children() {
      return renderedKeys.map((id) => children.get(id)!)
    },
  } as unknown as HTMLElement
  const grid = defineComponent({
    setup() {
      useGridMoveTransition({ element, itemKeys: keys, layoutKey: layout, enabled })
      return () => {
        renderedKeys = keys.value
        renderedOrigin = origin.value
        renderedScale = scale.value
        renderedColumns = layout.value.endsWith(':2')
          ? 2
          : layout.value.startsWith('compact')
            ? 4
            : layout.value.startsWith('comfortable')
              ? 2
              : 3
        return h('div', `${layout.value}:${selected.value}:${enabled.value}`)
      }
    },
  })
  const view = mountCatalogComponent(
    defineComponent({
      setup: () => () => h(KeepAlive, null, { default: () => (active.value ? h(grid) : null) }),
    }),
    {},
  )
  views.push(view)
  return {
    keys,
    layout,
    enabled,
    selected,
    active,
    origin,
    scale,
    reads,
    animate,
    animations,
    visualOffsets,
    element,
    children,
    document,
    view,
  }
}

describe('grid movement measurement budget', () => {
  it('cancels and releases rendering when the owning document becomes hidden', async () => {
    const grid = mountGrid(6)
    grid.keys.value = grid.keys.value.toReversed()
    await nextTick()
    grid.document.visibilityState = 'hidden'
    grid.document.dispatchEvent(new Event('visibilitychange'))
    for (const animation of grid.animations) expect(animation.cancel).toHaveBeenCalledOnce()
    expect([...grid.children.values()].every((x) => !x.attributes.has('data-am-grid-moving'))).toBe(
      true,
    )
  })
  it('releases active animation and rendering protection immediately on reduced motion', async () => {
    const media = Object.assign(new EventTarget(), { matches: false })
    matchMedia.mockReturnValue(media)
    const grid = mountGrid(6)
    grid.keys.value = grid.keys.value.toReversed()
    await nextTick()
    media.matches = true
    media.dispatchEvent(new Event('change'))
    for (const animation of grid.animations) expect(animation.cancel).toHaveBeenCalledOnce()
    expect([...grid.children.values()].every((x) => !x.attributes.has('data-am-grid-moving'))).toBe(
      true,
    )
  })

  it('holds visibility through interruption and ignores completion from an obsolete animation', async () => {
    const grid = mountGrid(6)
    grid.layout.value = 'compact:1'
    await nextTick()
    const source = grid.children.get('3')!
    expect(source.getAttribute('data-am-grid-moving')).toBe('')
    const previous = [...grid.animations]
    grid.visualOffsets.set('3', { x: -150, y: 50 })
    const cancel = vi.mocked(previous[0]!.cancel)
    cancel.mockImplementation(() => {
      expect(source.getAttribute('data-am-grid-moving')).toBe('')
    })
    grid.layout.value = 'comfortable:1'
    await nextTick()
    for (const animation of previous) animation.dispatchEvent(new Event('finish'))
    expect(source.getAttribute('data-am-grid-moving')).toBe('')
    for (const animation of grid.animations.slice(previous.length))
      animation.dispatchEvent(new Event('finish'))
    expect(source.getAttribute('data-am-grid-moving')).toBeNull()
  })

  it('releases rendering protection on animation cancellation and disabled state', async () => {
    const grid = mountGrid(6)
    grid.keys.value = grid.keys.value.toReversed()
    await nextTick()
    expect([...grid.children.values()].some((x) => x.attributes.has('data-am-grid-moving'))).toBe(
      true,
    )
    for (const animation of grid.animations) animation.dispatchEvent(new Event('cancel'))
    expect([...grid.children.values()].every((x) => !x.attributes.has('data-am-grid-moving'))).toBe(
      true,
    )
    grid.keys.value = grid.keys.value.toReversed()
    await nextTick()
    grid.enabled.value = false
    expect([...grid.children.values()].every((x) => !x.attributes.has('data-am-grid-moving'))).toBe(
      true,
    )
  })
  it.each([30, 200])(
    'animates density and column changes with two read batches for %i songs',
    async (count) => {
      const grid = mountGrid(count)
      for (const layout of ['compact:1', 'comfortable:1', 'standard:1', 'standard:2']) {
        grid.reads.mockClear()
        vi.mocked(grid.element.getBoundingClientRect).mockClear()
        grid.animate.mockClear()
        grid.layout.value = layout
        grid.keys.value = [...grid.keys.value]
        // eslint-disable-next-line no-await-in-loop -- Each display setting must commit before checking the next change.
        await nextTick()
        expect(grid.reads).toHaveBeenCalledTimes(count * 2)
        expect(grid.element.getBoundingClientRect).toHaveBeenCalledTimes(2)
        expect(grid.animate).toHaveBeenCalled()
        expect(grid.animate.mock.invocationCallOrder[0]).toBeGreaterThan(
          grid.reads.mock.invocationCallOrder.at(-1)!,
        )
      }
      grid.reads.mockClear()
      vi.mocked(grid.element.getBoundingClientRect).mockClear()
      grid.animate.mockClear()
      grid.selected.value = true
      grid.keys.value = [...grid.keys.value]
      await nextTick()
      expect(grid.reads).not.toHaveBeenCalled()
      expect(grid.element.getBoundingClientRect).not.toHaveBeenCalled()
      expect(grid.animate).not.toHaveBeenCalled()
    },
  )

  it('batches position reads for real ordering changes and retains the theme timing', async () => {
    const grid = mountGrid()
    grid.keys.value = grid.keys.value.toReversed()
    await nextTick()
    expect(grid.reads).toHaveBeenCalledTimes(60)
    expect(grid.animate).toHaveBeenCalledTimes(30)
    expect(grid.animate.mock.invocationCallOrder[0]).toBeGreaterThan(
      grid.reads.mock.invocationCallOrder.at(-1)!,
    )
    expect(grid.animate).toHaveBeenCalledWith(
      [{ transform: 'translate(200px, 900px)' }, { transform: 'translate(0, 0)' }],
      { duration: 220, easing: 'ease' },
    )
  })

  it('continues rapid display changes from the current animated position before canceling old motion', async () => {
    const grid = mountGrid(6)
    grid.layout.value = 'compact:1'
    await nextTick()
    const previousAnimations = [...grid.animations]
    grid.visualOffsets.set('3', { x: -150, y: 50 })
    grid.reads.mockClear()
    grid.animate.mockClear()
    grid.layout.value = 'comfortable:1'
    await nextTick()
    expect(grid.reads).toHaveBeenCalledTimes(12)
    for (const animation of previousAnimations) {
      expect(animation.cancel).toHaveBeenCalledOnce()
      expect(vi.mocked(animation.cancel).mock.invocationCallOrder[0]).toBeGreaterThan(
        grid.reads.mock.invocationCallOrder[5]!,
      )
    }
    const index = grid.animate.mock.contexts.findIndex((context) => context.id === '3')
    expect(grid.animate.mock.calls[index]).toEqual([
      [{ transform: 'translate(50px, -50px)' }, { transform: 'translate(0, 0)' }],
      { duration: 220, easing: 'ease' },
    ])
  })

  it('skips redundant movement during drag settling and reduced motion', async () => {
    const grid = mountGrid()
    grid.enabled.value = false
    grid.layout.value = 'compact:1'
    grid.keys.value = grid.keys.value.toReversed()
    await nextTick()
    grid.enabled.value = true
    matchMedia.mockReturnValue({ matches: true })
    grid.layout.value = 'comfortable:2'
    grid.keys.value = grid.keys.value.toReversed()
    await nextTick()
    expect(grid.reads).not.toHaveBeenCalled()
    expect(grid.animate).not.toHaveBeenCalled()
  })

  it('releases animations on page deactivation and unmount', async () => {
    const grid = mountGrid()
    grid.keys.value = grid.keys.value.toReversed()
    await nextTick()
    grid.active.value = false
    await nextTick()
    for (const animation of grid.animations) expect(animation.cancel).toHaveBeenCalledOnce()
    grid.animations.length = 0
    grid.active.value = true
    await nextTick()
    grid.keys.value = grid.keys.value.toReversed()
    await nextTick()
    grid.view.unmount()
    views.splice(views.indexOf(grid.view), 1)
    for (const animation of grid.animations) expect(animation.cancel).toHaveBeenCalledOnce()
  })

  it('keeps movement in local coordinates when the grid scrolls or scales', async () => {
    const grid = mountGrid(2)
    grid.keys.value = grid.keys.value.toReversed()
    grid.origin.value = 500
    grid.scale.value = 2
    await nextTick()
    expect(grid.animate).toHaveBeenCalledWith(
      [{ transform: 'translate(-100px, 0px)' }, { transform: 'translate(0, 0)' }],
      { duration: 220, easing: 'ease' },
    )
  })
})
