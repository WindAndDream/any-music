/* oxlint-disable eslint/no-await-in-loop */
import { describe, expect, it, vi } from 'vitest'

import { complete, requestHost } from '../src/guest'
import type { GuestInvocation } from '../src/guest'
import { runGuestProgram } from '../src/host'
import type { HostPort } from '../src/index'

const invocation: GuestInvocation = {
  operation: 'command.run',
  inputJson: '{}',
  contextRef: 'host-context',
  sequence: 0,
  deadlineMs: 1000,
}
function ports(): HostPort {
  return {
    state: {
      get: vi.fn(async () => ({ value: null, version: 0 })),
      set: vi.fn(async (input) => ({ value: input.value, version: 1 })),
    },
    crypto: { sha256: vi.fn(async () => ({ hex: '0'.repeat(64) })) },
    network: {
      request: vi.fn(async () => {
        throw Error('unavailable')
      }),
      readResponse: vi.fn(async () => {
        throw Error('unavailable')
      }),
      releaseResponse: vi.fn(async () => {}),
    },
  }
}
describe('public guest continuation adapter', () => {
  it('resumes with a redacted refusal instead of leaking host exceptions', async () => {
    const result = await runGuestProgram({
      invocation,
      host: ports(),
      invoke: async (input) =>
        input.sequence === 0
          ? requestHost(input, 'network.request', { url: 'https://example.com', method: 'GET' })
          : complete(input.response),
    })
    expect(result).toMatchObject({ ok: false, error: { code: 'access-denied' } })
    expect(JSON.stringify(result)).not.toContain('secret')
  })
  it('resumes only a named, validated response with its checkpoint', async () => {
    const host = ports()
    const result = await runGuestProgram({
      invocation,
      host,
      invoke: async (input) =>
        input.sequence === 0
          ? requestHost(input, 'state.get', { key: 'one' }, { stage: 1 })
          : complete({ response: input.response, checkpoint: JSON.parse(input.checkpointJson!) }),
    })
    expect(host.state.get).toHaveBeenCalledExactlyOnceWith({ key: 'one' })
    expect(result).toMatchObject({
      response: { ok: true, result: { version: 0 } },
      checkpoint: { stage: 1 },
    })
  })
  it('rejects context substitution and sequence replay before calling a host', async () => {
    const host = ports()
    for (const input of [
      { ...invocation, contextRef: 'other' },
      { ...invocation, sequence: 9 },
      { ...invocation, deadlineMs: 1001 },
    ]) {
      await expect(
        runGuestProgram({
          invocation,
          host,
          invoke: async () => requestHost(input, 'state.get', { key: 'one' }),
        }),
      ).rejects.toThrow('Stale')
    }
    expect(host.state.get).not.toHaveBeenCalled()
  })
  it('checks cancellation again before exposing completed output', async () => {
    let cancelled = false
    await expect(
      runGuestProgram({
        invocation,
        host: ports(),
        cancelled: () => cancelled,
        invoke: async () => {
          cancelled = true
          return complete('late')
        },
      }),
    ).rejects.toThrow('cancelled')
  })
  it('bounds continuation loops and rejects invalid host DTOs', async () => {
    await expect(
      runGuestProgram({
        invocation,
        host: ports(),
        invoke: async (input) => requestHost(input, 'state.get', { key: 'one' }),
      }),
    ).rejects.toThrow('step budget')
    const host = ports()
    host.crypto.sha256 = async () => ({ hex: 'invalid' })
    await expect(
      runGuestProgram({
        invocation,
        host,
        invoke: async (input) => requestHost(input, 'crypto.sha256', { text: 'one' }),
      }),
    ).rejects.toThrow()
  })
  it('applies bounded JSON rules to the nested completion JSON', async () => {
    await expect(
      runGuestProgram({
        invocation,
        host: ports(),
        invoke: async () => ({ kind: 'complete', outputJson: '{"__proto__":{}}' }),
      }),
    ).rejects.toThrow()
  })
})
