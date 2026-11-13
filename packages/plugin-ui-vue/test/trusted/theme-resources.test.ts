import { registerPresentationContinuity } from '@any-music/ui/theme'
import { afterEach, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'

import { createThemeResources } from '../../src/trusted/theme-resources'

class ElementFixture extends EventTarget {
  dataset: Record<string, string> = {}
  textContent = ''
  scrollTop = 0
  scrollLeft = 0
  scrollHeight = 1000
  clientHeight = 100
  scrollWidth = 1000
  clientWidth = 100
  media = ''
  isConnected = true
  visibility = 'visible'
  ownerDocument = {
    defaultView: {
      getComputedStyle: (element: ElementFixture) => ({ visibility: element.visibility }),
    },
  }
  focus = vi.fn()
  remove = vi.fn()
  closest = (_selector: string): ElementFixture | null => null
  getClientRects = () => [{}]
}
afterEach(() => vi.unstubAllGlobals())

it.each(['wheel', 'scroll', 'abort'])(
  'lets %s before the replacement callback cancel stale pixel and semantic restoration',
  async (reason) => {
    vi.stubGlobal('HTMLElement', ElementFixture)
    const region = new ElementFixture(),
      scroll = new ElementFixture()
    region.dataset.amContinuityKey = 'favorites:tracks'
    scroll.dataset.amScrollKey = 'workspace'
    scroll.scrollTop = 120
    const root = Object.assign(new ElementFixture(), {
      getRootNode: () => ({ activeElement: null }),
      querySelectorAll: (selector: string) =>
        selector === '[data-am-scroll-key]'
          ? [scroll]
          : selector === '[data-am-continuity-key]'
            ? [region]
            : [],
    }) as unknown as HTMLElement
    const semanticRestore = vi.fn(async () => true)
    const unregister = registerPresentationContinuity(region as unknown as Element, {
      capture: () => ({ anchor: { key: '900', offset: 13 } }),
      restore: semanticRestore,
    })
    const controller = new AbortController()
    const restore = createThemeResources(() => root).capture(controller.signal)
    scroll.scrollTop = 240
    if (reason === 'abort') controller.abort()
    else {
      const event = new Event(reason)
      Object.defineProperty(event, 'target', { value: scroll })
      root.dispatchEvent(event)
    }
    await restore()
    expect(scroll.scrollTop).toBe(240)
    expect(semanticRestore).not.toHaveBeenCalled()
    unregister()
  },
)

it('does not let a successful unrelated anchor suppress fallback for a failed focused region', async () => {
  vi.stubGlobal('HTMLElement', ElementFixture)
  const original = new ElementFixture(),
    replacement = new ElementFixture()
  original.dataset.amFocusKey = replacement.dataset.amFocusKey = 'track:900:play'
  const platforms = new ElementFixture(),
    tracks = new ElementFixture()
  platforms.dataset.amContinuityKey = 'favorites:platforms'
  tracks.dataset.amContinuityKey = 'favorites:tracks'
  const unregister = [
    registerPresentationContinuity(platforms as unknown as Element, {
      capture: () => ({ anchor: { key: 'source', offset: 0 } }),
      restore: async () => true,
    }),
    registerPresentationContinuity(tracks as unknown as Element, {
      capture: () => ({ focus: { itemKey: '900', controlKey: 'track:900:play' } }),
      restore: async () => false,
    }),
  ]
  const root = {
    getRootNode: () => ({ activeElement: original }),
    contains: () => true,
    querySelectorAll: (selector: string) =>
      selector === '[data-am-continuity-key]'
        ? [platforms, tracks]
        : selector === '[data-am-focus-key]'
          ? [replacement]
          : [],
  } as unknown as HTMLElement
  const restore = createThemeResources(() => root).capture()
  original.isConnected = false
  await restore()
  expect(replacement.focus).toHaveBeenCalledOnce()
  unregister.forEach((dispose) => dispose())
})

it.each(['visible', 'inert', 'hidden', 'invisible', 'outside'])(
  'preserves a new modal initial focus only while it belongs to the visible presentation (%s)',
  (state) => {
    vi.stubGlobal('HTMLElement', ElementFixture)
    const original = new ElementFixture()
    const current = new ElementFixture()
    const fallback = new ElementFixture()
    const modal = new ElementFixture()
    let active = original
    current.closest = (selector) =>
      selector.includes('[role=') ? modal : state === 'inert' ? current : null
    if (state === 'hidden') current.getClientRects = () => []
    if (state === 'invisible') current.visibility = 'hidden'
    const root = {
      getRootNode: () => ({
        get activeElement() {
          return active
        },
      }),
      contains: (element: unknown) =>
        element === original ||
        element === fallback ||
        (element === current && state !== 'outside'),
      querySelectorAll: (selector: string) =>
        selector === '[data-am-focus-fallback]' ? [fallback] : [],
    } as unknown as HTMLElement
    const restore = createThemeResources(() => root).capture()
    original.isConnected = false
    active = current
    restore()
    expect(current.focus).not.toHaveBeenCalled()
    expect(fallback.focus).toHaveBeenCalledTimes(state === 'visible' ? 0 : 1)
  },
)

it('restores a semantic region when responsive layouts move its scroll to a nested container', () => {
  vi.stubGlobal('HTMLElement', ElementFixture)
  const outer = new ElementFixture(),
    inner = new ElementFixture()
  outer.dataset.amScrollKey = inner.dataset.amScrollKey = 'workspace'
  outer.scrollHeight = outer.clientHeight
  inner.scrollTop = 120
  inner.scrollLeft = 8
  const root = {
    getRootNode: () => ({ activeElement: null }),
    querySelectorAll: (selector: string) =>
      selector === '[data-am-scroll-key]' ? [outer, inner] : [],
  } as unknown as HTMLElement
  const resources = createThemeResources(() => root)
  const restoreNarrow = resources.capture()
  outer.scrollHeight = 1000
  inner.scrollHeight = inner.clientHeight
  inner.scrollWidth = inner.clientWidth
  inner.scrollTop = inner.scrollLeft = 0
  restoreNarrow()
  expect(outer.scrollTop).toBe(120)
  expect(outer.scrollLeft).toBe(8)
  expect(inner.scrollTop).toBe(0)
  expect(inner.scrollLeft).toBe(0)

  outer.scrollTop = 350
  const restoreWide = resources.capture()
  outer.scrollHeight = outer.clientHeight
  outer.scrollWidth = outer.clientWidth
  outer.scrollTop = outer.scrollLeft = 0
  inner.scrollHeight = inner.scrollWidth = 1000
  restoreWide()
  expect(inner.scrollTop).toBe(350)
  expect(inner.scrollLeft).toBe(8)
  expect(outer.scrollTop).toBe(0)
  expect(outer.scrollLeft).toBe(0)
})

it.each(['shadow', 'embedded'])(
  'owns and releases styles inside the %s product root and restores only keyed focus/scroll',
  async (surface) => {
    vi.stubGlobal('HTMLElement', ElementFixture)
    const original = new ElementFixture(),
      replacement = new ElementFixture(),
      scroll = new ElementFixture()
    const hidden = new ElementFixture()
    const fallback = new ElementFixture()
    hidden.dataset.amFocusKey = 'navigation:queue'
    hidden.getClientRects = () => []
    original.dataset.amFocusKey = replacement.dataset.amFocusKey = 'navigation:queue'
    scroll.dataset.amScrollKey = 'workspace'
    scroll.scrollTop = 120
    scroll.scrollLeft = 8
    const styles: ElementFixture[] = []
    const root = {
      ownerDocument: { createElement: () => new ElementFixture() },
      getRootNode: () => ({ activeElement: original, mode: surface }),
      contains: (node: unknown) =>
        [original, replacement, hidden, fallback].includes(node as ElementFixture),
      append: (style: ElementFixture) => {
        styles.push(style)
        style.remove.mockImplementation(() => {
          styles.splice(styles.indexOf(style), 1)
        })
      },
      querySelectorAll: (selector: string) =>
        selector === '[data-am-scroll-key]'
          ? [scroll]
          : selector === '[data-am-focus-fallback]'
            ? [fallback]
            : [hidden, replacement],
    } as unknown as HTMLElement
    const resources = createThemeResources(() => root)
    const resource = resources.prepare('studio', '.am-theme-studio .studio-navigation {}')
    expect(styles).toHaveLength(1)
    expect(styles[0]?.dataset.amThemeResource).toBe('studio')
    expect(styles[0]?.media).toBe('not all')
    resource.activate()
    expect(styles[0]?.media).toBe('all')
    resource.deactivate()
    expect(styles[0]?.media).toBe('not all')
    const restore = resources.capture()
    original.isConnected = false
    scroll.scrollTop = 0
    scroll.scrollLeft = 0
    resources.afterRender(restore)
    await nextTick()
    expect(replacement.focus).toHaveBeenCalledWith({ preventScroll: true })
    expect(scroll.scrollTop).toBe(120)
    expect(scroll.scrollLeft).toBe(8)
    replacement.dataset.amFocusKey = 'different-layout'
    scroll.scrollHeight = 150
    scroll.scrollWidth = 103
    restore()
    expect(fallback.focus).toHaveBeenCalledWith({ preventScroll: true })
    expect(scroll.scrollTop).toBe(50)
    expect(scroll.scrollLeft).toBe(3)
    resource.dispose()
    resource.dispose()
    expect(styles).toHaveLength(0)
  },
)
