// Each step depends on the preceding native transaction or observation.
/* oxlint-disable eslint/no-await-in-loop */
/** Adversarial fixtures use only the installed public tool API. They bypass author lint
 * deliberately so target admission also exercises hostile package bytes in the real VM. */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { writeFileSync, readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { join, resolve } from 'node:path'

import { seedStorage, readStorage } from './isolation-browser-checks.mjs'
import { connectWebview, delay } from './isolation-cdp.mjs'

export async function checkDeliveryIsolation({
  main,
  invoke,
  install,
  command,
  consumer,
  root,
  checks,
  evidence,
}) {
  writeFileSync(
    join(consumer, 'adversarial-fixtures.mjs'),
    `
import {readPackage,sealPackage} from '@any-music/plugin-cli';
import {writeFileSync} from 'node:fs';
const base=await readPackage('export.amplugin');
const fixtures={
 canary: "export default function run(){const names=['window','document','fetch','XMLHttpRequest','WebSocket','EventSource','__TAURI_INTERNALS__','localStorage','indexedDB','caches','navigator','process','require','WebAssembly','SharedArrayBuffer','Atomics'];let dynamic=false;try{Function('return 1')();dynamic=true}catch{};return {kind:'complete',outputJson:JSON.stringify({globals:Object.fromEntries(names.map(n=>[n,typeof globalThis[n]])),dynamic})}}",
 hold: "export default async function run(){await sleep(25000);return {kind:'complete',outputJson:'true'}}",
 cancel: "export default async function run(){await sleep(25000);return {kind:'complete',outputJson:'true'}}",
 loop: "export default function run(){while(true){}}",
 network: "export default function run(inv){return {kind:'host',request:{wireVersion:1,requestId:'call-'+inv.sequence,contextRef:inv.contextRef,deadlineMs:inv.deadlineMs,operation:'network.request',input:{url:'https://example.com',method:'GET'}},checkpointJson:'null'}}",
 context: "export default function run(inv){return {kind:'host',request:{wireVersion:1,requestId:'call-'+inv.sequence,contextRef:'forged',deadlineMs:inv.deadlineMs,operation:'state.get',input:{key:'one'}},checkpointJson:'null'}}"
 ,command: "export default function run(inv){return {kind:'complete',outputJson:JSON.stringify(inv.commandId)}}"
 ,prefix: "export default function run(inv){return {kind:'complete',outputJson:JSON.stringify(JSON.parse(inv.inputJson).items || [])}}"
};
for(const [name,source] of Object.entries(fixtures)){
 const files=new Map([...base.files].filter(([p])=>!['integrity.json','signature.json'].includes(p)));
 const manifest={...base.manifest,id:'org.example.s15-'+name,commands:(name==='command'?['run','other']:name==='prefix'?['search','music.search']:['run']).map(id=>({id,title:{en:'Synthetic isolation probe','zh-CN':'合成隔离探针'}})),capabilities:['network','prefix'].includes(name)?[{id:'network.publicHttps',version:1,required:true,reason:{en:'Probe','zh-CN':'探针'}}]:name==='context'?[{id:'state.read',version:1,required:true,reason:{en:'Probe','zh-CN':'探针'}}]:[]};
 if(name==='prefix')manifest.contributions=[{contributionId:'catalog',pointId:'music.sources',contractVersion:1,required:true,title:{en:'Catalog','zh-CN':'目录'},scope:{sections:['catalog'],forms:['desktop']},providerId:manifest.id,inputSchemaId:'urn:any-music:plugin:command-context:1',eventSchemaId:'urn:any-music:plugin:ui-event:1',cardinality:'many',fallback:'hidden',budgetProfileVersion:1}];
 files.set('manifest.json',Buffer.from(JSON.stringify(manifest)));files.set('dist/main.js',Buffer.from(source));writeFileSync('s15-'+name+'.amplugin',sealPackage(files));
}
`,
  )
  execFileSync(process.execPath, ['adversarial-fixtures.mjs'], { cwd: consumer, stdio: 'pipe' })
  const routed = await install(join(consumer, 's15-command.amplugin'))
  assert.equal((await command(routed, { commandId: 'forged' }, 'run')).value, 'run')
  assert.equal((await command(routed, {}, 'other')).value, 'other')
  checks.nativeCommandIdentityIsBound = true
  console.log('S15 isolation: guest globals')
  const canary = await install(join(consumer, 's15-canary.amplugin'))
  const result = (await command(canary)).value
  assert(Object.values(result.globals).every((value) => value === 'undefined'))
  assert.equal(result.dynamic, false)
  checks.actualGuestNoHostGlobalsOrDynamicCode = true
  console.log('S15 isolation: CPU budget')
  const loop = await install(join(consumer, 's15-loop.amplugin'))
  const started = Date.now()
  await assert.rejects(command(loop))
  assert(Date.now() - started < 5000)
  checks.actualGuestCpuTermination = true
  const forged = await install(join(consumer, 's15-context.amplugin'))
  await assert.rejects(command(forged))
  checks.nativeContextSubstitutionRejected = true
  const preview = await invoke('plugin_package_preview', {
    bytes: [...readFileSync(join(consumer, 's15-network.amplugin'))],
    legacy: false,
  })
  await invoke('plugin_package_install', {
    token: preview.token,
    capabilities: preview.permissions,
    transferData: false,
    userLinkedNetwork: true,
  })
  const net = (await invoke('plugin_authority_snapshot')).find(
    (s) => s.pluginId === 'org.example.s15-network',
  )
  await assert.rejects(
    command(net, { items: [{ id: 'private', title: 'Synthetic private title' }] }),
  )
  checks.privateSelectionCannotUsePublicNetwork = true
  const prefixPreview = await invoke('plugin_package_preview', {
    bytes: [...readFileSync(join(consumer, 's15-prefix.amplugin'))],
    legacy: false,
  })
  await invoke('plugin_package_install', {
    token: prefixPreview.token,
    capabilities: prefixPreview.permissions,
    transferData: false,
    userLinkedNetwork: true,
  })
  const prefix = (await invoke('plugin_authority_snapshot')).find(
    (s) => s.pluginId === 'org.example.s15-prefix',
  )
  await assert.rejects(
    command(
      prefix,
      { items: [{ id: 'private', title: 'Synthetic private title' }] },
      'music.search',
    ),
  )
  checks.commandNamesCannotDowngradePrivateSelection = true
  const cancellable = await install(join(consumer, 's15-cancel.amplugin'))
  await main.evaluate(
    `globalThis.s15Cancelled=null;__TAURI_INTERNALS__.invoke('plugin_command_run',${JSON.stringify({ installId: cancellable.installId, command: 'run', inputJson: '{}' })}).then(()=>s15Cancelled=false,()=>s15Cancelled=true);true`,
  )
  await delay(300)
  await invoke('plugin_command_cancel', { installId: cancellable.installId })
  for (let i = 0; i < 50; i++) {
    if (await main.evaluate('s15Cancelled===true')) break
    await delay(100)
  }
  assert.equal(await main.evaluate('s15Cancelled'), true)
  const afterCancel = (await invoke('plugin_authority_snapshot')).find(
    (s) => s.installId === cancellable.installId,
  )
  assert.equal(afterCancel.permissionEpoch, cancellable.permissionEpoch)
  assert.equal(afterCancel.enabled, true)
  checks.nativeCancellationClosesContextWithoutRevokingGrant = true

  console.log('S15 isolation: concurrent executors')
  const hold = await install(join(consumer, 's15-hold.amplugin'))
  const args = { installId: hold.installId, command: 'run', inputJson: '{}' }
  for (let i = 0; i < 50; i++) {
    const windows = await invoke('plugin:window|get_all_windows')
    if (!windows.some((label) => label.startsWith('plugin-executor-'))) break
    await delay(100)
  }
  await main.evaluate(
    `globalThis.s15Pending=[]; for(let n=0;n<2;n++){globalThis.__TAURI_INTERNALS__.invoke('plugin_command_run',${JSON.stringify(args)}).then(()=>s15Pending[n]='completed',()=>s15Pending[n]='rejected')};true`,
  )
  let observers = []
  for (let i = 0; i < 50; i++) {
    observers = readFileSync(join(evidence, 'stderr.log'), 'utf8')
      .split(/\r?\n/)
      .filter((line) => line.startsWith('S15_EXECUTOR '))
      .map((line) => JSON.parse(line.slice('S15_EXECUTOR '.length)))
      .filter((entry) => entry.installId === hold.installId)
    if (observers.length === 2) break
    await delay(100)
  }
  assert.deepEqual(observers.map((entry) => entry.label).toSorted(), [
    'plugin-executor-0',
    'plugin-executor-1',
  ])
  const a = await connectWebview(
    observers.find((entry) => entry.label === 'plugin-executor-0').port,
    { urlPattern: /am-plugin-0/ },
  )
  const b = await connectWebview(
    observers.find((entry) => entry.label === 'plugin-executor-1').port,
    { urlPattern: /am-plugin-1/ },
  )
  const peer = await connectWebview(24324, { urlPattern: /am-plugin-0/ })
  await assert.rejects(
    peer.evaluate(
      `__TAURI_INTERNALS__.invoke('plugin_executor_relay',{message:'{"type":"bootstrap"}'})`,
    ),
  )
  let requests = 0
  const server = createServer((request, response) => {
    requests++
    console.log('S15 unexpected direct request', request.url)
    response.end('synthetic')
  })
  await new Promise((accept) => server.listen(0, '127.0.0.1', accept))
  try {
    console.log('S15 isolation: live ACL')
    const manifests = JSON.parse(
      readFileSync(resolve(root, 'apps/tauri/src-tauri/gen/schemas/acl-manifests.json')),
    )
    const denied = [
      ...new Set(
        Object.entries(manifests).flatMap(([plugin, manifest]) =>
          Object.values(manifest.permissions).flatMap((permission) =>
            (permission.commands?.allow ?? []).map((cmd) =>
              plugin === '__app-acl__' ? cmd : 'plugin:' + plugin.replace('core:', '') + '|' + cmd,
            ),
          ),
        ),
      ),
    ].filter((cmd) => cmd !== 'plugin_executor_relay')
    for (const view of [a, b, peer]) {
      const results = await view.evaluate(
        `Promise.all(${JSON.stringify(denied)}.map(async command=>{try{await __TAURI_INTERNALS__.invoke(command,{});return command}catch{return null}}))`,
      )
      assert(
        results.every((value) => value === null),
        JSON.stringify(results.filter(Boolean)),
      )
    }
    checks.liveDeniedCommands = { commands: denied.length, subjects: 3, denials: denied.length * 3 }
    console.log('S15 isolation: storage')
    const mainSeed = await main.evaluate(`(${seedStorage})('s15-main')`)
    const aSeed = await a.evaluate(`(${seedStorage})('s15-a')`)
    const peerSeed = await peer.evaluate(`(${seedStorage})('s15-peer')`)
    for (const value of [mainSeed, aSeed, peerSeed]) {
      assert.equal(value.before.localStorage, null)
      assert.equal(value.before.indexedDb, null)
      assert.equal(value.before.cache, null)
    }
    assert.equal(aSeed.before.cookie, '')
    assert.equal(peerSeed.before.cookie, '')
    await a.evaluate(`s03Channel.postMessage('cross-profile-probe')`)
    await delay(200)
    const peerRead = await peer.evaluate(`(${readStorage})()`)
    assert(!JSON.stringify(peerRead).includes('cross-profile-probe'))
    checks.sameOriginProfilesStorageCookiesAndBroadcastIsolated = true
    console.log('S15 isolation: CSP and Worker')
    const url = 'http://127.0.0.1:' + server.address().port + '/probe'
    assert.equal(await a.evaluate(`fetch(${JSON.stringify(url)}).then(()=>false,()=>true)`), true)
    assert.equal(requests, 0, 'Document CSP must stop the request before transport')
    const before = await a.evaluate('location.href')
    // Exercise document navigation. DevTools Page.navigate is an observer privilege
    // and can issue a network load before the embedder's normal navigation callback.
    await a.evaluate(`location.href=${JSON.stringify(url)};true`)
    await delay(100)
    assert.equal(await a.evaluate('location.href'), before)
    assert.equal(requests, 0, 'Native navigation must stop the request before transport')
    await a.send('Target.setAutoAttach', {
      autoAttach: true,
      waitForDebuggerOnStart: false,
      flatten: true,
    })
    let worker
    for (let i = 0; i < 30; i++) {
      worker = a.events.find(
        (e) => e.method === 'Target.attachedToTarget' && e.params.targetInfo.type === 'worker',
      )
      if (worker) break
      await delay(100)
    }
    assert(worker, 'Real QuickJS Worker target is required')
    const workerResult = await a.send(
      'Runtime.evaluate',
      {
        expression: `fetch(${JSON.stringify(url)}).then(()=>false,()=>true)`,
        awaitPromise: true,
        returnByValue: true,
      },
      worker.params.sessionId,
    )
    assert.equal(workerResult.result.value, true)
    assert.equal(requests, 0)
    checks.documentWorkerCspAndNavigationBlocked = true
    console.log('S15 isolation: replay and revoke')
    await assert.rejects(
      a.evaluate(
        `__TAURI_INTERNALS__.invoke('plugin_executor_relay',{message:'{"type":"bootstrap"}'})`,
      ),
    )
    await invoke('plugin_authority_revoke', { installId: hold.installId })
    for (let i = 0; i < 50; i++) {
      if (await main.evaluate(`s15Pending.filter(value=>value==='rejected').length===2`)) break
      await delay(100)
    }
    assert.equal(await main.evaluate(`s15Pending.filter(value=>value==='rejected').length`), 2)
    checks.replayAndLiveRevocationTerminateExecutors = true
  } finally {
    a.close()
    b.close()
    peer.close()
    await new Promise((accept) => server.close(accept))
  }
}
