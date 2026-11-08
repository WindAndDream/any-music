// Each step depends on the preceding native transaction or observation.
/* oxlint-disable eslint/no-await-in-loop */
import type { GuestInvocation, GuestStep, HostResponse } from './generated/protocol.ts'
import type { HostPort } from './ports.ts'
import { decodeProtocolJson, parseBoundedJson } from './schema/index.ts'

/** Public host adapter. It validates/dispatches named DTOs; authorization stays in the
 * injected HostPort. Each invoke must execute source in the target's admitted executor. */
export async function runGuestProgram(options: {
  invocation: GuestInvocation
  invoke(input: GuestInvocation): Promise<unknown>
  host: HostPort
  cancelled?(): boolean
}): Promise<unknown> {
  let invocation = options.invocation
  for (let step = 0; step < 16; step++) {
    if (options.cancelled?.()) throw new Error('Plugin operation cancelled')
    const output: GuestStep = decodeProtocolJson(
      'GuestStep',
      JSON.stringify(await options.invoke(invocation)),
    )
    if (options.cancelled?.()) throw new Error('Plugin operation cancelled')
    if (output.kind === 'complete') return parseBoundedJson(output.outputJson)
    const request = output.request
    if (
      request.contextRef !== invocation.contextRef ||
      request.requestId !== `call-${invocation.sequence}` ||
      request.deadlineMs > invocation.deadlineMs
    )
      throw new Error('Stale guest request')
    let value: unknown
    let refused = false
    try {
      switch (request.operation) {
        case 'state.get':
          value = await options.host.state.get(request.input)
          break
        case 'state.set':
          value = await options.host.state.set(request.input)
          break
        case 'crypto.sha256':
          value = await options.host.crypto.sha256(request.input)
          break
        case 'network.request':
          value = await options.host.network.request(request.input)
          break
        case 'network.readResponse':
          value = await options.host.network.readResponse(request.input)
          break
        case 'network.releaseResponse':
          await options.host.network.releaseResponse(request.input)
          value = {}
          break
      }
    } catch {
      refused = true
    }
    const response = decodeProtocolJson(
      'HostResponse',
      JSON.stringify({
        wireVersion: 1,
        requestId: request.requestId,
        operation: request.operation,
        ...(refused
          ? {
              ok: false,
              error: {
                code: 'access-denied',
                message: 'Host operation refused or unavailable.',
                isRetryable: false,
              },
            }
          : { ok: true, result: value }),
      }),
    ) as HostResponse
    invocation = Object.assign({}, invocation, {
      sequence: invocation.sequence + 1,
      checkpointJson: output.checkpointJson,
      response,
    })
  }
  throw new Error('Plugin operation step budget')
}
