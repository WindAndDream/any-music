import { createSandboxSession } from '@any-music/plugin-sandbox-browser'
import { VmAdmission } from '@any-music/plugin-vm/control'
import { VM_PROFILE } from '@any-music/plugin-vm/profile'
// Continuations must finish before the next realm is started.
/* oxlint-disable eslint/no-await-in-loop */
import { invoke } from '@tauri-apps/api/core'

type Reply = { source?: string; inputJson?: string; done?: boolean }

const admission = new VmAdmission(() => performance.now())
const relay = (value: unknown) =>
  invoke<Reply>('plugin_executor_relay', { message: JSON.stringify(value) })

// The native server serves only these fixed resources to the owning isolated WebView.
// Guest text is never imported, inserted into the DOM or used as a Worker URL.
async function run() {
  let next = await relay({ type: 'bootstrap' })
  for (let sequence = 0; sequence < 16 && !next.done; sequence++) {
    const session = createSandboxSession({
      subject: 'native-bound-session',
      admission,
      profileId: VM_PROFILE.id,
      createWorker() {
        const path = 'worker.js'
        const worker = new Worker(path, { type: 'module', name: 'am-admitted-guest' })
        return {
          // Dedicated Worker transport has no window targetOrigin argument.
          // oxlint-disable-next-line unicorn/require-post-message-target-origin
          postMessage: (message) => worker.postMessage(message),
          subscribe(message, error) {
            const receive = (event: MessageEvent) => message(event.data)
            worker.addEventListener('message', receive)
            worker.addEventListener('error', error)
            worker.addEventListener('messageerror', error)
            return () => {
              worker.removeEventListener('message', receive)
              worker.removeEventListener('error', error)
              worker.removeEventListener('messageerror', error)
            }
          },
          terminate: () => worker.terminate(),
        }
      },
      clock: {
        now: () => performance.now(),
        schedule(callback, ms) {
          const timer = setTimeout(callback, ms)
          return () => clearTimeout(timer)
        },
      },
    })
    try {
      const output = await session.run(next.source!, next.inputJson!)
      next = await relay({ type: 'result', sequence, output })
    } finally {
      session.close()
    }
  }
}
void run().catch(() => {
  void relay({ type: 'failed' }).catch(() => {})
})
