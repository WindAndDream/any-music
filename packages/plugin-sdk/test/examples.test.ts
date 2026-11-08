import { expect, it } from 'vitest'

import { readPublicTrackPage } from '../examples/public-page.ts'
import { summarizeTitles } from '../examples/title-summary/main.ts'
import type { CommandContext } from '../src/index.ts'
import { createSdkOnlyHost } from './fixtures/sdk-only-host.ts'
const context: CommandContext = {
  contextRef: 'ctx-1',
  scope: { sections: ['catalog'], forms: ['desktop'] },
  objectRefs: [],
  expiresAtMs: 30000,
}

it('runs the minimal command against the SDK-only host with an optional denied write', async () => {
  const { host, setWriteAllowed } = createSdkOnlyHost('')
  setWriteAllowed(false)
  await expect(summarizeTitles(context, [], host, true)).rejects.toMatchObject({
    detail: { code: 'access-denied' },
  })
  await expect(summarizeTitles(context, [], host, false)).resolves.toMatchObject({
    nodes: [{ type: 'text', text: 'No tracks selected' }],
  })
  setWriteAllowed(true)
  await summarizeTitles(context, [], host, true)
  await expect(host.state.get({ key: 'last-summary' })).resolves.toEqual({
    value: 'No tracks selected',
    version: 1,
  })
})
it('uses only the public network port and releases responses on success and malformed data', async () => {
  const fixture = createSdkOnlyHost('{"items":[],"pageNumber":1,"pageSize":1,"hasMore":false}')
  fixture.setNetworkAllowed(false)
  await expect(readPublicTrackPage(fixture.host, 'https://example.com/page')).rejects.toMatchObject(
    { detail: { code: 'access-denied' } },
  )
  fixture.setNetworkAllowed(true)
  await expect(
    readPublicTrackPage(fixture.host, 'https://example.com/page'),
  ).resolves.toMatchObject({ items: [] })
  expect(fixture.released()).toBe(1)
  const invalid = createSdkOnlyHost('{"items":[],"items":[]}')
  await expect(readPublicTrackPage(invalid.host, 'https://example.com/page')).rejects.toThrow()
  expect(invalid.released()).toBe(1)
})
