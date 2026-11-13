// Test-only observer for the standalone WebView2 example; never bundled into a product.
// Connection retries must wait for the same native target instead of opening parallel sessions.
/* oxlint-disable eslint/no-await-in-loop */
export const delay = (ms) => new Promise((accept) => setTimeout(accept, ms))

export async function connectWebview(port, { urlPattern = /am-s03-|tauri\.localhost/ } = {}) {
  let page
  for (let attempt = 0; attempt < 120; attempt++) {
    try {
      const pages = await fetch(`http://127.0.0.1:${port}/json/list`, {
        signal: AbortSignal.timeout(1000),
      }).then((response) => response.json())
      page = pages.find((value) => value.type === 'page' && urlPattern.test(value.url))
      if (page) break
    } catch {
      /* WebView environment is still starting. */
    }
    await delay(250)
  }
  if (!page) throw new Error(`No live S03 WebView on loopback port ${port}`)
  const socket = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((accept, reject) => {
    socket.addEventListener('open', accept, { once: true })
    socket.addEventListener('error', reject, { once: true })
  })
  let nextId = 0
  const pending = new Map()
  const events = []
  socket.addEventListener('message', (event) => {
    const value = JSON.parse(event.data)
    if (value.id) {
      const waiter = pending.get(value.id)
      if (waiter) {
        pending.delete(value.id)
        clearTimeout(waiter.timer)
        if (value.error) waiter.reject(new Error(JSON.stringify(value.error)))
        else waiter.accept(value.result)
      }
    } else events.push(value)
  })
  socket.addEventListener('close', () => {
    for (const waiter of pending.values()) {
      clearTimeout(waiter.timer)
      waiter.reject(new Error('S03 WebView closed'))
    }
    pending.clear()
  })
  function send(method, params = {}, sessionId) {
    const id = ++nextId
    return new Promise((accept, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id)
        reject(new Error(`CDP timeout: ${method}`))
      }, 15000)
      pending.set(id, { accept, reject, timer })
      socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }))
    })
  }
  return {
    page,
    events,
    send,
    async evaluate(expression) {
      const response = await send('Runtime.evaluate', {
        expression,
        awaitPromise: true,
        returnByValue: true,
      })
      if (response.exceptionDetails) throw new Error(JSON.stringify(response.exceptionDetails))
      return response.result.value
    },
    close() {
      socket.close()
    },
  }
}
