import type { NativePluginSnapshot } from '@any-music/ui'
import { expect, it, vi } from 'vitest'

import { createNativeCatalogSource } from '../../src/plugin-adapters/native-catalog-source'

const state: NativePluginSnapshot = {
  installId: 'install',
  pluginId: 'org.example.catalog',
  contentHash: 'a'.repeat(64),
  publisher: 'unsigned',
  generation: 1,
  dataGeneration: 1,
  permissionEpoch: 1,
  enabled: true,
  historicalLevel: 'L0',
}
function fixture() {
  const execute = vi.fn(async () => ({
    token: 'output',
    value: {
      items: [
        {
          id: 'one',
          title: 'One',
          artists: [],
          artworkUrl: 'https://example.com/private-path',
          source: {
            pluginId: state.pluginId,
            resourceId: 'one',
            mediaKind: 'audio',
            pageUrl: 'https://example.com',
          },
        },
      ],
      pageNumber: 1,
      pageSize: 20,
      hasMore: false,
    },
  }))
  return {
    execute,
    source: createNativeCatalogSource(
      { snapshot: async () => [], revoke: async () => {}, execute },
      state,
    ),
  }
}
it('lazily requests one native page and excludes all guest-controlled URL loading', async () => {
  const { source, execute } = fixture()
  const listing = source.search({ query: 'one' })
  expect(execute).not.toHaveBeenCalled()
  const page = await listing.pages()[Symbol.asyncIterator]().next()
  expect(execute).toHaveBeenCalledExactlyOnceWith(
    'install',
    'search',
    '{"query":"one","pageNumber":1,"pageSize":20}',
  )
  expect(page.value.items[0]).not.toHaveProperty('artworkUrl')
  expect(page.value.items[0].source).not.toHaveProperty('pageUrl')
  await expect(source.resolveMedia(page.value.items[0])).rejects.toMatchObject({
    code: 'unsupported-operation',
  })
})
it('does no native work after prior cancellation and discards a late page', async () => {
  const { source, execute } = fixture()
  const cancelledPages = source
    .search({ query: 'x' })
    .pages({ cancellation: { isCancelled: () => true, subscribe: () => () => {} } })
  await expect(cancelledPages[Symbol.asyncIterator]().next()).rejects.toMatchObject({
    code: 'operation-cancelled',
  })
  expect(execute).not.toHaveBeenCalled()
  let cancelled = false
  execute.mockImplementationOnce(async () => {
    cancelled = true
    return { token: 'out', value: { items: [], pageNumber: 1, pageSize: 20, hasMore: false } }
  })
  const latePages = source
    .search({ query: 'x' })
    .pages({ cancellation: { isCancelled: () => cancelled, subscribe: () => () => {} } })
  await expect(latePages[Symbol.asyncIterator]().next()).rejects.toMatchObject({
    code: 'operation-cancelled',
  })
})
it.each(['account-a', null])(
  'binds the account choice %s once across lazy pages',
  async (accountId) => {
    const sourceAccount = vi.fn(async () => ({ accountId }))
    const execute = vi.fn(
      async (
        _install: string,
        _command: string,
        input: string,
        _account?: { accountId: string | null },
      ) => {
        const pageNumber = JSON.parse(input).pageNumber
        return {
          token: 'out',
          value: { items: [], pageNumber, pageSize: 20, hasMore: pageNumber === 1 },
        }
      },
    )
    const source = createNativeCatalogSource(
      { snapshot: async () => [], revoke: async () => {}, sourceAccount, execute },
      state,
    )
    const pages = source.search({ query: 'x' }).pages()[Symbol.asyncIterator]()
    expect(sourceAccount).not.toHaveBeenCalled()
    await pages.next()
    sourceAccount.mockResolvedValue({ accountId: 'account-b' })
    expect(execute).toHaveBeenCalledTimes(1)
    await pages.next()
    expect(sourceAccount).toHaveBeenCalledTimes(1)
    expect(execute.mock.calls.map((call) => call[3])).toEqual([{ accountId }, { accountId }])
  },
)
