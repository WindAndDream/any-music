import { PluginCallError } from '@any-music/plugin-sdk'
import type { MusicSourceProvider } from '@any-music/plugin-sdk/music'
import { expect, it, vi } from 'vitest'

import { listingFromWire } from '../../src/plugin-adapters/wire-track-listing'

function fixture() {
  const provider: MusicSourceProvider = {
    search: vi.fn(),
    importUrl: vi.fn(),
    nextPage: vi.fn(async () => ({ items: [], pageNumber: 1, pageSize: 1, hasMore: false })),
    close: vi.fn(async () => {}),
    cancel: vi.fn(async () => {}),
    resolveMedia: vi.fn(),
    releaseMedia: vi.fn(),
  }
  const wire = { listingRef: 'ref-1', id: 'list-1', title: 'Listing', expiresAtMs: 1000 }
  return { provider, wire }
}

it('creates verification only from a trusted host callback', async () => {
  const { provider, wire } = fixture(),
    verify = vi.fn(async () => {})
  const listing = listingFromWire(provider, wire, { verify })
  await listing.verify?.()
  expect(verify).toHaveBeenCalledTimes(1)
  expect(wire).not.toHaveProperty('verify')
})
it('unsubscribes and closes after a page failure with AM error mapping', async () => {
  const { provider, wire } = fixture(),
    unsubscribe = vi.fn()
  provider.nextPage = vi.fn(async () => {
    throw new PluginCallError({
      code: 'upstream-error',
      message: 'private message',
      isRetryable: true,
    })
  })
  const pages = listingFromWire(provider, wire).pages({
    cancellation: { isCancelled: () => false, subscribe: () => unsubscribe },
  })
  const iterator = pages[Symbol.asyncIterator]()
  await expect(iterator.next()).rejects.toMatchObject({
    code: 'upstream-error',
    statusCode: 'AM-3002',
  })
  expect(unsubscribe).toHaveBeenCalledTimes(1)
  expect(provider.close).toHaveBeenCalledWith({ listingRef: 'ref-1' })
})
it('does no page work when already cancelled or asked to resume an unsupported page', async () => {
  for (const options of [
    { startPage: 2 },
    { cancellation: { isCancelled: () => true, subscribe: () => () => {} } },
  ]) {
    const { provider, wire } = fixture()
    const iterator = listingFromWire(provider, wire).pages(options)[Symbol.asyncIterator]()
    // Each independent fixture must settle before its cleanup assertions.
    // eslint-disable-next-line no-await-in-loop
    await expect(iterator.next()).rejects.toThrow()
    expect(provider.nextPage).not.toHaveBeenCalled()
    expect(provider.close).toHaveBeenCalledTimes(1)
  }
})
