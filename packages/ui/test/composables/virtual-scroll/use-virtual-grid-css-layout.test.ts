import { describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick, shallowRef } from 'vue'

import {
  readVirtualGridCssLayout,
  useVirtualGridCssLayout,
} from '../../../src/composables/virtual-scroll/use-virtual-grid-css-layout'
import {
  createResizeEnvironment,
  VirtualElement,
} from '../../fixtures/virtual-scroll/resize-observer'

describe('resolved CSS grid layout (injected browser style, no CSS engine)', () => {
  it('keeps its resize subscription while continuous width and density changes read each frame once', async () => {
    const env = createResizeEnvironment()
    const element = new VirtualElement(env.document)
    const width = shallowRef(1000),
      generation = shallowRef('standard')
    const getComputedStyle = vi.fn(() => ({
      gridTemplateColumns: '320px 320px 320px',
      columnGap: '12px',
      rowGap: '12px',
    }))
    Object.assign(env.view, { getComputedStyle })
    const add = vi.spyOn(env.view, 'addEventListener'),
      remove = vi.spyOn(env.view, 'removeEventListener')
    const scope = effectScope()
    const result = scope.run(() =>
      useVirtualGridCssLayout({
        element: element.asElement(),
        width,
        layoutGeneration: generation,
      }),
    )!
    try {
      await nextTick()
      expect(getComputedStyle).toHaveBeenCalledTimes(1)
      const layout = result.layout.value
      for (let frame = 1; frame <= 12; frame++) {
        width.value = 1000 - frame * 10
        generation.value = `font-${frame}`
        // eslint-disable-next-line no-await-in-loop -- Observe each settled resize frame.
        await nextTick()
        expect(getComputedStyle).toHaveBeenCalledTimes(frame + 1)
        expect(result.layout.value).toBe(layout)
      }
      expect(add).toHaveBeenCalledExactlyOnceWith('resize', expect.any(Function))
      expect(remove).not.toHaveBeenCalled()
    } finally {
      scope.stop()
    }
    expect(remove).toHaveBeenCalledExactlyOnceWith('resize', add.mock.calls[0]![1])
    getComputedStyle.mockClear()
    env.view.dispatchEvent(new Event('resize'))
    result.refresh()
    expect(getComputedStyle).not.toHaveBeenCalled()
  })

  it.each([
    ['standard', '300px 300px 300px', '12px', 3],
    ['comfortable', '488px 488px', '12px', 2],
    ['compact', '241px 241px 241px 241px', '12px', 4],
    ['mobile-one', '400px', '12px', 1],
    ['mobile-two', '196px 196px', '8px', 2],
    ['fractional', '200.25px 200.25px', '8.5px', 2],
  ])('reads %s resolved tracks and token gaps', (_name, tracks, gap, columns) => {
    expect(
      readVirtualGridCssLayout({ gridTemplateColumns: tracks, columnGap: gap, rowGap: gap }),
    ).toEqual({ columns, columnGap: Number.parseFloat(gap), rowGap: Number.parseFloat(gap) })
  })

  it('does not let stale cell placements turn implicit zero tracks into explicit columns', async () => {
    const env = createResizeEnvironment()
    const element = new VirtualElement(env.document)
    const width = shallowRef(1600)
    const style = {
      gridTemplateColumns: '300px 300px 300px 300px 300px',
      gridAutoColumns: '0px',
      columnGap: '12px',
      rowGap: '12px',
    }
    Object.assign(env.view, { getComputedStyle: vi.fn(() => style) })
    const scope = effectScope()
    const result = scope.run(() =>
      useVirtualGridCssLayout({ element: element.asElement(), width }),
    )!
    try {
      await nextTick()
      expect(result.layout.value.columns).toBe(5)
      // CSS shrinks its explicit repeat to three columns before Vue can remove the old
      // columnStart=4/5 placements. Resolved styles also serialize those implicit tracks.
      style.gridTemplateColumns = '346.018px 346.018px 346.018px 0px 0px'
      width.value = 1100
      await nextTick()
      expect(result.layout.value.columns).toBe(3)
      style.gridTemplateColumns = '300px 300px 300px 300px 300px'
      width.value = 1600
      await nextTick()
      expect(result.layout.value.columns).toBe(5)
      style.gridTemplateColumns = '520px 520px 0px 0px 0px'
      env.view.dispatchEvent(new Event('resize'))
      expect(result.layout.value.columns).toBe(2)
      style.gridTemplateColumns = '0px 0px'
      env.view.dispatchEvent(new Event('resize'))
      expect(result.layout.value.columns).toBe(2)
    } finally {
      scope.stop()
    }
  })

  it('retains the last usable layout through hidden unresolved styles and cleans up its one view listener', async () => {
    const env = createResizeEnvironment()
    const element = new VirtualElement(env.document)
    const style = { gridTemplateColumns: '250px 250px', columnGap: '12px', rowGap: '12px' }
    const getComputedStyle = vi.fn(() => style)
    Object.assign(env.view, { getComputedStyle })
    const add = vi.spyOn(env.view, 'addEventListener'),
      remove = vi.spyOn(env.view, 'removeEventListener')
    const width = shallowRef(500),
      generation = shallowRef('standard')
    const scope = effectScope()
    const result = scope.run(() =>
      useVirtualGridCssLayout({
        element: element.asElement(),
        width,
        layoutGeneration: generation,
      }),
    )!
    await nextTick()
    expect(result.layout.value.columns).toBe(2)
    expect(add.mock.calls.filter(([event]) => event === 'resize')).toHaveLength(1)
    element.rect.width = 0
    style.gridTemplateColumns = 'none'
    env.view.dispatchEvent(new Event('resize'))
    expect(result.layout.value.columns).toBe(2)
    element.rect.width = 500
    env.view.dispatchEvent(new Event('resize'))
    expect(result.layout.value.columns).toBe(2)
    style.gridTemplateColumns = '500px'
    env.view.dispatchEvent(new Event('resize'))
    expect(result.layout.value.columns).toBe(1)
    generation.value = 'compact'
    style.gridTemplateColumns = '160px 160px 160px'
    await nextTick()
    expect(result.layout.value.columns).toBe(3)
    scope.stop()
    expect(add.mock.calls.filter(([event]) => event === 'resize')).toHaveLength(
      remove.mock.calls.filter(([event]) => event === 'resize').length,
    )
    getComputedStyle.mockClear()
    env.view.dispatchEvent(new Event('resize'))
    result.refresh()
    expect(getComputedStyle).not.toHaveBeenCalled()
  })

  it('declines hidden tracks and rejects unsupported non-pixel layouts instead of full mounting', () => {
    expect(
      readVirtualGridCssLayout({
        gridTemplateColumns: 'none',
        rowGap: 'normal',
        columnGap: 'normal',
      }),
    ).toBeUndefined()
    expect(
      readVirtualGridCssLayout({
        gridTemplateColumns: '250px',
        rowGap: 'normal',
        columnGap: 'normal',
      }),
    ).toEqual({ columns: 1, rowGap: 0, columnGap: 0 })
    expect(() =>
      readVirtualGridCssLayout({
        gridTemplateColumns: 'repeat(2, 1fr)',
        rowGap: '12px',
        columnGap: '12px',
      }),
    ).toThrow()
  })
})
