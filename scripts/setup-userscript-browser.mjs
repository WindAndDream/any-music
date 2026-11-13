import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'

import {
  BrowserConnection,
  browserStores,
  developmentConnectionExpression,
  extensionInspectionExpression,
  findUserscriptBrowser,
  getTampermonkeyStatus,
  startUserscriptBrowser,
} from './lib/userscript-browser.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const stateDirectory = join(root, '.local/userscript-browser')
const origin = 'http://127.0.0.1:18765'
const hostUrl = `${origin}/gm-dev.html`
const installUrl = `${origin}/__vite-plugin-monkey.install.user.js`
const log = (message) => process.stdout.write(`[userscript] ${message}\n`)

const { values } = parseArgs({
  options: {
    browser: { type: 'string' },
    'browser-only': { type: 'boolean', default: false },
    timeout: { type: 'string', default: '600' },
    help: { type: 'boolean', short: 'h' },
  },
})

async function startDevelopmentServer() {
  const healthPath = '/__any-music/userscript-environment'
  try {
    const response = await fetch(`${origin}${healthPath}`, { signal: AbortSignal.timeout(1000) })
    const health = response.ok && (await response.json())
    if (health?.root === root && health.mode === 'dev') {
      log(`复用本仓库开发服务：${origin}`)
      return undefined
    }
  } catch {
    /* No matching server; strictPort below refuses unrelated listeners. */
  }
  const require = createRequire(join(root, 'apps/userscript/package.json'))
  // Vite's config bundler resolves external packages from cwd; Vite belongs to this app.
  process.chdir(join(root, 'apps/userscript'))
  const { createServer } = await import(pathToFileURL(require.resolve('vite')).href)
  const server = await createServer({
    root: join(root, 'apps/userscript'),
    configFile: join(root, 'apps/userscript/vite.config.ts'),
    mode: 'dev',
    server: { host: '127.0.0.1', port: 18765, strictPort: true, open: false },
    plugins: [
      {
        name: 'any-music-userscript-environment',
        configureServer(vite) {
          vite.middlewares.use(healthPath, (_request, response) => {
            response.setHeader('Content-Type', 'application/json')
            response.end(JSON.stringify({ root, mode: 'dev' }))
          })
        },
      },
    ],
  })
  try {
    await server.listen()
  } catch (error) {
    await server.close()
    throw error
  }
  return server
}

async function waitFor(check, timeoutMs, description) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    // oxlint-disable-next-line no-await-in-loop -- Setup stages poll user actions serially.
    const result = await check()
    if (result) return result
    // oxlint-disable-next-line no-await-in-loop -- Never overlap setup checks or browser side effects.
    await delay(1000)
  }
  const error = new Error(`${description}等待超时。配置会保留，完成浏览器中的操作后重新运行即可。`)
  error.code = 'SETUP_TIMEOUT'
  throw error
}

async function prepareTampermonkey(client, browser, timeoutMs) {
  const scheme = browser.family === 'edge' ? 'edge' : 'chrome'
  const manager = await client.open(`${scheme}://extensions/`)
  let previousStage
  return waitFor(
    async () => {
      const inspection = await client.evaluate(manager.sessionId, extensionInspectionExpression)
      if (!inspection) return false // The internal page may still be loading.
      const status = getTampermonkeyStatus(inspection)
      if (status.stage === 'ready') {
        log(`篡改猴 ${status.extension.version} 已启用，用户脚本执行权限已开启。`)
        return status.extension
      }
      if (status.stage !== previousStage) {
        previousStage = status.stage
        if (status.stage === 'missing') {
          log(
            '未安装篡改猴，正在打开官方商店。请点击“添加/获取”，并在浏览器确认框中确认安装；本命令会自动继续。',
          )
          await client.open(browserStores[browser.family])
        } else {
          await client.open(`${scheme}://extensions/?id=${status.extension.id}`)
          log(
            status.stage === 'disabled'
              ? '篡改猴已安装但未启用，请在扩展详情中启用；无需重新安装。'
              : '请在篡改猴扩展详情开启“允许用户脚本”；旧版浏览器可开启扩展页面的“开发者模式”。',
          )
        }
      }
      return false
    },
    timeoutMs,
    '篡改猴安装/权限设置',
  )
}

async function prepareConnectionScript(client, timeoutMs) {
  const host = await client.open(hostUrl)
  const hasLauncher = () =>
    client.evaluate(host.sessionId, developmentConnectionExpression(hostUrl)).catch((error) => {
      if (/Execution context was destroyed|Cannot find context/.test(error.message)) return false
      throw error
    })
  // A retained tab may show a network error from when Vite was stopped. Retry it before installing.
  if (!(await hasLauncher())) await client.send('Page.reload', {}, host.sessionId)
  // Let an already installed connection script inject before offering its installer.
  try {
    await waitFor(hasLauncher, 10_000, '开发连接')
  } catch (error) {
    if (error.code !== 'SETUP_TIMEOUT') throw error
    log(
      '尚未检测到开发脚本入口，正在打开连接脚本安装页。请安装/启用 server:Any Music，确认篡改猴允许访问本地站点，并停用同一配置中的正式 Any Music 脚本。',
    )
    await client.open(installUrl)
    let lastReloadAt = 0
    await waitFor(
      async () => {
        if (await hasLauncher()) return true
        // Give a cold Vite module graph time to finish instead of restarting it every poll.
        if (Date.now() - lastReloadAt >= 15_000) {
          await client.send('Page.reload', {}, host.sessionId)
          lastReloadAt = Date.now()
        }
        return false
      },
      timeoutMs,
      '开发连接脚本安装/注入',
    )
  }
  await client.send('Target.activateTarget', { targetId: host.targetId })
  log(`已确认 Tampermonkey 的 server:Any Music、真实 GM API 与开发入口：${hostUrl}`)
  log('这是安装环境/开发脚本注入检查；具体 GM 请求和最终生产产物仍需各自验收。')
}

async function main() {
  if (values.help) {
    log('用法：pnpm setup:userscript [--browser chrome|edge] [--browser-only] [--timeout 秒]')
    log(
      '默认启动/复用本地 Vite、持久浏览器、检查篡改猴及开发连接。--browser-only 只准备浏览器和篡改猴。',
    )
    return
  }
  if (values.browser && !['chrome', 'edge'].includes(values.browser))
    throw new Error('--browser 只能是 chrome 或 edge')
  const timeoutMs = Number(values.timeout) * 1000
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0)
    throw new Error('--timeout 必须为大于 0 的秒数')
  let saved
  try {
    saved = JSON.parse(await readFile(join(stateDirectory, 'browser.json'), 'utf8'))
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  const browser = findUserscriptBrowser(values.browser || saved?.family)
  const profile = join(stateDirectory, browser.family)
  await mkdir(profile, { recursive: true })
  await writeFile(
    join(stateDirectory, 'browser.json'),
    `${JSON.stringify({ family: browser.family }, null, 2)}\n`,
  )
  log(`浏览器：${browser.executable}`)
  log(`专用持久配置：${profile}（请保留此目录，扩展/脚本/登录态存放于此）`)
  let server
  let client
  const shutdown = async () => {
    client?.close()
    await server?.close()
  }
  const onSignal = () => {
    void shutdown().finally(() => process.exit(130))
  }
  process.once('SIGINT', onSignal)
  process.once('SIGTERM', onSignal)
  try {
    if (!values['browser-only']) server = await startDevelopmentServer()
    const endpoint = await startUserscriptBrowser(browser, profile)
    log(`${endpoint.reused ? '复用' : '已启动'} ${endpoint.version}；调试地址：${endpoint.origin}`)
    await writeFile(
      join(stateDirectory, 'endpoint.json'),
      `${JSON.stringify({ browser: browser.family, profile, ...endpoint }, null, 2)}\n`,
    )
    client = await BrowserConnection.connect(endpoint.webSocketUrl)
    await prepareTampermonkey(client, browser, timeoutMs)
    if (!values['browser-only']) await prepareConnectionScript(client, timeoutMs)
    client.close()
    client = undefined
    if (server) log('环境就绪，开发服务保持运行。Ctrl+C 停止本次开发服务；浏览器和已安装配置保留。')
    else log('环境就绪，浏览器和已安装配置保留。')
  } catch (error) {
    await shutdown()
    throw error
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`[userscript] ${error.message}\n`)
    process.exitCode = 1
  })
}
