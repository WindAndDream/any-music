import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick, shallowRef } from 'vue'

import RemoteImage from '../../../src/components/music-sources/RemoteImage.vue'
import {
  provideRemoteImageResolver,
  type RemoteImageLease,
} from '../../../src/composables/use-remote-image'
import {
  dispatchCatalogEvent,
  findCatalogElement,
  mountCatalogComponent,
} from './catalog-test-renderer'

beforeEach(() => vi.stubGlobal('IntersectionObserver', undefined))
afterEach(() => vi.unstubAllGlobals())
describe('remote image resource lifetime', () => {
  it('preserves no-referrer and the accessible failure placeholder without a cache port', async () => {
    const view = mountCatalogComponent(RemoteImage, {
      src: 'https://example.com/cover.jpg',
      alt: '歌曲封面',
    })
    const image = findCatalogElement(view.root, (node) => node.tag === 'img')
    expect(image.props.referrerpolicy).toBe('no-referrer')
    expect(image.props.src).toBe('https://example.com/cover.jpg')
    expect(image.props.style).toEqual({ visibility: 'hidden' })
    dispatchCatalogEvent(image, 'onLoad')
    await nextTick()
    expect(image.props.style).toEqual({ visibility: undefined })
    dispatchCatalogEvent(image, 'onError')
    await nextTick()
    expect(
      findCatalogElement(view.root, (node) => node.props.role === 'img').props['aria-label'],
    ).toBe('歌曲封面加载失败')
    view.unmount()
  })
  it('cancels obsolete work, rejects late leases and releases the active Blob on unmount', async () => {
    const src = shallowRef('first')
    const pending = new Map<string, (lease: RemoteImageLease) => void>()
    const signals = new Map<string, AbortSignal | undefined>()
    const resolve = vi.fn((url: string, signal?: AbortSignal) => {
      signals.set(url, signal)
      return new Promise<RemoteImageLease>((finish) => pending.set(url, finish))
    })
    const view = mountCatalogComponent(
      defineComponent({
        setup() {
          provideRemoteImageResolver(resolve)
          return () => h(RemoteImage, { src: src.value, alt: '封面', loading: 'eager' })
        },
      }),
      {},
    )
    await nextTick()
    src.value = 'second'
    await nextTick()
    expect(signals.get('first')?.aborted).toBe(true)
    const releaseFirst = vi.fn()
    const releaseSecond = vi.fn()
    pending.get('second')!({ url: 'blob:second', release: releaseSecond })
    await nextTick()
    await nextTick()
    pending.get('first')!({ url: 'blob:first', release: releaseFirst })
    await nextTick()
    await nextTick()
    expect(findCatalogElement(view.root, (node) => node.tag === 'img').props.src).toBe(
      'blob:second',
    )
    expect(releaseFirst).toHaveBeenCalledOnce()
    view.unmount()
    expect(releaseSecond).toHaveBeenCalledOnce()
    expect(signals.get('second')?.aborted).toBe(true)
  })
  it('does not read bytes before lazy intersection and falls back only once on resource failure', async () => {
    let intersect!: (entries: { isIntersecting: boolean }[]) => void
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        constructor(callback: typeof intersect) {
          intersect = callback
        }
        observe() {}
        disconnect() {}
      },
    )
    const release = vi.fn()
    const resolve = vi.fn(async () => ({ url: 'blob:cached', release }))
    const view = mountCatalogComponent(
      defineComponent({
        setup() {
          provideRemoteImageResolver(resolve)
          return () => h(RemoteImage, { src: 'https://example.com/original.jpg', alt: '封面' })
        },
      }),
      {},
    )
    await nextTick()
    expect(resolve).not.toHaveBeenCalled()
    intersect([{ isIntersecting: true }])
    await nextTick()
    await nextTick()
    const image = findCatalogElement(view.root, (node) => node.tag === 'img')
    expect(image.props.src).toBe('blob:cached')
    dispatchCatalogEvent(image, 'onError')
    await nextTick()
    expect(image.props.src).toBe('https://example.com/original.jpg')
    expect(release).toHaveBeenCalledOnce()
    dispatchCatalogEvent(image, 'onError')
    await nextTick()
    expect(
      findCatalogElement(view.root, (node) => node.props['data-image-state'] === 'error'),
    ).toBeDefined()
    view.unmount()
    expect(release).toHaveBeenCalledOnce()
  })
})
