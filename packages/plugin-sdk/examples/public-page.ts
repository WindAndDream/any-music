import type { HostPort } from '@any-music/plugin-sdk'
import { PluginCallError } from '@any-music/plugin-sdk'
import type { WireTrackPage } from '@any-music/plugin-sdk/music'
import { decodeProtocolJson } from '@any-music/plugin-sdk/schema'

/** Public capability example. The supplied host owns authorization, HTTPS policy and IO. */
export async function readPublicTrackPage(host: HostPort, url: string): Promise<WireTrackPage> {
  const response = await host.network.request({ url, method: 'GET' })
  try {
    if (response.status !== 200)
      throw new PluginCallError({
        code: 'upstream-error',
        message: 'Public source failed',
        isRetryable: true,
      })
    let offset = 0,
      text = ''
    while (true) {
      // Each read depends on the preceding cursor; parallel reads would defeat backpressure.
      // eslint-disable-next-line no-await-in-loop
      const chunk = await host.network.readResponse({
        responseRef: response.responseRef,
        offset,
        length: 65536,
      })
      text += chunk.text
      if (text.length > 262144 || (!chunk.done && chunk.nextOffset <= offset))
        throw new PluginCallError({
          code: 'limit-exceeded',
          message: 'Invalid response cursor',
          isRetryable: false,
        })
      if (chunk.done) return decodeProtocolJson('WireTrackPage', text)
      offset = chunk.nextOffset
    }
  } finally {
    await host.network.releaseResponse({ responseRef: response.responseRef })
  }
}
