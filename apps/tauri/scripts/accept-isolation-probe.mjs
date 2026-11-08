// Explicit live acceptance: this command launches the S03 example and real WebView2.
// Phases are ordered to preserve caller identity, canary state and teardown evidence.
/* oxlint-disable eslint/no-await-in-loop */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { createServer as createTcpServer } from 'node:net'
import { tmpdir, release } from 'node:os'
import { basename, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { validateIsolationAcceptance } from './isolation-acceptance-report.mjs'
import {
  seedStorage,
  readStorage,
  deniedBrowserCapabilities,
  workerTimeout,
  lateAckAfterDispose,
} from './isolation-browser-checks.mjs'
import { connectWebview, delay } from './isolation-cdp.mjs'

assert.equal(process.platform, 'win32', 'S03 currently has a Windows candidate only')
const root = fileURLToPath(new URL('../../../', import.meta.url))
const runId = randomUUID()
const directory = resolve(root, 'target/s03-probe/live', runId)
mkdirSync(directory, { recursive: true })
const report = {
  scope: 'S03',
  runId,
  status: 'running',
  startedAt: new Date().toISOString(),
  os: release(),
  codePluginsEnabled: false,
  observations: {},
  checks: {},
  nativeEvents: [],
}
const labels = ['main', 's03-a', 's03-b', 's03-peer']
const clients = {}
const ports = {}
const requests = []
const server = createServer((request, response) => {
  requests.push(request.url)
  response.writeHead(200, { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'text/plain' })
  response.end('S03 synthetic canary')
})
server.on('upgrade', (request, socket) => {
  requests.push(request.url)
  socket.destroy()
})
await new Promise((accept) => server.listen(0, '127.0.0.1', accept))
const canaryPort = server.address().port
for (const label of labels) {
  const reservation = createTcpServer()
  await new Promise((accept) => reservation.listen(0, '127.0.0.1', accept))
  ports[label] = reservation.address().port
  await new Promise((accept) => reservation.close(accept))
}
const executable = resolve(root, 'target/debug/examples/plugin-isolation-probe.exe')
report.applicationSha256 = createHash('sha256').update(readFileSync(executable)).digest('hex')
report.engine = JSON.parse(readFileSync(resolve(root, 'target/s03-probe/engine.json'), 'utf8'))
const controlFile = resolve(directory, 'control.txt')
const child = spawn(executable, [], {
  cwd: root,
  env: {
    ...process.env,
    AM_S03_DEBUG_PORTS: JSON.stringify(ports),
    AM_S03_CONTROL_FILE: controlFile,
  },
  windowsHide: true,
})
let output = ''
child.stdout.on('data', (data) => {
  output += data
})
child.stderr.on('data', (data) => {
  output += data
})
let exitCode
child.on('exit', (code) => {
  exitCode = code
})
function nativeEvents() {
  return output
    .split(/\r?\n/)
    .slice(0, -1)
    .filter((line) => line.startsWith('S03_NATIVE '))
    .map((line) => JSON.parse(line.slice(11)))
}
const invoke = (command, args = {}) =>
  `globalThis.__TAURI_INTERNALS__.invoke(${JSON.stringify(command)}, ${JSON.stringify(args)})`
const observe = async (label, expression) => clients[label].evaluate(expression)
const message = (epoch, sequence, extra = {}) =>
  JSON.stringify({
    epoch,
    sequence,
    observation: { worker: true, wasm: true, noHostGlobals: true },
    ...extra,
  })
const call = (label, fn, ...args) =>
  observe(label, `(${fn.toString()})(...${JSON.stringify(args)})`)
let controlSequence = 0
async function control(operation) {
  writeFileSync(controlFile, `${operation}:${++controlSequence}`)
  await delay(300)
}

try {
  for (const label of labels) {
    clients[label] = await connectWebview(ports[label])
    await clients[label].send('Network.enable')
    await clients[label].send('Runtime.enable')
    await clients[label].send('Page.enable')
    let ready = false
    for (let attempt = 0; attempt < 100 && !ready; attempt++) {
      ready = await observe(
        label,
        "Boolean(globalThis.s03Acceptance && globalThis.__TAURI_INTERNALS__ && document.readyState === 'complete')",
      )
      if (!ready) await delay(50)
    }
    assert(ready, `${label}: diagnostic bootstrap did not load`)
    if (label !== 's03-peer') {
      const previousLoads = clients[label].events.filter(
        (event) => event.method === 'Page.loadEventFired',
      ).length
      await clients[label].send('Page.reload')
      for (
        let attempt = 0;
        attempt < 100 &&
        clients[label].events.filter((event) => event.method === 'Page.loadEventFired').length ===
          previousLoads;
        attempt++
      )
        await delay(50)
      assert(
        await observe(label, 'Boolean(globalThis.s03Acceptance && globalThis.__TAURI_INTERNALS__)'),
      )
    }
    report.observations[label] = {
      url: clients[label].page.url,
      browser: await clients[label].send('Browser.getVersion'),
    }
    await observe(
      label,
      `globalThis.__s03Violations = []; addEventListener('securitypolicyviolation', event => __s03Violations.push({directive:event.effectiveDirective, blocked:event.blockedURI})); true`,
    )
  }
  await control('start-sessions')
  const manifests = JSON.parse(
    readFileSync(resolve(root, 'apps/tauri/src-tauri/gen/schemas/acl-manifests.json'), 'utf8'),
  )
  const commands = new Set()
  for (const [plugin, manifest] of Object.entries(manifests))
    for (const permission of Object.values(manifest.permissions))
      for (const command of permission.commands.allow ?? [])
        commands.add(
          plugin === '__app-acl__' ? command : `plugin:${plugin.replace(/^core:/, '')}|${command}`,
        )
  commands.delete('plugin_probe_relay')
  report.commands = [...commands].toSorted()
  for (const label of labels.slice(1)) {
    const results = await observe(
      label,
      `(async () => { const results = []; for (const command of ${JSON.stringify([...commands])}) { try { await __TAURI_INTERNALS__.invoke(command, {}); results.push({command, allowed:true}) } catch(error) { results.push({command, error:String(error)}) } } return results })()`,
    )
    report.observations[label].commands = results
    assert.equal(results.length, commands.size)
    assert(
      results.every(
        (result) => result.error && /not allowed|explicitly denied/i.test(result.error),
      ),
      `${label}: a command did not fail at the ACL boundary`,
    )
  }
  report.checks.actualCommandDenial = true
  const main = await observe(
    'main',
    `(async () => { const snapshot = await ${invoke('account_snapshot')}; const capabilities = await ${invoke('login_capabilities')}; await ${invoke('save_product_data', { value: { schemaVersion: 2, revision: 1, marker: runId } })}; return {snapshot, capabilities, product: await ${invoke('load_product_data')}, version: await ${invoke('plugin:app|version')} } })()`,
  )
  assert.equal(main.product.marker, runId)
  assert.equal(main.snapshot.accounts.length, 0)
  report.observations.main.positiveControl = main
  report.checks.mainProductCommands = true

  for (const label of ['s03-a', 's03-b']) {
    const vm = await observe(
      label,
      `new Promise((accept, reject) => { const worker = new Worker('/worker.js', {type:'module'}); const timer = setTimeout(() => { worker.terminate(); reject(Error('VM startup timeout')) }, 5000); worker.onmessage = event => {clearTimeout(timer); worker.terminate(); accept(event.data)}; worker.onerror = event => {clearTimeout(timer); worker.terminate(); reject(Error(event.message))} })`,
    )
    assert.deepEqual(vm, { worker: true, wasm: true, noHostGlobals: true })
    report.observations[label].vm = vm
  }
  report.checks.workerWasmStartup = true

  const networkControl = await observe(
    'main',
    `fetch('http://127.0.0.1:${canaryPort}/control').then(response => response.text())`,
  )
  assert.equal(networkControl, 'S03 synthetic canary')
  for (const label of ['s03-a', 's03-b']) {
    const blocked = await observe(
      label,
      `fetch('http://127.0.0.1:${canaryPort}/blocked-document').then(() => false, () => true)`,
    )
    assert(blocked)
    const workerCsp = await observe(
      label,
      `new Promise((accept, reject) => {const worker = new Worker('/network-worker.js', {type:'module'}); const timer = setTimeout(() => {worker.terminate(); reject(Error('CSP worker timeout'))}, 3000); worker.onmessage = event => {clearTimeout(timer); worker.terminate(); accept(event.data)}; worker.onerror = event => {clearTimeout(timer);worker.terminate(); reject(Error(event.message))}; worker.postMessage(${canaryPort})})`,
    )
    report.observations[label].workerCsp = workerCsp
    assert(workerCsp.fetchRejected && workerCsp.socketRejected)
    assert(
      workerCsp.violations.some(
        (value) => value.directive === 'connect-src' && value.blocked.startsWith('http:'),
      ),
    )
    assert(
      workerCsp.violations.some(
        (value) => value.directive === 'connect-src' && value.blocked.startsWith('ws:'),
      ),
    )
    await delay(200)
    const violations = await observe(label, '__s03Violations')
    assert(
      violations.some(
        (value) => value.directive === 'connect-src' && value.blocked.includes('/blocked-document'),
      ),
    )
    report.observations[label].documentCspViolations = violations
  }
  // A permissive product document can reach the canary, while its trusted Worker
  // still cannot: this distinguishes the Worker's own CSP from inherited denial.
  const mainWorkerCsp = await observe(
    'main',
    `new Promise((accept,reject)=>{const worker=new Worker('/network-worker.js',{type:'module'});const timer=setTimeout(()=>{worker.terminate();reject(Error('main Worker CSP timeout'))},3000);worker.onmessage=event=>{clearTimeout(timer);worker.terminate();accept(event.data)};worker.onerror=event=>{clearTimeout(timer);worker.terminate();reject(Error(event.message))};worker.postMessage(${canaryPort})})`,
  )
  assert(mainWorkerCsp.fetchRejected && mainWorkerCsp.socketRejected)
  assert(mainWorkerCsp.violations.some((value) => value.directive === 'connect-src'))
  report.observations.main.workerCsp = mainWorkerCsp
  assert.deepEqual(requests, ['/control'])
  report.checks.directNetworkDenial = true
  report.checks.documentCsp = true
  report.checks.workerCsp = true

  for (const label of labels) {
    const seed = await call(label, seedStorage, label)
    assert.deepEqual(seed.before, { localStorage: null, indexedDb: null, cache: null, cookie: '' })
    assert.deepEqual(seed.localMessages, [`local-${label}`])
    assert(seed.openerAbsent)
    report.observations[label].storageSeed = seed
  }
  for (const label of labels)
    await observe(label, `s03Channel.postMessage(${JSON.stringify(label)}); true`)
  await delay(300)
  for (const label of labels) {
    const storage = await call(label, readStorage)
    assert.deepEqual(storage, {
      localStorage: label,
      indexedDb: label,
      cache: label,
      cookie: `s03owner=${label}`,
      broadcasts: [],
    })
    report.observations[label].storage = storage
  }
  report.checks.originStorageIsolation = true
  report.checks.cookieCacheIsolation = true
  const eventName = `s03-${runId}`
  for (const label of labels) {
    const result = await observe(
      label,
      `(async () => { globalThis.__s03NativeEvents=[]; try { const id=await __TAURI_INTERNALS__.invoke('plugin:event|listen', {event:${JSON.stringify(eventName)}, target:{kind:'Any'}, handler:__TAURI_INTERNALS__.transformCallback(value=>__s03NativeEvents.push(value))}); return {id} } catch(error) {return {error:String(error)}} })()`,
    )
    if (label === 'main') assert.equal(typeof result.id, 'number')
    else assert(/not allowed/.test(result.error))
  }
  await observe(
    'main',
    invoke('plugin:event|emit', { event: eventName, payload: { marker: runId } }),
  )
  await delay(200)
  assert.equal((await observe('main', '__s03NativeEvents')).length, 1)
  for (const label of labels.slice(1))
    assert.deepEqual(await observe(label, '__s03NativeEvents'), [])
  for (const label of ['s03-a', 's03-b']) {
    const capabilities = await call(label, deniedBrowserCapabilities)
    report.observations[label].browserCapabilities = capabilities
    assert(
      capabilities.sharedWorkerDenied &&
        capabilities.serviceWorkerDenied &&
        capabilities.resourceDenied &&
        capabilities.openerAbsent,
    )
    assert(Object.values(capabilities.devices).every((value) => value === false))
    assert.equal(capabilities.mediaAccess.allowed, false)
    assert.deepEqual(capabilities.locationAccess, { allowed: false, code: 1 })
    const violation = await observe(label, '__s03Violations')
    assert(violation.some((value) => value.directive === 'frame-src'))
    await clients[label].send('Runtime.evaluate', {
      expression: `window.open(location.href)`,
      userGesture: true,
    })
    await clients[label].send('Runtime.evaluate', {
      expression: `{ const download=document.createElement('a'); download.href=location.href; download.download='s03-fixed.html'; document.body.append(download); download.click(); download.remove() }`,
      userGesture: true,
    })
    for (let attempt = 0; attempt < 50; attempt++) {
      if (nativeEvents().some((event) => event.event === 'download' && event.label === label)) break
      await delay(100)
    }
    await clients[label].send('Page.navigate', {
      url: `https://${label === 's03-a' ? 'am-s03-b' : 'tauri'}.localhost/index.html`,
    })
    await delay(200)
    assert.equal(await observe(label, 'location.href'), report.observations[label].url)
  }
  const browserEvents = nativeEvents()
  for (const label of ['s03-a', 's03-b']) {
    assert(
      browserEvents.some(
        (event) => event.event === 'new-window' && event.label === label && event.allowed === false,
      ),
    )
    assert(
      browserEvents.some(
        (event) => event.event === 'navigation' && event.label === label && event.allowed === false,
      ),
    )
    assert(
      browserEvents.some(
        (event) => event.event === 'download' && event.label === label && event.allowed === false,
      ),
    )
  }
  report.checks.broadcastSharedWorkerOpenerIsolation = true
  report.checks.resourceNavigationDownloadDeviceDenial = true
  const timeout = await call('s03-b', workerTimeout)
  assert.deepEqual(timeout, {
    terminated: 1,
    result: 'Probe timed out. Code plugins remain disabled.',
  })
  const late = await call('s03-b', lateAckAfterDispose)
  assert.deepEqual(late, { enteredRelay: true, terminated: 1, reports: [] })
  report.observations['s03-b'].lifecycle = { timeout, late }
  // Exercise a real document unload with a live Worker and an active native epoch.
  assert.deepEqual(
    await observe('s03-b', invoke('plugin_probe_relay', { message: message(1, 0) })),
    { sequence: 0, codePluginsEnabled: false },
  )
  await observe(
    's03-b',
    `globalThis.s03UnloadWorker=new Worker('/network-worker.js',{type:'module'});const dispose=s03Acceptance.startProbeSession({createWorker:()=>s03UnloadWorker,relay:()=>new Promise(()=>{}),report:()=>{throw Error('unloaded report')}});addEventListener('pagehide',dispose,{once:true});true`,
  )
  await delay(200)
  const targetsBefore = (await clients['s03-b'].send('Target.getTargets')).targetInfos
    .filter((value) => value.type === 'worker' && value.url.endsWith('/network-worker.js'))
    .map((value) => value.targetId)
  assert(targetsBefore.length > 0)
  const previousLoads = clients['s03-b'].events.filter(
    (value) => value.method === 'Page.loadEventFired',
  ).length
  await clients['s03-b'].send('Page.reload')
  for (let attempt = 0; attempt < 100; attempt++) {
    if (
      clients['s03-b'].events.filter((value) => value.method === 'Page.loadEventFired').length >
      previousLoads
    )
      break
    await delay(50)
  }
  const oldDocument = await observe(
    's03-b',
    `${invoke('plugin_probe_relay', { message: message(1, 1) })}.then(()=>({allowed:true}),error=>({error:String(error)}))`,
  )
  assert.match(oldDocument.error, /unknown probe caller/)
  const targetsAfter = new Set(
    (await clients['s03-b'].send('Target.getTargets')).targetInfos.map((value) => value.targetId),
  )
  assert(targetsBefore.every((value) => !targetsAfter.has(value)))
  report.observations['s03-b'].lifecycle.unload = {
    workerTargets: targetsBefore.length,
    oldWorkerTargetsGone: true,
    oldDocument,
  }
  await control('start-sessions')
  for (const label of ['s03-a', 's03-b'])
    assert.deepEqual(
      await observe(label, invoke('plugin_probe_relay', { message: message(2, 0) })),
      { sequence: 0, codePluginsEnabled: false },
    )
  await control('close-a')
  assert(
    nativeEvents().some(
      (event) =>
        event.event === 'destroyed' &&
        event.label === 's03-a' &&
        !event.remainingSessions.includes('s03-a') &&
        event.remainingSessions.includes('s03-b'),
    ),
  )
  async function rejected(messageText) {
    return observe(
      's03-b',
      `${invoke('plugin_probe_relay', { message: messageText })}.then(()=>({allowed:true}), error=>({error:String(error)}))`,
    )
  }
  assert.match((await rejected(message(2, 0))).error, /stale or replayed/)
  assert.match((await rejected(message(2, 1))).error, /unknown probe caller/)
  await control('reset-b')
  assert.match((await rejected(message(2, 0))).error, /stale or replayed/)
  await control('reset-b')
  assert.match(
    (await rejected(message(4, 0, { userConfirmed: true, pluginId: 's03-a' }))).error,
    /invalid probe/,
  )
  await control('reset-b')
  assert.deepEqual(
    await observe('s03-b', invoke('plugin_probe_relay', { message: message(5, 0) })),
    { sequence: 0, codePluginsEnabled: false },
  )
  await control('reset-b')
  assert.match((await rejected('x'.repeat(4097))).error, /budget exhausted/)
  await control('reset-b')
  const countBudget = await observe(
    's03-b',
    `(async()=>{for(let sequence=0;sequence<32;sequence++)await __TAURI_INTERNALS__.invoke('plugin_probe_relay',{message:JSON.stringify({epoch:7,sequence,observation:{worker:true,wasm:true,noHostGlobals:true}})});return __TAURI_INTERNALS__.invoke('plugin_probe_relay',{message:JSON.stringify({epoch:7,sequence:32,observation:{worker:true,wasm:true,noHostGlobals:true}})}).then(()=>({allowed:true}),error=>({error:String(error)}))})()`,
  )
  assert.match(countBudget.error, /budget exhausted/)
  await control('reset-b')
  const byteBudget = await observe(
    's03-b',
    `(async()=>{for(let sequence=0;sequence<16;sequence++)await __TAURI_INTERNALS__.invoke('plugin_probe_relay',{message:JSON.stringify({epoch:8,sequence,observation:{worker:true,wasm:true,noHostGlobals:true}}).padEnd(4096,' ')});return __TAURI_INTERNALS__.invoke('plugin_probe_relay',{message:JSON.stringify({epoch:8,sequence:16,observation:{worker:true,wasm:true,noHostGlobals:true}})}).then(()=>({allowed:true}),error=>({error:String(error)}))})()`,
  )
  assert.match(byteBudget.error, /budget exhausted/)
  report.observations['s03-b'].budgets = {
    oversizedBytes: 4097,
    acceptedMessages: 32,
    acceptedSessionBytes: 65536,
    countBudget,
    byteBudget,
  }
  await control('reset-b')
  assert.deepEqual(
    await observe('s03-b', invoke('plugin_probe_relay', { message: message(9, 0) })),
    { sequence: 0, codePluginsEnabled: false },
  )
  report.checks.nativeSessionDisposal = true
  report.deliveredPolicies = Object.fromEntries(
    Object.entries(clients).map(([label, client]) => [
      label,
      client.events
        .filter((event) => event.method === 'Network.responseReceived')
        .map((event) => event.params.response)
        .filter(
          (response) =>
            response.url.endsWith('/index.html') ||
            response.url.endsWith('/worker.js') ||
            response.url.endsWith('/network-worker.js'),
        )
        .map((response) => ({
          url: response.url,
          status: response.status,
          csp: Object.entries(response.headers).find(
            ([name]) => name.toLowerCase() === 'content-security-policy',
          )?.[1],
        })),
    ]),
  )
  for (const label of ['main', 's03-b']) {
    const policies = report.deliveredPolicies[label]
    assert(
      policies.some(
        (value) =>
          value.url.endsWith('/index.html') &&
          value.status === 200 &&
          value.csp?.includes('default-src'),
      ),
    )
  }
  // The product document permits same-origin header observation. The Worker
  // executes the separate network-denial test under its own response policy.
  const workerResponse = await observe(
    'main',
    `(async()=>{const response=await fetch('/network-worker.js');return {status:response.status,headers:Object.fromEntries(response.headers),bytes:(await response.text()).length}})()`,
  )
  assert(workerResponse.status === 200 && workerResponse.bytes < 8192)
  assert(
    Object.entries(workerResponse.headers).some(
      ([key, value]) =>
        key.toLowerCase() === 'content-security-policy' && value.includes("connect-src 'none'"),
    ),
  )
  report.workerResponseHeaders = workerResponse.headers
  report.status = 'passed'
} catch (error) {
  report.status = 'failed'
  report.error = error.stack
  process.exitCode = 1
} finally {
  await control('shutdown')
  for (let attempt = 0; attempt < 80; attempt++) {
    if (exitCode !== undefined) break
    await delay(100)
  }
  if (exitCode === undefined) {
    child.kill()
    await delay(1000)
  }
  for (const client of Object.values(clients)) client.close()
  report.nativeEvents = nativeEvents()
  report.browserDiagnostics = Object.fromEntries(
    Object.entries(clients).map(([label, client]) => [
      label,
      client.events.filter((event) =>
        /Runtime.exceptionThrown|Network.loadingFailed|Log.entryAdded/.test(event.method),
      ),
    ]),
  )
  report.gracefulExit =
    exitCode === 0 &&
    report.nativeEvents.some((event) => event.event === 'exit' && event.remainingSessions === 0)
  const profileRoots = [
    ...new Set(
      report.nativeEvents.filter((event) => event.event === 'profile').map((event) => event.root),
    ),
  ]
  report.profileCleanup = []
  for (const profileRoot of profileRoots) {
    // Delete only the unique synthetic profile root reported by this child.
    assert.equal(dirname(resolve(profileRoot)), resolve(tmpdir()))
    assert(/^any-music-s03-[0-9a-f-]{36}$/.test(basename(profileRoot)))
    for (let attempt = 0; attempt < 50 && existsSync(profileRoot); attempt++) {
      try {
        rmSync(profileRoot, { recursive: true })
      } catch {
        await delay(200)
      }
    }
    report.profileCleanup.push({ root: profileRoot, removed: !existsSync(profileRoot) })
  }
  if (!report.gracefulExit || report.profileCleanup.some((value) => !value.removed)) {
    report.status = 'failed'
    report.cleanupError = 'Native exit/session disposal or profile cleanup failed'
    process.exitCode = 1
  }
  report.canaryRequests = requests
  if (report.status === 'passed') {
    try {
      report.acceptance = validateIsolationAcceptance(report, report.commands)
    } catch (error) {
      report.status = 'failed'
      report.error = error.stack
      process.exitCode = 1
    }
  }
  report.finishedAt = new Date().toISOString()
  writeFileSync(resolve(directory, 'report.json'), JSON.stringify(report, null, 2) + '\n')
  writeFileSync(resolve(directory, 'native.log'), output)
  server.close()
  console.log(
    JSON.stringify(
      { directory, status: report.status, checks: report.checks, error: report.error },
      null,
      2,
    ),
  )
}
