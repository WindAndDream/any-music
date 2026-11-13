// Each step depends on the preceding native transaction or observation.
/* oxlint-disable eslint/no-await-in-loop */
/** Explicit real Windows/WebView acceptance. Never called by root test/build. Run only
 * after authorizing application launch; all profiles and packages are synthetic and isolated. */
import assert from 'node:assert/strict'
import { spawn, execFileSync } from 'node:child_process'
import {
  readFileSync,
  writeFileSync,
  existsSync,
  openSync,
  mkdirSync,
  rmSync,
  realpathSync,
  readdirSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve, join, dirname, basename } from 'node:path'
import { fileURLToPath } from 'node:url'

import { checkDeliveryIsolation } from './delivery-isolation-checks.mjs'
import { connectWebview, delay } from './isolation-cdp.mjs'
const root = fileURLToPath(new URL('../../../', import.meta.url))
assert(process.argv.includes('--run'), 'Application launch requires explicit --run')
assert.equal(process.platform, 'win32')
const evidence = resolve(root, '.tmp/s15-completion/live')
mkdirSync(evidence, { recursive: true })
const { consumer, cli } = JSON.parse(readFileSync(resolve(root, '.tmp/s15/consumer.json')))
const runCli = (args) =>
  JSON.parse(
    execFileSync(process.execPath, [cli, ...args, '--json'], { cwd: consumer, encoding: 'utf8' }),
  ).result
const control = join(evidence, 'control.json')
rmSync(control, { force: true })
const app = spawn(resolve(root, 'target/debug/examples/plugin-delivery-acceptance.exe'), [], {
  windowsHide: true,
  stdio: [
    'ignore',
    openSync(join(evidence, 'stdout.log'), 'w'),
    openSync(join(evidence, 'stderr.log'), 'w'),
  ],
  env: {
    ...process.env,
    AM_S15_CONTROL_FILE: control,
    AM_S15_MAIN_PORT: '24320',
    AM_S15_EXECUTOR_BASE_PORT: '24321',
    AM_S15_DEV_PROJECT: join(consumer, 'source-code'),
    ...(process.argv.includes('--production') ? { AM_S15_USE_PRODUCTION_ADMISSION: '1' } : {}),
  },
})
let main, dev, report
const checks = {}
const invoke = async (name, args = {}) => {
  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      return await main.evaluate(
        `globalThis.__TAURI_INTERNALS__.invoke(${JSON.stringify(name)},${JSON.stringify(args)})`,
      )
    } catch (error) {
      if (!String(error).includes('繁忙') || attempt === 29) throw error
      await delay(100)
    }
  }
}
const states = () => invoke('plugin_authority_snapshot')
const install = async (path, transferData = false) => {
  const preview = await invoke('plugin_package_preview', {
    bytes: [...readFileSync(path)],
    legacy: false,
  })
  assert(preview.canInstall, preview.blockedReason)
  assert.equal(preview.publisherVerified, false)
  await invoke('plugin_package_install', {
    token: preview.token,
    capabilities: preview.permissions.filter((capability) => capability !== 'network.publicHttps'),
    transferData,
    userLinkedNetwork: false,
  })
  return (await states()).find((s) => s.pluginId === preview.pluginId && !s.dev)
}
const command = (s, input = {}, name = s.commands[0].id) =>
  invoke('plugin_command_run', {
    installId: s.installId,
    command: name,
    inputJson: JSON.stringify(input),
  })
async function waitFor(test, attempts = 150) {
  for (let i = 0; i < attempts; i++) {
    const value = await test()
    if (value) return value
    await delay(100)
  }
  throw Error('Live acceptance timeout')
}
try {
  main = await connectWebview(24320)
  await waitFor(() => existsSync(control))
  await waitFor(() => main.evaluate("document.body.innerText.includes('跨来源音乐工作台')"))
  await main.evaluate(
    `Array.from(document.querySelectorAll('button')).find(b=>b.textContent.includes('插件中心')).click()`,
  )
  await waitFor(() => main.evaluate(`!!document.querySelector('.am-native-plugins')`))
  checks.actualProductUi = true
  assert.equal((await states()).length, 0)
  const installed = []
  for (const template of ['source-code', 'source-declarative', 'tag-suggestion', 'export']) {
    const s = await install(join(consumer, template + '.amplugin'))
    installed.push(s)
    const output = await command(s, {
      query: 'live',
      items: [{ id: 'selected', title: 'Live concert' }],
    })
    if (template.startsWith('source')) assert.equal(output.value.items[0].title, 'Live concert')
    if (template === 'tag-suggestion') assert.equal(output.value.saved, true)
    if (template === 'export') assert.equal(output.value.text, 'Live concert')
  }
  checks.fourInstalledTemplates = true
  checks.sameVmNamedBridge = true
  await main.evaluate(
    `Array.from(document.querySelectorAll('.am-native-plugins button')).find(button=>button.textContent==='刷新授权状态').click()`,
  )
  await delay(200)
  await main.evaluate(`document.querySelector('[data-am-focus-key="navigation:catalog"]').click()`)
  await main.evaluate(`document.querySelector('button.music-source-picker-button').click()`)
  await waitFor(() =>
    main.evaluate(
      `Array.from(document.querySelectorAll('.music-source-picker__option')).some(button=>button.textContent.includes('org.example.source-code'))`,
    ),
  )
  await main.evaluate(
    `Array.from(document.querySelectorAll('.music-source-picker__option')).find(button=>button.textContent.includes('org.example.source-code')).click()`,
  )
  await main.evaluate(
    `Array.from(document.querySelectorAll('button')).find(button=>button.textContent.trim()==='搜索音乐').click()`,
  )
  await waitFor(() => main.evaluate(`!!document.querySelector('#am-source-search')`))
  await main.evaluate(
    `const input=document.querySelector('#am-source-search');input.value='live';input.dispatchEvent(new Event('input',{bubbles:true}));true`,
  )
  await main.evaluate(`document.querySelector('#am-source-search').closest('form').requestSubmit()`)
  await waitFor(() =>
    main.evaluate(`!!document.querySelector('.catalog-card[data-status="ready"]')`),
  )
  await main.evaluate(`document.querySelector('.catalog-card__view').click()`)
  await waitFor(() => main.evaluate(`document.body.innerText.includes('Live concert')`))
  checks.nativeSourceContributionSearchInWorkbench = true
  await main.evaluate(`document.querySelector('[data-am-focus-key="navigation:plugins"]').click()`)
  if (process.argv.includes('--dialogs')) {
    const exported = await command(installed[3], {
      items: [{ id: 'synthetic', title: 'S15 synthetic export' }],
    })
    for (const [method, args, file, expected] of [
      [
        'plugin_result_save',
        { token: exported.token },
        'plugin-output.txt',
        'S15 synthetic export',
      ],
      ['plugin_diagnostics_export', {}, 'any-music-plugin-diagnostics.json', undefined],
      ['plugin_package_pick_preview', {}, undefined, undefined],
    ]) {
      const destination = file ? join(root, file) : join(consumer, 'export.amplugin')
      if (file)
        assert(
          !existsSync(destination),
          'Refuse to overwrite an existing file during interactive acceptance',
        )
      console.log('S15_NATIVE_DIALOG ' + JSON.stringify({ method, destination }))
      await main.evaluate(
        `globalThis.s15DialogResult=null;__TAURI_INTERNALS__.invoke(${JSON.stringify(method)},${JSON.stringify(args)}).then(value=>s15DialogResult={ok:true,value},()=>s15DialogResult={ok:false});true`,
      )
      let result
      for (let attempt = 0; attempt < 1800; attempt++) {
        result = await main.evaluate('s15DialogResult')
        if (result) break
        await delay(100)
      }
      assert(result?.ok && result.value, 'Native dialog must complete successfully')
      if (expected) assert.equal(readFileSync(destination, 'utf8'), expected)
      if (method === 'plugin_diagnostics_export')
        assert(Array.isArray(JSON.parse(readFileSync(destination, 'utf8'))))
      if (method === 'plugin_package_pick_preview') {
        assert.equal(result.value.pluginId, installed[3].pluginId)
        await invoke('plugin_package_discard_preview', { token: result.value.token })
      }
      if (file) rmSync(destination)
    }
    checks.actualNativeExportDiagnosticsAndFilePicker = true
  }
  const initial = installed[0]
  const manifestPath = join(consumer, 'source-code/plugin.json')
  const manifest = JSON.parse(readFileSync(manifestPath))
  manifest.version = '0.2.0'
  writeFileSync(manifestPath, JSON.stringify(manifest))
  const update = join(consumer, 'source-code-update-' + Date.now() + '.amplugin')
  runCli(['pack', '--project', 'source-code', '--output', update, '--reproducible'])
  const updated = await install(update, true)
  assert(updated.generation > initial.generation)
  assert(updated.permissionEpoch > initial.permissionEpoch)
  assert.notEqual(updated.contentHash, initial.contentHash)
  assert.equal(
    (await command(updated, { query: 'studio' })).value.items[0].title,
    'Studio recording',
  )
  await invoke('plugin_package_rollback', { installId: updated.installId })
  const rolled = (await states()).find((s) => s.installId === updated.installId)
  assert.equal(rolled.enabled, false)
  assert(rolled.permissionEpoch > updated.permissionEpoch)
  await assert.rejects(command(rolled, { query: 'live' }))
  const confirmed = await install(join(consumer, 'source-code.amplugin'), true)
  assert.equal((await command(confirmed, { query: 'live' })).value.items[0].title, 'Live concert')
  checks.updatePairedRollbackAndFreshConsent = true
  await invoke('plugin_authority_revoke', { installId: confirmed.installId })
  await assert.rejects(command(confirmed, { query: 'live' }))
  checks.revocationBlocksExecution = true
  const host = JSON.parse(readFileSync(control))
  // The same packed CLI drives the real owner-ACL pipe, immutable preview and native install.
  dev = spawn(
    process.execPath,
    [cli, 'dev', '--project', 'source-code', '--pairing-file', host.pairing.pairingPath, '--json'],
    { cwd: consumer, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
  )
  let devOutput = ''
  dev.stderr.on('data', (chunk) => {
    devOutput += chunk.toString()
  })
  let preview = await waitFor(() =>
    invoke('plugin_package_current_preview').then((p) => p?.dev && p),
  )
  await invoke('plugin_package_install', {
    token: preview.token,
    capabilities: preview.permissions.filter((capability) => capability !== 'network.publicHttps'),
    transferData: false,
    userLinkedNetwork: false,
  })
  await waitFor(() => devOutput.includes('DEV_ACTIVE'))
  const firstDev = (await states()).find((s) => s.dev)
  assert(firstDev)
  assert.notEqual(firstDev.installId, initial.installId)
  assert.equal((await command(firstDev, { query: 'live' })).value.items[0].title, 'Live concert')
  const beforeReload = devOutput.length
  manifest.version = '0.3.0'
  writeFileSync(manifestPath, JSON.stringify(manifest))
  preview = await waitFor(() =>
    invoke('plugin_package_current_preview').then(
      (p) => p?.dev && p.contentHash !== firstDev.contentHash && p,
    ),
  )
  await invoke('plugin_package_install', {
    token: preview.token,
    capabilities: preview.permissions.filter((capability) => capability !== 'network.publicHttps'),
    transferData: true,
    userLinkedNetwork: false,
  })
  await waitFor(() => devOutput.slice(beforeReload).includes('DEV_ACTIVE'))
  const secondDev = (await states()).find((s) => s.dev)
  assert.notEqual(secondDev.contentHash, firstDev.contentHash)
  assert(secondDev.permissionEpoch > firstDev.permissionEpoch)
  await invoke('plugin_dev_end')
  await assert.rejects(command(secondDev, { query: 'live' }))
  checks.realDevAclInstallReloadAndDisconnect = true
  const diagnostics = await invoke('plugin_diagnostics')
  assert(diagnostics.some((d) => d.outcome === 'denied-or-budget'))
  const serialized = JSON.stringify(diagnostics)
  for (const secret of ['Live concert', consumer, host.root, 'Cookie', 'pairingPath'])
    assert(!serialized.includes(secret))
  checks.redactedDiagnostics = true
  for (const url of [
    'https://127.0.0.1/plugin.amplugin',
    'https://user:secret@example.com/a',
    'anymusic://plugins/install?url=https%3A%2F%2F127.0.0.1%2Fa',
    'anymusic://plugins/install?url=https%3A%2F%2Fexample.com%2Fa&extra=1',
  ])
    await assert.rejects(invoke('plugin_package_url_preview', { url }))
  checks.nativeAcquisitionRejectsPrivateAndCredentialLinks = true
  // Main may not use the executor relay even when its JSON envelope is valid.
  await assert.rejects(invoke('plugin_executor_relay', { message: '{"type":"bootstrap"}' }))
  checks.mainCannotUseExecutorRelay = true
  await checkDeliveryIsolation({ main, invoke, install, command, consumer, root, checks, evidence })
  const profiles = join(host.root, 'native', 'plugin-packages', 'executor-profiles')
  await waitFor(() => !existsSync(profiles) || readdirSync(profiles).length === 0, 450)
  checks.executorProfilesReclaimedBeforeExit = true
  const screenshot = await main.send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(join(evidence, 'product.png'), Buffer.from(screenshot.data, 'base64'))
  report = {
    scope: 'S15',
    date: new Date().toISOString(),
    os: host.os,
    arch: host.arch,
    osBuild: host.osBuild,
    webview: host.webview,
    resources: JSON.parse(readFileSync(resolve(root, 'target/s15-executor/resources.json'))),
    profileHash: JSON.parse(readFileSync(resolve(root, 'packages/plugin-vm/engine/profile.json')))
      .profileHash,
    productionAdmission: process.argv.includes('--production'),
    checks,
  }
} catch (error) {
  if (main)
    writeFileSync(
      join(evidence, 'failure.txt'),
      await main.evaluate('document.body.innerText').catch(() => ''),
    )
  throw error
} finally {
  dev?.kill()
  if (main) {
    await main
      .evaluate(
        `globalThis.__TAURI_INTERNALS__.invoke('plugin:window|close',{label:'main'}).catch(()=>{})`,
      )
      .catch(() => {})
    main.close()
  }
  await Promise.race([new Promise((accept) => app.once('exit', accept)), delay(2000)])
  if (app.exitCode === null) app.kill()
  await Promise.race([new Promise((accept) => app.once('exit', accept)), delay(1000)])
  if (existsSync(control)) {
    const path = JSON.parse(readFileSync(control)).root
    const owned = realpathSync(path)
    assert.equal(dirname(owned), realpathSync(tmpdir()))
    assert.equal(basename(owned), basename(path))
    assert.match(basename(path), /^any-music-s15-[a-f0-9-]{36}$/)
    for (let attempt = 0; attempt < 80; attempt++) {
      try {
        rmSync(owned, { recursive: true, force: true })
        break
      } catch {
        await delay(100)
      }
    }
    assert(!existsSync(path), 'All owned temporary profiles and DEV state must be reclaimed')
    checks.temporaryProfilesAndDevStateReclaimed = true
  }
  if (report) {
    writeFileSync(join(evidence, 'delivery.json'), JSON.stringify(report, null, 2) + '\n')
    console.log(JSON.stringify(report, null, 2))
  }
}
