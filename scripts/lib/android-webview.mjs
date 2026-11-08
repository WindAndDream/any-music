import assert from 'node:assert/strict'
import { setTimeout as delay } from 'node:timers/promises'

// Polling must finish each attempt before inspecting its result or retrying.
/* oxlint-disable eslint/no-await-in-loop */
async function withDeadline(promise, milliseconds, message) {
  let timer
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), milliseconds)
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

/** Debug-only inspection of this app's explicitly selected emulator process. No
 * production test commands/JS bridge are added to obtain live acceptance. */
export async function inspectAndroidWorkbench(adb, fixtureHash) {
  let forward
  let socket
  const pending = new Map()
  let sequence = 0
  async function disconnect() {
    socket?.close()
    socket = undefined
    if (forward) adb(['forward', '--remove', `tcp:${forward}`])
    forward = undefined
  }
  async function connect() {
    const deadline = Date.now() + 30_000
    let page
    while (Date.now() < deadline) {
      const pid = adb(['shell', 'pidof', 'com.anymusic.app']).trim()
      assert(/^\d+$/.test(pid), 'Expected one product process')
      if (!forward)
        forward = adb(['forward', 'tcp:0', `localabstract:webview_devtools_remote_${pid}`]).trim()
      try {
        const response = await fetch(`http://127.0.0.1:${forward}/json/list`, {
          signal: AbortSignal.timeout(2000),
        })
        const pages = await response.json()
        page = pages.find(
          (target) => target.type === 'page' && new URL(target.url).hostname === 'tauri.localhost',
        )
        if (page) break
      } catch {
        /* The dedicated debug WebView is still starting. */
      }
      await delay(100)
    }
    assert(page, 'Main product debug WebView did not appear')
    const debuggerUrl = new URL(page.webSocketDebuggerUrl)
    assert.equal(debuggerUrl.hostname, '127.0.0.1')
    assert.equal(debuggerUrl.port, forward)
    socket = new WebSocket(debuggerUrl)
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data)
      const request = pending.get(message.id)
      if (!request) return
      pending.delete(message.id)
      if (message.error) request.reject(new Error(message.error.message))
      else request.resolve(message.result)
    })
    await withDeadline(
      new Promise((resolve, reject) => {
        socket.addEventListener('open', () => resolve(), { once: true })
        socket.addEventListener('error', () => reject(new Error('Debug WebSocket failed')), {
          once: true,
        })
      }),
      10_000,
      'Debug WebSocket open timed out',
    )
  }
  async function evaluate(expression) {
    const id = ++sequence
    const response = new Promise((resolve, reject) => pending.set(id, { resolve, reject }))
    socket.send(
      JSON.stringify({
        id,
        method: 'Runtime.evaluate',
        params: { expression, awaitPromise: true, returnByValue: true },
      }),
    )
    const result = await withDeadline(response, 15_000, 'Debug evaluation timed out').finally(() =>
      pending.delete(id),
    )
    assert(!result.exceptionDetails, result.exceptionDetails?.text ?? 'Product evaluation failed')
    return result.result.value
  }
  async function mounted() {
    const deadline = Date.now() + 30_000
    while (Date.now() < deadline) {
      if (
        await evaluate(
          "!!document.querySelector('.native-app.am-root') && !!window.__TAURI_INTERNALS__",
        )
      )
        return
      await delay(100)
    }
    throw new Error('Real workbench failed to mount')
  }
  const snapshotHash = `(async () => {
    const snapshot = await window.__TAURI_INTERNALS__.invoke('load_product_data');
    const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
      ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
    // Journal, old generations and mirror revisions legitimately change on startup.
    // The mounted product has validated this commit; compare all active ownership
    // parts, including unknown namespaces, without copying its checksum algorithm.
    const commit = snapshot.values?.['product-data:commit'];
    if (!commit || typeof commit.id !== 'string') throw new Error('Missing committed generation');
    const data = JSON.stringify(canonical(Object.fromEntries(['core','host','namespaces','archives'].map(part => {
      const key = 'product-data:g' + commit.slot + ':' + commit.id + ':' + part;
      if (!(key in snapshot.values)) throw new Error('Incomplete committed generation');
      return [part, snapshot.values[key]];
    }))));
    const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(data));
    return Array.from(new Uint8Array(hash), n => n.toString(16).padStart(2, '0')).join('');
  })()`
  try {
    await connect()
    await mounted()
    const checks = await evaluate(`(async () => {
      const invoke = window.__TAURI_INTERNALS__.invoke;
      const caps = await invoke('runtime_capabilities');
      const loginCaps = await invoke('login_capabilities');
      const denials = {};
      for (const command of ['begin_browser_login', 'plugin_package_install', 'plugin_command_run', 'plugin_dev_begin', 'plugin:mobile-platform|credentialKey']) {
        try { await invoke(command); denials[command] = false; }
        catch (error) { denials[command] = /not allowed|not found|denied/i.test(String(error)); }
      }
      let privateTargetRejected = false;
      try { await invoke('plugin_package_url_preview', {url:'https://127.0.0.1/package.amplugin'}); }
      catch { privateTargetRejected = true; }
      await WebAssembly.compile(new Uint8Array([0,97,115,109,1,0,0,0]));
      const audioWorkerUrl = URL.createObjectURL(new Blob(['postMessage("ready")'], {type:'text/javascript'}));
      const audioWorker = new Worker(audioWorkerUrl);
      let trustedAudioWorker;
      try {
        trustedAudioWorker = await new Promise(resolve => {
          const timeout = setTimeout(() => resolve(false), 3000);
          audioWorker.onmessage = () => { clearTimeout(timeout); resolve(true); };
          audioWorker.onerror = () => { clearTimeout(timeout); resolve(false); };
        });
      } finally { audioWorker.terminate(); URL.revokeObjectURL(audioWorkerUrl); }
      return {caps, loginCaps, denials, privateTargetRejected, trustedAudioWorker};
    })()`)
    assert.equal(checks.caps.platform, 'android')
    assert.equal(checks.caps.externalPlugins, 'none')
    assert.equal(checks.caps.accountTransport, 'provided')
    assert.equal(checks.caps.accountProxy, 'provided')
    assert.equal(checks.caps.media, 'provided')
    assert.equal(checks.trustedAudioWorker, true, 'Bundled audio encoding worker was blocked')
    assert.equal(checks.loginCaps.qrPresentation, 'handoff')
    assert.equal(checks.loginCaps.verification, 'unavailable')
    for (const key of ['systemBrowser', 'backgroundExecution'])
      assert.equal(checks.caps[key], 'unavailable')
    assert(
      Object.values(checks.denials).every(Boolean) && checks.privateTargetRejected,
      'Native denials failed',
    )
    const before = await evaluate(snapshotHash)
    adb([
      'shell',
      'am',
      'start',
      '-W',
      '--grant-read-uri-permission',
      '-a',
      'android.intent.action.VIEW',
      '-t',
      'application/vnd.anymusic.plugin+zip',
      '-d',
      'content://com.anymusic.app.test.documents/valid-package',
      '-n',
      'com.anymusic.app/.BootstrapActivity',
    ])
    let preview
    const previewDeadline = Date.now() + 10_000
    while (!preview && Date.now() < previewDeadline) {
      preview = await evaluate(
        "window.__TAURI_INTERNALS__.invoke('plugin_package_current_preview')",
      )
      if (!preview) await delay(100)
    }
    assert.equal(
      preview?.contentHash,
      fixtureHash,
      'Forwarded content URI did not produce the verified package bytes',
    )
    assert.equal(preview.canInstall, false, 'Mobile preview cannot grant installation')
    adb(['shell', 'input', 'keyevent', 'KEYCODE_HOME'])
    adb(['shell', 'am', 'start', '-W', '-n', 'com.anymusic.app/.BootstrapActivity'])
    await mounted()
    assert.equal(
      await evaluate(snapshotHash),
      before,
      'Backgrounding changed committed product data',
    )
    assert.equal(
      await evaluate("window.__TAURI_INTERNALS__.invoke('plugin_package_current_preview')"),
      null,
    )
    await disconnect()
    adb(['shell', 'am', 'force-stop', 'com.anymusic.app'])
    adb(['shell', 'am', 'start', '-W', '-n', 'com.anymusic.app/.BootstrapActivity'])
    await connect()
    await mounted()
    assert.equal(
      await evaluate(snapshotHash),
      before,
      'Process restart changed committed product data',
    )
    assert.equal(
      await evaluate("window.__TAURI_INTERNALS__.invoke('plugin_package_current_preview')"),
      null,
    )
    return {
      ...checks,
      contentIntentForwarding: true,
      previewContentSha256: preview.contentHash,
      previewCanInstall: false,
      mounted: true,
      backgroundRecovery: true,
      processRestartRecovery: true,
      committedDataSha256: before,
      forcedActivityRecreationAccepted: false,
    }
  } finally {
    await disconnect()
  }
}
