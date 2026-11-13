import { parseBoundedJson } from '@any-music/plugin-sdk/schema'
import { VmError } from '@any-music/plugin-vm/control'
import type { VmAdmission } from '@any-music/plugin-vm/control'
import { VM_PROFILE, VM_PROFILE_HASH } from '@any-music/plugin-vm/profile'

export interface SandboxWorker {
  postMessage(message: string): void
  subscribe(message: (input: unknown) => void, error: () => void): () => void
  terminate(): void
}

export interface SandboxClock {
  now(): number
  schedule(callback: () => void, delayMs: number): () => void
}

/** A session has no broker or business port. Real native subject authority stays outside JS. */
export function createSandboxSession(options: {
  subject: string
  admission: VmAdmission
  createWorker(): SandboxWorker
  clock: SandboxClock
  profileId: string
  sourceFormat?: 'body' | 'module'
}) {
  if (options.profileId !== VM_PROFILE.id) throw new VmError('profile')
  let worker: SandboxWorker | undefined, unsubscribe: (() => void) | undefined
  let cancelWatchdog: (() => void) | undefined, release: ((failed?: boolean) => void) | undefined
  let rejectTask: ((error: Error) => void) | undefined
  let closed = false,
    started = false
  const cancelIdle = options.clock.schedule(() => close(new VmError('disposed')), VM_PROFILE.idleMs)
  function close(error?: Error) {
    cancelIdle()
    cancelWatchdog?.()
    cancelWatchdog = undefined
    unsubscribe?.()
    unsubscribe = undefined
    worker?.terminate()
    worker = undefined
    release?.(
      error?.message !== 'Plugin VM: cancelled' &&
        !!error &&
        error.message !== 'Plugin VM: disposed',
    )
    release = undefined
    if (closed) return
    closed = true
    rejectTask?.(error ?? new VmError('disposed'))
  }
  return {
    get closed() {
      return closed
    },
    close: () => close(),
    async run(source: string, inputJson = 'null', signal?: AbortSignal): Promise<string> {
      if (closed) throw new VmError('disposed')
      if (started) throw new VmError('busy')
      if (signal?.aborted) {
        close()
        throw new VmError('cancelled')
      }
      const message = JSON.stringify({
        version: 1,
        profileId: VM_PROFILE.id,
        profileHash: VM_PROFILE_HASH,
        source,
        inputJson,
        format: options.sourceFormat ?? 'module',
      })
      try {
        parseBoundedJson(inputJson)
        // Code is data but still counts against the encoded transport budget.
        parseBoundedJson(message)
      } catch (error) {
        close()
        throw error
      }
      started = true
      return new Promise<string>((resolve, reject) => {
        rejectTask = reject
        const onAbort = () => close(new VmError('cancelled'))
        signal?.addEventListener('abort', onAbort, { once: true })
        const cleanupAbort = () => signal?.removeEventListener('abort', onAbort)
        rejectTask = (error) => {
          cleanupAbort()
          reject(error)
        }
        try {
          release = options.admission.acquire(options.subject)
          worker = options.createWorker()
          if (closed) {
            close()
            return
          }
          cancelWatchdog = options.clock.schedule(
            () => close(new VmError('budget')),
            VM_PROFILE.deadlineMs,
          )
          unsubscribe = worker.subscribe(
            (input) => {
              if (closed) return
              try {
                if (typeof input !== 'string') throw new VmError('guest')
                const reply = parseBoundedJson(input) as Record<string, unknown>
                if (
                  !reply ||
                  typeof reply !== 'object' ||
                  Object.keys(reply).toSorted().join(',') !== 'outputJson,version' ||
                  reply.version !== 1 ||
                  typeof reply.outputJson !== 'string'
                )
                  throw new VmError('guest')
                parseBoundedJson(reply.outputJson)
                cleanupAbort()
                resolve(reply.outputJson)
                rejectTask = undefined
                close()
              } catch {
                close(new VmError('guest'))
              }
            },
            () => close(new VmError('guest')),
          )
          if (closed) {
            close()
            return
          }
          // Dedicated transport has one owner, no window target origin.
          // oxlint-disable-next-line unicorn/require-post-message-target-origin
          worker.postMessage(message)
        } catch (error) {
          close(error instanceof Error ? error : new VmError('guest'))
        }
      })
    },
  }
}
