import { Worker } from 'node:worker_threads'

import { VmAdmission } from '@any-music/plugin-vm/control'
import { VM_PROFILE } from '@any-music/plugin-vm/profile'
import { expect, it } from 'vitest'

import { createSandboxSession } from '../src'

/** Executes the built production bootstrap in a thread, without a browser, WebView or UI. */
function session(sourceFormat: 'body' | 'module' = 'module') {
  return createSandboxSession({
    subject: 'thread-fixture',
    sourceFormat,
    profileId: VM_PROFILE.id,
    admission: new VmAdmission(() => performance.now()),
    clock: {
      now: () => performance.now(),
      schedule(callback, ms) {
        const timer = setTimeout(callback, ms)
        return () => clearTimeout(timer)
      },
    },
    createWorker() {
      const worker = new Worker(new URL('./fixtures/node-worker.mjs', import.meta.url))
      return {
        postMessage(message) {
          // oxlint-disable-next-line unicorn/require-post-message-target-origin
          worker.postMessage(message)
        },
        terminate() {
          void worker.terminate()
        },
        subscribe(message, error) {
          worker.on('message', message)
          worker.on('error', error)
          return () => {
            worker.off('message', message)
            worker.off('error', error)
          }
        },
      }
    },
  })
}

it('uses the same Profile, standard tools, engine bytes, Promise bridge and JSON boundary in the built Worker', async () => {
  const worker = session()
  expect(
    JSON.parse(
      await worker.run(
        `await sleep(1); export default async input => { return {count:input.count,
    text:new TextDecoder().decode(new TextEncoder().encode('中文🙂')),
    digest:await host.crypto.sha256('abc')}; };`,
        '{"count":3}',
      ),
    ),
  ).toEqual({
    count: 3,
    text: '中文🙂',
    digest: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
  })
  expect(worker.closed).toBe(true)
})

it.each(['return eval("1");', 'while(true){}', 'return {toJSON(){while(true){}}};'])(
  'terminates real Worker failure and recycles its lease: %s',
  async (source) => {
    const worker = session('body')
    await expect(worker.run(source)).rejects.toThrow()
    expect(worker.closed).toBe(true)
  },
  35000,
)
