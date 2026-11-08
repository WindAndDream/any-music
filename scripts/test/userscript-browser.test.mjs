import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'

import {
  BrowserConnection,
  developmentConnectionExpression,
  findUserscriptBrowser,
  getTampermonkeyStatus,
  readBrowserEndpoint,
  startUserscriptBrowser,
  tampermonkeyIds,
  userscriptBrowserArgs,
} from '../lib/userscript-browser.mjs'

async function temporaryDirectory(context) {
  const directory = await mkdtemp(join(tmpdir(), 'any-music userscript '))
  context.after(() => rm(directory, { recursive: true, force: true }))
  return directory
}

const extension = { id: tampermonkeyIds[0], version: '5.5.1', state: 'ENABLED' }

test('missing, disabled and terminated extensions are never reported ready', () => {
  assert.equal(getTampermonkeyStatus({ extensions: [] }).stage, 'missing')
  for (const state of ['DISABLED', 'TERMINATED', 'BLOCKLISTED']) {
    assert.equal(
      getTampermonkeyStatus({ developerMode: true, extensions: [{ ...extension, state }] }).stage,
      'disabled',
    )
  }
  assert.equal(
    getTampermonkeyStatus({ extensions: [{ ...extension, id: 'an-unrelated-extension' }] }).stage,
    'missing',
  )
  assert.throws(() => getTampermonkeyStatus(null), /无法读取/)
})

test('user script access is checked independently from installation and developer mode', () => {
  assert.equal(getTampermonkeyStatus({ extensions: [extension] }).stage, 'permission')
  assert.equal(
    getTampermonkeyStatus({ developerMode: true, extensions: [extension] }).stage,
    'ready',
  )
  assert.equal(
    getTampermonkeyStatus({
      developerMode: true,
      extensions: [{ ...extension, userScriptsAccess: { isActive: false } }],
    }).stage,
    'permission',
  )
  assert.equal(
    getTampermonkeyStatus({
      developerMode: false,
      extensions: [{ ...extension, userScriptsAccess: { isActive: true } }],
    }).stage,
    'ready',
  )
  assert.equal(
    getTampermonkeyStatus({
      extensions: [{ ...extension, id: tampermonkeyIds[1], userScriptsAccess: { isActive: true } }],
    }).stage,
    'ready',
  )
})

test('a disabled store variant does not hide another enabled stable variant', () => {
  const status = getTampermonkeyStatus({
    developerMode: true,
    extensions: [
      { ...extension, state: 'DISABLED' },
      { ...extension, id: tampermonkeyIds[1] },
    ],
  })
  assert.equal(status.stage, 'ready')
  assert.equal(status.extension.id, tampermonkeyIds[1])
  const permitted = getTampermonkeyStatus({
    extensions: [
      { ...extension, userScriptsAccess: { isActive: false } },
      { ...extension, id: tampermonkeyIds[1], userScriptsAccess: { isActive: true } },
    ],
  })
  assert.equal(permitted.stage, 'ready')
  assert.equal(permitted.extension.id, tampermonkeyIds[1])
})

test('browser selection uses installed system browsers and supports Windows paths with spaces', async (context) => {
  const directory = await temporaryDirectory(context)
  const edge = join(directory, 'Microsoft/Edge/Application/msedge.exe')
  await mkdir(join(directory, 'Microsoft/Edge/Application'), { recursive: true })
  await writeFile(edge, '')
  const env = { PROGRAMFILES: directory, 'PROGRAMFILES(X86)': directory, LOCALAPPDATA: directory }
  assert.deepEqual(findUserscriptBrowser(undefined, env, 'win32'), {
    family: 'edge',
    executable: edge,
  })
  assert.throws(() => findUserscriptBrowser('chrome', env, 'win32'), /未找到正式版/)
  assert.throws(() => findUserscriptBrowser(undefined, {}, 'unsupported'), /未找到正式版/)
})

test('launch flags retain the same profile without disabling extension installation', () => {
  const profile = join(tmpdir(), 'any-music test profile')
  const args = userscriptBrowserArgs(profile)
  assert(args.includes(`--user-data-dir=${profile}`))
  assert(args.includes('--remote-debugging-port=0'))
  assert(args.includes('--remote-debugging-address=127.0.0.1'))
  assert(
    !args.some((arg) =>
      /headless|incognito|disable-extensions|disable-component-extensions|guest|remote-allow-origins|no-sandbox/.test(
        arg,
      ),
    ),
  )
})

test('malformed or missing debugging-port files do not attach to arbitrary browsers', async (context) => {
  const directory = await temporaryDirectory(context)
  assert.equal(await readBrowserEndpoint(directory), undefined)
  for (const content of [
    'NaN\n/devtools/browser/a',
    '0\n/devtools/browser/a',
    '65536\n/devtools/browser/a',
    '9222\nhttps://example.com',
    '9222\n/devtools/page/a',
  ]) {
    // oxlint-disable-next-line no-await-in-loop -- Exercise successive states of the same port file.
    await writeFile(join(directory, 'DevToolsActivePort'), content)
    // oxlint-disable-next-line no-await-in-loop -- Read each fixture before replacing it.
    assert.equal(await readBrowserEndpoint(directory), undefined)
  }
})

test('reuse requires a live endpoint matching this persistent profile, including browser target identity', async (context) => {
  const directory = await temporaryDirectory(context)
  let browser = 'Chrome/156.0'
  let path = '/devtools/browser/this-profile'
  const server = createServer((_request, response) => {
    response.setHeader('Content-Type', 'application/json')
    response.end(
      JSON.stringify({
        Browser: browser,
        webSocketDebuggerUrl: `ws://localhost:${server.address().port}${path}`,
      }),
    )
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  context.after(() => new Promise((resolve) => server.close(resolve)))
  const port = server.address().port
  await writeFile(join(directory, 'DevToolsActivePort'), `${port}\r\n${path}\r\n`)
  const endpoint = await startUserscriptBrowser({ executable: 'must-not-be-launched' }, directory)
  assert.equal(endpoint.reused, true)
  assert.equal(endpoint.webSocketUrl, `ws://127.0.0.1:${port}${path}`)
  path = '/devtools/browser/another-profile'
  assert.equal(await readBrowserEndpoint(directory), undefined)
  path = '/devtools/browser/this-profile'
  browser = 'HeadlessChrome/156.0'
  assert.equal(await readBrowserEndpoint(directory), undefined)
  await writeFile(join(directory, 'DevToolsActivePort'), '1\n/devtools/browser/stale')
  assert.equal(await readBrowserEndpoint(directory), undefined)
})

class TestSocket extends EventTarget {
  requests = []
  send(message) {
    this.requests.push(JSON.parse(message))
  }
  respond(message) {
    this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(message) }))
  }
  close() {
    this.dispatchEvent(new Event('close'))
  }
}

test('browser commands correlate responses, surface protocol failures and reject on disconnect', async () => {
  const socket = new TestSocket()
  const client = new BrowserConnection(socket)
  const first = client.send('first', {}, 'page-session')
  const second = client.send('second')
  assert.equal(socket.requests[0].sessionId, 'page-session')
  socket.respond({ id: 2, result: { value: 'second' } })
  socket.respond({ id: 1, result: { value: 'first' } })
  assert.deepEqual(await first, { value: 'first' })
  assert.deepEqual(await second, { value: 'second' })
  const failed = client.send('unsupported')
  socket.respond({ id: 3, error: { message: 'unsupported method' } })
  await assert.rejects(failed, /unsupported method/)
  const disconnected = client.send('pending')
  client.close()
  await assert.rejects(disconnected, /连接已关闭/)
  assert.equal(client.pending.size, 0)
})

test('a launcher from preview or production is insufficient to verify a development GM connection', () => {
  const hostUrl = 'http://127.0.0.1:18765/gm-dev.html'
  const sandbox = {
    GM_info: { script: { name: 'server:Any Music' }, scriptHandler: 'Tampermonkey' },
    GM_xmlhttpRequest() {},
    GM_getValue() {},
  }
  const document = {
    scripts: [{ src: 'http://127.0.0.1:18765/__vite-plugin-monkey.entry.js' }],
    querySelector: () => ({ shadowRoot: { querySelector: () => ({}) } }),
    '__monkeyWindow-current': sandbox,
  }
  const check = () =>
    runInNewContext(developmentConnectionExpression(hostUrl), {
      document,
      location: { href: hostUrl },
    })
  assert.equal(check(), true)
  sandbox.GM_info.script.name = 'Any Music'
  assert.equal(check(), false)
  sandbox.GM_info.script.name = 'server:Any Music'
  document.scripts = []
  assert.equal(check(), false)
  document.scripts = [{ src: 'http://127.0.0.1:18765/__vite-plugin-monkey.entry.js' }]
  delete sandbox.GM_xmlhttpRequest
  assert.equal(check(), false)
})

test('CLI help runs without launching a browser or a development server', () => {
  const script = fileURLToPath(new URL('../setup-userscript-browser.mjs', import.meta.url))
  const result = execFileSync(process.execPath, [script, '--help'], {
    encoding: 'utf8',
    timeout: 5000,
  })
  assert.match(result, /pnpm setup:userscript/)
  assert.match(result, /--browser-only/)
})
