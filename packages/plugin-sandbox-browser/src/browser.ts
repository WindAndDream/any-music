import type { SandboxWorker } from './sandbox-session'

/** Only the trusted application resource is executable; source/package URLs are never accepted. */
export function createBrowserWorker(): SandboxWorker {
  const worker = new Worker('am-plugin://executor/worker.js', {
    type: 'module',
    name: 'am-permissionless-v1',
  })
  return {
    postMessage(message) {
      // Dedicated Worker messages do not take a window targetOrigin.
      // oxlint-disable-next-line unicorn/require-post-message-target-origin
      worker.postMessage(message)
    },
    subscribe(message, error) {
      const onMessage = (event: MessageEvent<unknown>) => message(event.data)
      worker.addEventListener('message', onMessage)
      worker.addEventListener('error', error)
      worker.addEventListener('messageerror', error)
      return () => {
        worker.removeEventListener('message', onMessage)
        worker.removeEventListener('error', error)
        worker.removeEventListener('messageerror', error)
      }
    },
    terminate() {
      worker.terminate()
    },
  }
}
