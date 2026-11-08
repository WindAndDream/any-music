import type { GuestInvocation, GuestStep, HostRequest } from './generated/protocol.ts'

export type { GuestInvocation, GuestStep } from './generated/protocol.ts'

/** A guest returns a named request as data. The trusted adapter fulfills it outside the VM
 * after native authorization and resumes in a fresh realm. No host function crosses realms. */
export function requestHost<O extends HostRequest['operation']>(
  invocation: GuestInvocation,
  operation: O,
  input: Extract<HostRequest, { operation: O }>['input'],
  checkpoint: unknown = null,
): GuestStep {
  return {
    kind: 'host',
    request: {
      wireVersion: 1,
      requestId: `call-${invocation.sequence}`,
      contextRef: invocation.contextRef,
      deadlineMs: invocation.deadlineMs,
      operation,
      input,
    } as HostRequest,
    checkpointJson: JSON.stringify(checkpoint),
  }
}

export function complete(value: unknown): GuestStep {
  return { kind: 'complete', outputJson: JSON.stringify(value) }
}
