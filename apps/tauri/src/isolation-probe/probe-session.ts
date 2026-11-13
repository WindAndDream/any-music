interface ProbeWorker extends EventTarget {
  terminate(): void
}

interface ProbeSessionOptions {
  createWorker: () => ProbeWorker
  relay: (message: string) => Promise<unknown>
  report: (result: string) => void
  userAgent?: string
}

function isObservation(value: unknown): value is {
  worker: boolean
  wasm: boolean
  noHostGlobals: boolean
} {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  return (
    Object.keys(record).length === 3 &&
    typeof record.worker === 'boolean' &&
    typeof record.wasm === 'boolean' &&
    typeof record.noHostGlobals === 'boolean'
  )
}

function isAck(value: unknown): value is { sequence: 0; codePluginsEnabled: false } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  return (
    Object.keys(record).length === 2 && record.sequence === 0 && record.codePluginsEnabled === false
  )
}

/** Fixed S03 diagnostic exchange. A report is an observation, never target acceptance. */
export function startProbeSession(options: ProbeSessionOptions) {
  let worker: ProbeWorker | undefined
  let active = true
  let relaying = false
  // Bound the whole exchange, including native ACK delivery, not just VM startup.
  const watchdog = setTimeout(() => finish('Probe timed out. Code plugins remain disabled.'), 5000)

  function stopWorker() {
    worker?.removeEventListener('message', handleMessage)
    worker?.removeEventListener('error', handleFailure)
    worker?.removeEventListener('messageerror', handleFailure)
    worker?.terminate()
    worker = undefined
  }

  function dispose() {
    if (!active) return
    active = false
    clearTimeout(watchdog)
    stopWorker()
  }

  function finish(result: string) {
    if (!active) return
    dispose()
    options.report(result)
  }

  function handleFailure() {
    finish('Worker/WASM unavailable. Code plugins remain disabled.')
  }

  function handleMessage(event: Event) {
    if (!active || relaying) return
    const observation = (event as MessageEvent<unknown>).data
    if (!isObservation(observation)) {
      finish('Probe rejected. Code plugins remain disabled.')
      return
    }
    relaying = true
    stopWorker()
    // The native boundary validates identity, schema and budgets again. A disposed
    // or timed-out page must never publish a late ACK, whether success or failure.
    void (async () => {
      try {
        const ack = await options.relay(JSON.stringify({ epoch: 1, sequence: 0, observation }))
        if (!isAck(ack)) throw new Error('Invalid diagnostic ACK')
        finish(JSON.stringify({ observation, ack, userAgent: options.userAgent }))
      } catch {
        finish('Probe rejected. Code plugins remain disabled.')
      }
    })()
  }

  try {
    worker = options.createWorker()
    worker.addEventListener('message', handleMessage)
    worker.addEventListener('error', handleFailure)
    worker.addEventListener('messageerror', handleFailure)
  } catch {
    handleFailure()
  }
  return dispose
}
