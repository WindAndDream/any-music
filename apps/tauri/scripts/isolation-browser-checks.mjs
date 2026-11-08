// These fixed functions run in the real diagnostic WebView. They accept synthetic
// markers only; no product records, credentials or third-party code are supplied.
// Each one-shot probe owns its IDB/Worker handlers; the polling observes async callbacks.
/* oxlint-disable unicorn/prefer-add-event-listener, eslint/no-await-in-loop */
export async function seedStorage(marker) {
  const database = await new Promise((accept, reject) => {
    const request = indexedDB.open('s03-isolation', 1)
    request.onupgradeneeded = () => request.result.createObjectStore('markers')
    request.onsuccess = () => accept(request.result)
    request.onerror = () => reject(request.error)
  })
  const beforeIdb = await new Promise((accept, reject) => {
    const request = database.transaction('markers').objectStore('markers').get('owner')
    request.onsuccess = () => accept(request.result ?? null)
    request.onerror = () => reject(request.error)
  })
  const cache = await caches.open('s03-isolation')
  const cacheUrl = new URL('/synthetic-marker', location.href).href
  const cached = await cache.match(cacheUrl)
  const before = {
    localStorage: localStorage.getItem('s03-owner'),
    indexedDb: beforeIdb,
    cache: cached ? await cached.text() : null,
    cookie: document.cookie,
  }
  localStorage.setItem('s03-owner', marker)
  document.cookie = `s03owner=${marker}; Path=/; Secure; SameSite=Lax`
  await new Promise((accept, reject) => {
    const transaction = database.transaction('markers', 'readwrite')
    transaction.objectStore('markers').put(marker, 'owner')
    transaction.oncomplete = accept
    transaction.onerror = () => reject(transaction.error)
  })
  database.close()
  await cache.put(cacheUrl, new Response(marker))
  globalThis.s03Messages = []
  globalThis.s03Channel = new BroadcastChannel('s03-isolation-channel')
  globalThis.s03Channel.onmessage = (event) => globalThis.s03Messages.push(event.data)
  const local = new BroadcastChannel('s03-isolation-channel')
  // BroadcastChannel has no targetOrigin argument.
  // oxlint-disable-next-line unicorn/require-post-message-target-origin
  local.postMessage(`local-${marker}`)
  await new Promise((accept) => setTimeout(accept, 100))
  local.close()
  const localMessages = [...globalThis.s03Messages]
  globalThis.s03Messages.length = 0
  return { before, localMessages, openerAbsent: window.opener === null }
}

export async function readStorage() {
  const database = await new Promise((accept, reject) => {
    const request = indexedDB.open('s03-isolation', 1)
    request.onsuccess = () => accept(request.result)
    request.onerror = () => reject(request.error)
  })
  const indexedDb = await new Promise((accept, reject) => {
    const request = database.transaction('markers').objectStore('markers').get('owner')
    request.onsuccess = () => accept(request.result)
    request.onerror = () => reject(request.error)
  })
  database.close()
  const cache = await caches.open('s03-isolation')
  return {
    localStorage: localStorage.getItem('s03-owner'),
    indexedDb,
    cache: await (await cache.match(new URL('/synthetic-marker', location.href).href)).text(),
    cookie: document.cookie,
    broadcasts: globalThis.s03Messages,
  }
}

export async function deniedBrowserCapabilities() {
  const sharedWorkerDenied = await new Promise((accept) => {
    try {
      const worker = new SharedWorker('/unavailable-shared-worker.js')
      worker.onerror = () => {
        worker.port.close()
        accept(true)
      }
      setTimeout(() => {
        worker.port.close()
        accept(false)
      }, 1000)
    } catch {
      accept(true)
    }
  })
  let serviceWorkerDenied = false
  try {
    await navigator.serviceWorker.register('/network-worker.js', { type: 'module' })
  } catch {
    serviceWorkerDenied = true
  }
  const policy = document.permissionsPolicy ?? document.featurePolicy
  const devices = Object.fromEntries(
    ['camera', 'microphone', 'geolocation', 'display-capture'].map((feature) => [
      feature,
      policy.allowsFeature(feature),
    ]),
  )
  let mediaAccess
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true })
    stream.getTracks().forEach((track) => track.stop())
    mediaAccess = { allowed: true }
  } catch (error) {
    mediaAccess = { allowed: false, error: error.name }
  }
  const locationAccess = await new Promise((accept) =>
    navigator.geolocation.getCurrentPosition(
      () => accept({ allowed: true }),
      (error) => accept({ allowed: false, code: error.code }),
      { timeout: 1000 },
    ),
  )
  const resourceDenied = await new Promise((accept) => {
    const script = document.createElement('script')
    script.src = '/not-a-trusted-resource.js'
    script.onload = () => accept(false)
    script.onerror = () => accept(true)
    document.body.append(script)
  })
  const frame = document.createElement('iframe')
  frame.src = location.href
  document.body.append(frame)
  await new Promise((accept) => setTimeout(accept, 200))
  frame.remove()
  return {
    sharedWorkerDenied,
    serviceWorkerDenied,
    devices,
    mediaAccess,
    locationAccess,
    resourceDenied,
    openerAbsent: opener === null,
  }
}

export async function workerTimeout() {
  let terminated = 0
  let result = null
  const worker = new Worker('/network-worker.js', { type: 'module' })
  const terminate = worker.terminate.bind(worker)
  worker.terminate = () => {
    terminated++
    terminate()
  }
  const dispose = globalThis.s03Acceptance.startProbeSession({
    createWorker: () => worker,
    relay: () => {
      throw Error('A silent Worker must never relay')
    },
    report: (value) => {
      result = value
    },
  })
  await new Promise((accept) => setTimeout(accept, 5200))
  dispose()
  return { terminated, result }
}

export async function lateAckAfterDispose() {
  let terminated = 0
  const reports = []
  let resolveAck
  const ack = new Promise((accept) => {
    resolveAck = accept
  })
  const worker = new Worker('/worker.js', { type: 'module' })
  const terminate = worker.terminate.bind(worker)
  worker.terminate = () => {
    terminated++
    terminate()
  }
  let enteredRelay = false
  const dispose = globalThis.s03Acceptance.startProbeSession({
    createWorker: () => worker,
    relay: () => {
      enteredRelay = true
      return ack
    },
    report: (value) => reports.push(value),
  })
  for (let attempt = 0; attempt < 100; attempt++) {
    if (enteredRelay) break
    await new Promise((accept) => setTimeout(accept, 20))
  }
  // This is the exact cleanup used by launcher pagehide; the live result confirms
  // an actual Worker is released before a late acknowledgement arrives.
  dispose()
  resolveAck({ sequence: 0, codePluginsEnabled: false })
  await new Promise((accept) => setTimeout(accept, 100))
  return { enteredRelay, terminated, reports }
}
