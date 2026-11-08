import type { VmPorts } from '@any-music/plugin-vm'
import wasmBase64 from 'virtual:am-vm-wasm'

import { runWorkerMessage } from './worker-runtime'

const binary = Uint8Array.from(atob(wasmBase64), (value) => value.charCodeAt(0)).buffer
const hash = async (input: ArrayBuffer) =>
  [...new Uint8Array(await crypto.subtle.digest('SHA-256', input))]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
const ports: VmPorts = {
  now: () => performance.now(),
  wait(ms, signal) {
    return new Promise((resolve, reject) => {
      const abort = () => {
        clearTimeout(timer)
        reject(new Error('cancelled'))
      }
      const timer = setTimeout(() => {
        signal.removeEventListener('abort', abort)
        resolve()
      }, ms)
      if (signal.aborted) abort()
      else signal.addEventListener('abort', abort, { once: true })
    })
  },
  sha256: (input) => hash(new TextEncoder().encode(input).buffer),
  async hmacSha256(key, input) {
    const handle = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(key),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    )
    return [
      ...new Uint8Array(await crypto.subtle.sign('HMAC', handle, new TextEncoder().encode(input))),
    ]
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('')
  },
  standard(operation, source) {
    const input = JSON.parse(source)
    switch (operation) {
      case 'url': {
        const url = new URL(input.input, input.base)
        return JSON.stringify(
          Object.fromEntries(
            [
              'href',
              'origin',
              'protocol',
              'hostname',
              'host',
              'port',
              'pathname',
              'search',
              'hash',
              'username',
              'password',
            ].map((key) => [key, url[key as keyof URL]]),
          ),
        )
      }
      case 'query':
        return JSON.stringify([...new URLSearchParams(input)])
      case 'queryString':
        return JSON.stringify(new URLSearchParams(input).toString())
      case 'encode':
        return JSON.stringify([...new TextEncoder().encode(input)])
      case 'decode':
        return JSON.stringify(
          new TextDecoder('utf-8', { fatal: input.fatal }).decode(new Uint8Array(input.bytes)),
        )
      case 'btoa':
        return JSON.stringify(btoa(input))
      case 'atob':
        return JSON.stringify(atob(input))
      case 'now':
        return JSON.stringify(Math.floor(performance.now()))
      case 'log':
        return 'null'
      case 'random': {
        if (!Number.isSafeInteger(input) || input < 0 || input > 4096)
          throw new Error('Random budget')
        return JSON.stringify([...crypto.getRandomValues(new Uint8Array(input))])
      }
      default:
        throw new Error('Unknown pure tool')
    }
  },
}
let started = false
// One immutable bootstrap handler; additional start messages close the one-shot worker.
// oxlint-disable-next-line unicorn/prefer-add-event-listener
globalThis.onmessage = async (event: MessageEvent<unknown>) => {
  if (started) {
    globalThis.close()
    return
  }
  started = true
  try {
    const reply = await runWorkerMessage(event.data, { wasmBinary: binary, sha256: hash }, ports)
    // Dedicated Worker replies only to its owning session.
    /* oxlint-disable unicorn/require-post-message-target-origin */
    globalThis.postMessage(reply)
    /* oxlint-enable unicorn/require-post-message-target-origin */
  } catch {
    /* oxlint-disable unicorn/require-post-message-target-origin */
    globalThis.postMessage('{"version":1,"error":"guest"}')
    /* oxlint-enable unicorn/require-post-message-target-origin */
  } finally {
    globalThis.close()
  }
}
