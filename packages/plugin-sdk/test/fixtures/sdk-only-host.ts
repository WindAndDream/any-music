import { PluginCallError } from '@any-music/plugin-sdk'
import type { HostPort } from '@any-music/plugin-sdk'

/** Independent deterministic contract host: its only imports are the public SDK. */
export function createSdkOnlyHost(body: string) {
  let allowWrite = true,
    allowNetwork = true,
    released = 0
  const values = new Map<string, { value: string; version: number }>()
  const responses = new Set<string>()
  const host: HostPort = {
    state: {
      async get({ key }) {
        return values.get(key) ?? { value: null, version: 0 }
      },
      async set({ key, value, expectedVersion }) {
        if (!allowWrite)
          throw new PluginCallError({
            code: 'access-denied',
            message: 'Write denied',
            isRetryable: false,
          })
        const version = values.get(key)?.version ?? 0
        if (version !== expectedVersion)
          throw new PluginCallError({
            code: 'conflict',
            message: 'Version conflict',
            isRetryable: false,
          })
        const result = { value, version: version + 1 }
        values.set(key, result)
        return result
      },
    },
    network: {
      async request({ url }) {
        if (!allowNetwork || !url.startsWith('https://example.com/'))
          throw new PluginCallError({
            code: 'access-denied',
            message: 'Network denied',
            isRetryable: false,
          })
        responses.add('response-1')
        return {
          responseRef: 'response-1',
          status: 200,
          sizeBytes: body.length,
          expiresAtMs: 30000,
        }
      },
      async readResponse({ responseRef, offset, length }) {
        if (!responses.has(responseRef))
          throw new PluginCallError({
            code: 'not-found',
            message: 'Response closed',
            isRetryable: false,
          })
        const nextOffset = Math.min(body.length, offset + length)
        return {
          text: body.slice(offset, nextOffset),
          nextOffset,
          done: nextOffset === body.length,
        }
      },
      async releaseResponse({ responseRef }) {
        if (responses.delete(responseRef)) released++
      },
    },
    crypto: {
      async sha256() {
        throw new PluginCallError({
          code: 'capability-unavailable',
          message: 'Not supported by this fixture',
          isRetryable: false,
        })
      },
    },
  }
  return {
    host,
    setWriteAllowed(value: boolean) {
      allowWrite = value
    },
    setNetworkAllowed(value: boolean) {
      allowNetwork = value
    },
    released: () => released,
  }
}
