import { VmAdmission } from '@any-music/plugin-vm/control'
import { VM_PROFILE } from '@any-music/plugin-vm/profile'
import { expect, it } from 'vitest'

import { createSandboxSession } from '../src'
import type { SandboxWorker } from '../src'

function fixture(options: { createError?: boolean } = {}) {
  let listener: ((input: unknown) => void) | undefined, error: (() => void) | undefined
  let terminated = 0,
    subscriptions = 0
  const timers = new Set<() => void>(),
    sent: string[] = []
  const admission = new VmAdmission(() => 0)
  const worker: SandboxWorker = {
    postMessage(message) {
      sent.push(message)
    },
    subscribe(message, onError) {
      listener = message
      error = onError
      subscriptions++
      return () => {
        subscriptions--
      }
    },
    terminate() {
      terminated++
    },
  }
  const session = createSandboxSession({
    sourceFormat: 'body',
    subject: 'fixed-native-subject',
    admission,
    profileId: VM_PROFILE.id,
    clock: {
      now: () => 0,
      schedule(callback) {
        timers.add(callback)
        return () => {
          timers.delete(callback)
        }
      },
    },
    createWorker() {
      if (options.createError) throw new Error('startup')
      return worker
    },
  })
  return {
    session,
    admission,
    sent,
    timers,
    reply: (value: unknown) => listener?.(value),
    crash: () => error?.(),
    get terminated() {
      return terminated
    },
    get subscriptions() {
      return subscriptions
    },
  }
}

it('accepts one bounded reply, ignores replay and releases all subscriptions and admission', async () => {
  const f = fixture(),
    task = f.session.run('return input;', '{"value":1}')
  expect(f.sent).toHaveLength(1)
  const reply = JSON.stringify({ version: 1, outputJson: '{"ok":true}' })
  f.reply(reply)
  f.reply(reply)
  expect(await task).toBe('{"ok":true}')
  expect(f.terminated).toBe(1)
  expect(f.subscriptions).toBe(0)
  expect(f.timers.size).toBe(0)
  expect(f.admission.activeCount).toBe(0)
})

it.each([
  { version: 1, outputJson: '1' },
  '{"version":1,"version":1,"outputJson":"1"}',
  '{"version":1,"outputJson":"1","pluginId":"other"}',
  '{"version":1,"outputJson":"{bad}"}',
  '{"version":2,"outputJson":"1"}',
  'x'.repeat(262145),
])('rejects malformed, oversized, replay-shaped and spoofed messages', async (reply) => {
  const f = fixture(),
    task = f.session.run('return 1;')
  f.reply(reply)
  await expect(task).rejects.toThrow()
  expect(f.terminated).toBe(1)
  expect(f.subscriptions).toBe(0)
  expect(f.admission.activeCount).toBe(0)
})

it.each(['abort', 'crash', 'timeout', 'close'] as const)(
  'cleans up %s, even with a late reply',
  async (action) => {
    const f = fixture(),
      abort = new AbortController()
    const task = f.session.run('return 1;', 'null', abort.signal)
    if (action === 'abort') abort.abort()
    if (action === 'crash') f.crash()
    if (action === 'timeout') [...f.timers].at(-1)!()
    if (action === 'close') f.session.close()
    f.reply(JSON.stringify({ version: 1, outputJson: '1' }))
    await expect(task).rejects.toThrow()
    expect(f.terminated).toBe(1)
    expect(f.subscriptions).toBe(0)
    expect(f.timers.size).toBe(0)
    expect(f.admission.activeCount).toBe(0)
  },
)

it('reclaims an idle unused session and handles startup failure', async () => {
  const idle = fixture()
  for (const timer of idle.timers) timer()
  await expect(idle.session.run('return 1;')).rejects.toThrow('disposed')
  expect(idle.terminated).toBe(0)
  const failed = fixture({ createError: true })
  await expect(failed.session.run('return 1;')).rejects.toThrow('startup')
  expect(failed.admission.activeCount).toBe(0)
})

it('handles owner cancellation during synchronous worker creation without leaving resources', async () => {
  const abort = new AbortController()
  const timers = new Set<() => void>()
  const admission = new VmAdmission(() => 0)
  let terminated = 0,
    subscribed = 0
  const session = createSandboxSession({
    subject: 'fixed',
    profileId: VM_PROFILE.id,
    admission,
    clock: {
      now: () => 0,
      schedule(fn) {
        timers.add(fn)
        return () => {
          timers.delete(fn)
        }
      },
    },
    createWorker() {
      abort.abort()
      return {
        postMessage() {
          throw new Error('closed')
        },
        subscribe() {
          subscribed++
          return () => {}
        },
        terminate() {
          terminated++
        },
      }
    },
  })
  await expect(session.run('return 1;', 'null', abort.signal)).rejects.toThrow('cancelled')
  expect(terminated).toBe(1)
  expect(subscribed).toBe(0)
  expect(timers.size).toBe(0)
  expect(admission.activeCount).toBe(0)
})
