// Fixed diagnostic for the real Worker's response CSP, never a production bridge.
const violations: { directive: string; blocked: string }[] = []
addEventListener('securitypolicyviolation', (event) => {
  const violation = event as SecurityPolicyViolationEvent
  violations.push({ directive: violation.effectiveDirective, blocked: violation.blockedURI })
})
addEventListener(
  'message',
  async (event: MessageEvent<unknown>) => {
    const port = event.data
    if (typeof port !== 'number' || !Number.isInteger(port) || port < 1 || port > 65535) return
    const url = `http://127.0.0.1:${port}/blocked-worker`
    let fetchRejected = false
    let socketRejected = false
    try {
      await fetch(url)
    } catch {
      fetchRejected = true
    }
    try {
      const socket = new WebSocket(`ws://127.0.0.1:${port}/blocked-socket`)
      socket.addEventListener(
        'error',
        () => {
          socketRejected = true
        },
        { once: true },
      )
    } catch {
      socketRejected = true
    }
    setTimeout(() => {
      /* oxlint-disable unicorn/require-post-message-target-origin */
      globalThis.postMessage({ fetchRejected, socketRejected, violations })
      /* oxlint-enable unicorn/require-post-message-target-origin */
      globalThis.close()
    }, 200)
  },
  { once: true },
)
