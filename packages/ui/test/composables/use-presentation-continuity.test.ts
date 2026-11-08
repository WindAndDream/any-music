import { afterEach, describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick, shallowRef } from 'vue'

import { usePresentationContinuity } from '../../src/composables/use-presentation-continuity'
import { getPresentationContinuity } from '../../src/product/presentation-continuity'

/** Deliberate box/focus injection; this is not native layout or accessibility evidence. */
class ContinuityElement extends EventTarget {
  dataset: Record<string, string> = {}
  parent: ContinuityElement | undefined
  children: ContinuityElement[] = []
  isConnected = true
  hidden = false
  visible = true
  scrollTop = 0
  scrollHeight = 200_000
  clientHeight = 200
  clientTop = 0
  top = 0
  height = 100
  attrs = new Map<string, string>()
  readonly ownerDocument: Document
  focus = vi.fn(() => Object.assign(this.ownerDocument, { activeElement: this }))
  constructor(document: Document, parent?: ContinuityElement) {
    super()
    this.ownerDocument = document
    this.parent = parent
    parent?.children.push(this)
  }
  getBoundingClientRect() {
    return {
      top: this.top,
      bottom: this.top + this.height,
      height: this.height,
      width: 600,
    } as DOMRect
  }
  getClientRects() {
    return this.visible ? [this.getBoundingClientRect()] : []
  }
  getRootNode() {
    return this.ownerDocument
  }
  contains(target: ContinuityElement): boolean {
    return target === this || this.children.some((child) => child.contains(target))
  }
  hasAttribute(key: string) {
    return this.attrs.has(key)
  }
  getAttribute(key: string) {
    return this.attrs.get(key) ?? null
  }
  setAttribute(key: string, value: string) {
    this.attrs.set(key, value)
    if (key === 'data-am-continuity-key') this.dataset.amContinuityKey = value
  }
  removeAttribute(key: string) {
    this.attrs.delete(key)
    if (key === 'data-am-continuity-key') delete this.dataset.amContinuityKey
  }
  closest<T extends Element>(selector: string): T | null {
    if (selector.includes('hidden') && this.hidden) return this as unknown as T
    if (selector === '[data-am-continuity-item]' && this.dataset.amContinuityItem)
      return this as unknown as T
    return this.parent?.closest<T>(selector) ?? null
  }
  querySelectorAll<T extends Element>(selector: string): T[] {
    const key = selector === '[data-am-continuity-item]' ? 'amContinuityItem' : 'amFocusKey'
    return this.children.flatMap((child) => [
      ...(child.dataset[key] ? [child as unknown as T] : []),
      ...child.querySelectorAll<T>(selector),
    ])
  }
  element() {
    return this as unknown as HTMLElement
  }
}
afterEach(() => vi.unstubAllGlobals())

function setup(virtual = true) {
  vi.stubGlobal('HTMLElement', ContinuityElement)
  const document = {
    activeElement: null,
    defaultView: { getComputedStyle: () => ({ visibility: 'visible' }) },
  } as unknown as Document
  const root = new ContinuityElement(document),
    list = new ContinuityElement(document, root)
  const element = shallowRef(list.element()),
    scroll = shallowRef(root.element()),
    revision = shallowRef(0)
  const size = shallowRef(40)
  let mounted: ContinuityElement | undefined
  let requested = ''
  const release = vi.fn()
  const releaseRestore = vi.fn()
  const retain = vi.fn((key: string) => {
    requested = key
    return release
  })
  const refresh = vi.fn(() => {
    if (!virtual) return
    // Mount only after scroll has selected a new logical window, as the grid does.
    void nextTick(() => {
      const key = requested || String(Math.floor((root.scrollTop - 24) / size.value))
      if (mounted?.dataset.amContinuityItem === key) return
      list.children = []
      mounted = new ContinuityElement(document, list)
      mounted.dataset.amContinuityItem = key
      const play = new ContinuityElement(document, mounted)
      play.dataset.amFocusKey = `track:${key}:play`
    })
  })
  const scope = effectScope()
  const result = scope.run(() =>
    usePresentationContinuity({
      element,
      region: 'favorites:tracks',
      scrollElement: scroll,
      revision,
      geometry: virtual
        ? () => ({
            listOffset: 24,
            findItemAtOffset: (offset) => ({
              key: String(Math.floor(Math.max(0, offset) / size.value)),
              start: Math.floor(Math.max(0, offset) / size.value) * size.value,
            }),
            indexOf: (key) => (Number(key) < 1_000 ? Number(key) : undefined),
            getItem: (index) => ({ start: index * size.value }),
          })
        : undefined,
      refresh,
      retain: virtual ? retain : undefined,
      beforeRestore: () => releaseRestore,
    }),
  )!
  return {
    root,
    list,
    element,
    scroll,
    document,
    size,
    revision,
    result,
    release,
    releaseRestore,
    retain,
    refresh,
    scope,
    adapter: () => getPresentationContinuity(element.value)!,
    control: () => mounted!.children[0]!,
  }
}

describe('semantic presentation continuity', () => {
  it('mounts a distant occurrence before focusing and realigns against new natural geometry', async () => {
    const test = setup()
    await nextTick()
    const restore = test.adapter().restore(
      {
        anchor: { key: '900', offset: 13 },
        focus: { itemKey: '900', controlKey: 'track:900:play' },
      },
      new AbortController().signal,
    )
    expect(test.root.scrollTop).toBe(36_037)
    test.size.value = 60
    expect(await restore).toBe(true)
    expect(test.root.scrollTop).toBe(54_037)
    expect(test.control().focus).toHaveBeenCalledWith({ preventScroll: true })
    expect(test.retain).toHaveBeenCalledOnce()
    expect(test.release).toHaveBeenCalledOnce()
    expect(test.releaseRestore).toHaveBeenCalledOnce()
    test.scope.stop()
    expect(getPresentationContinuity(test.element.value)).toBeUndefined()
  })

  it.each([
    'abort',
    'wheel',
    'scroll',
    'scroll-before-event',
    'replace',
    'revision',
    'hidden',
    'zero-layout',
    'dispose',
    'newer',
  ])('cancels stale mounting/focus after %s', async (reason) => {
    const test = setup()
    await nextTick()
    const aborter = new AbortController()
    const job = test.adapter().restore(
      {
        anchor: { key: '900', offset: 13 },
        focus: { itemKey: '900', controlKey: 'track:900:play' },
      },
      aborter.signal,
    )
    if (reason === 'abort') aborter.abort()
    if (reason === 'wheel') test.root.dispatchEvent(new Event('wheel'))
    if (reason === 'scroll') {
      test.root.scrollTop += 8
      test.root.dispatchEvent(new Event('scroll'))
    }
    if (reason === 'scroll-before-event') test.root.scrollTop += 8
    if (reason === 'replace') test.element.value = new ContinuityElement(test.document).element()
    if (reason === 'revision') test.revision.value++
    if (reason === 'hidden') test.root.hidden = true
    if (reason === 'zero-layout') test.root.visible = false
    if (reason === 'dispose') test.scope.stop()
    if (reason === 'newer') test.result.cancel()
    expect(await job).toBe(false)
    expect(test.control().focus).not.toHaveBeenCalled()
    expect(test.release).toHaveBeenCalledOnce()
    expect(test.releaseRestore).toHaveBeenCalledOnce()
    test.scope.stop()
  })

  it('translates stable keys and intra-item offsets through different native row positions', async () => {
    const test = setup(false)
    const first = new ContinuityElement(test.document, test.list)
    first.dataset.amContinuityItem = '900'
    first.top = -13
    const play = new ContinuityElement(test.document, first)
    play.dataset.amFocusKey = 'track:900:play'
    play.focus()
    await nextTick()
    const snapshot = test.adapter().capture()!
    expect(snapshot.anchor).toEqual({ key: '900', offset: 13 })
    test.root.scrollTop = 1_000
    first.getBoundingClientRect = () =>
      ({ top: 54_024 - test.root.scrollTop, bottom: 54_084 - test.root.scrollTop }) as DOMRect
    expect(await test.adapter().restore(snapshot, new AbortController().signal)).toBe(true)
    expect(test.root.scrollTop).toBe(54_037)
    expect(play.focus).toHaveBeenCalledTimes(2)
    test.scope.stop()
  })

  it('scrolls and mounts a focus-only target before preventScroll focus', async () => {
    const test = setup()
    await nextTick()
    expect(
      await test
        .adapter()
        .restore(
          { focus: { itemKey: '900', controlKey: 'track:900:play' } },
          new AbortController().signal,
        ),
    ).toBe(true)
    expect(test.root.scrollTop).toBe(36_024)
    expect(test.control().focus).toHaveBeenCalledOnce()
    test.scope.stop()
  })

  it.each([
    'ready',
    'abort',
    'dispose',
    'revision',
    'root',
    'manual-scroll',
    'scroll-before-event',
    'wheel',
    'hidden',
  ])('waits for a delayed renderer bridge and releases its watcher on %s', async (reason) => {
    const test = setup()
    const delegate = shallowRef<ReturnType<typeof getPresentationContinuity>>()
    const scope = effectScope()
    scope.run(() =>
      usePresentationContinuity({
        element: test.element,
        region: 'favorites:tracks',
        scrollElement: test.scroll,
        delegate: () => delegate.value,
        waitForDelegate: () => true,
        revision: test.revision,
      }),
    )
    await nextTick()
    const restore = vi.fn(async () => true)
    const aborter = new AbortController()
    const pending = getPresentationContinuity(test.element.value)!.restore(
      { anchor: { key: '900', offset: 13 } },
      aborter.signal,
    )
    await nextTick()
    expect(restore).not.toHaveBeenCalled()
    if (reason === 'abort') aborter.abort()
    if (reason === 'dispose') scope.stop()
    if (reason === 'revision') test.revision.value++
    if (reason === 'root') test.scroll.value = new ContinuityElement(test.document).element()
    if (reason === 'manual-scroll') {
      test.root.scrollTop += 7
      test.root.dispatchEvent(new Event('scroll'))
    }
    if (reason === 'scroll-before-event') test.root.scrollTop += 7
    if (reason === 'wheel') test.root.dispatchEvent(new Event('wheel'))
    if (reason === 'hidden') test.root.hidden = true
    if (reason === 'revision' || reason === 'root') await nextTick()
    delegate.value = { capture: () => undefined, restore }
    expect(await pending).toBe(reason === 'ready')
    expect(restore).toHaveBeenCalledTimes(reason === 'ready' ? 1 : 0)
    scope.stop()
    test.scope.stop()
  })
})
