// Node transport fixture for the actual built, trusted browser bootstrap. No plugin import.
import { parentPort } from 'node:worker_threads'
// Node MessagePort, like a DedicatedWorker, has no targetOrigin parameter.
// oxlint-disable-next-line unicorn/require-post-message-target-origin
globalThis.postMessage = (message) => parentPort.postMessage(message)
globalThis.close = () => parentPort.close()
await import('../../dist/worker.js')
parentPort.on('message', (data) => globalThis.onmessage({ data }))
