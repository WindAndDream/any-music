import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

export const tampermonkeyIds = [
  'dhdgffkkebhmkfjojejmpbldmpobfkfo', // Chrome Web Store, stable.
  'iikmkjmpaadaobahmlepeloendndfphd', // Microsoft Edge Add-ons, stable.
]

export const browserStores = {
  chrome: 'https://chromewebstore.google.com/detail/dhdgffkkebhmkfjojejmpbldmpobfkfo',
  edge: 'https://microsoftedge.microsoft.com/addons/detail/iikmkjmpaadaobahmlepeloendndfphd',
}

/** Use an installed, extension-capable browser, never an automation headless shell. */
export function findUserscriptBrowser(browser, env = process.env, platform = process.platform) {
  const candidates = {
    win32: {
      chrome: [
        join(env.PROGRAMFILES || 'C:/Program Files', 'Google/Chrome/Application/chrome.exe'),
        join(
          env['PROGRAMFILES(X86)'] || 'C:/Program Files (x86)',
          'Google/Chrome/Application/chrome.exe',
        ),
        join(
          env.LOCALAPPDATA || join(homedir(), 'AppData/Local'),
          'Google/Chrome/Application/chrome.exe',
        ),
      ],
      edge: [
        join(
          env['PROGRAMFILES(X86)'] || 'C:/Program Files (x86)',
          'Microsoft/Edge/Application/msedge.exe',
        ),
        join(env.PROGRAMFILES || 'C:/Program Files', 'Microsoft/Edge/Application/msedge.exe'),
      ],
    },
    darwin: {
      chrome: ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'],
      edge: ['/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'],
    },
    linux: {
      chrome: ['/usr/bin/google-chrome-stable', '/usr/bin/google-chrome'],
      edge: ['/usr/bin/microsoft-edge-stable', '/usr/bin/microsoft-edge'],
    },
  }[platform]
  for (const family of browser ? [browser] : ['chrome', 'edge']) {
    const executable = candidates?.[family]?.find((path) => existsSync(path))
    if (executable) return { family, executable }
  }
  throw new Error(
    '未找到正式版 Chrome/Edge。请先安装浏览器，再运行本命令；可用 --browser chrome 或 --browser edge 选择。',
  )
}

export function userscriptBrowserArgs(profile) {
  return [
    `--user-data-dir=${profile}`,
    '--profile-directory=Default',
    '--remote-debugging-address=127.0.0.1',
    '--remote-debugging-port=0',
    '--no-first-run',
    '--no-default-browser-check',
    'about:blank',
  ]
}

/** DevToolsActivePort belongs to this persistent profile; don't attach to an arbitrary port. */
export async function readBrowserEndpoint(profile) {
  let content
  try {
    content = await readFile(join(profile, 'DevToolsActivePort'), 'utf8')
  } catch (error) {
    if (error.code === 'ENOENT') return undefined
    throw error
  }
  const [portText, path] = content.trim().split(/\r?\n/)
  const port = Number(portText)
  if (
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535 ||
    !/^\/devtools\/browser\/[\w-]+$/.test(path)
  )
    return undefined
  const origin = `http://127.0.0.1:${port}`
  try {
    const response = await fetch(`${origin}/json/version`, { signal: AbortSignal.timeout(1000) })
    if (!response.ok) return undefined
    const version = await response.json()
    const endpoint = new URL(version.webSocketDebuggerUrl)
    if (
      endpoint.pathname !== path ||
      endpoint.port !== String(port) ||
      /Headless/i.test(version.Browser)
    )
      return undefined
    return { origin, webSocketUrl: `ws://127.0.0.1:${port}${path}`, version: version.Browser }
  } catch {
    return undefined
  }
}

export async function startUserscriptBrowser(browser, profile) {
  const existing = await readBrowserEndpoint(profile)
  if (existing) return { ...existing, reused: true }
  const child = spawn(browser.executable, userscriptBrowserArgs(profile), {
    detached: true,
    stdio: 'ignore',
  })
  let failure
  child.on('error', (error) => {
    failure = error
  })
  child.unref()
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    if (failure) throw failure
    // oxlint-disable-next-line no-await-in-loop -- Each probe must finish before the next startup poll.
    const endpoint = await readBrowserEndpoint(profile)
    if (endpoint) return { ...endpoint, reused: false }
    // oxlint-disable-next-line no-await-in-loop -- Bound startup polling instead of flooding the endpoint.
    await delay(250)
  }
  throw new Error(
    `浏览器未开放本地调试接口。请关闭使用此专用目录的窗口后重试：${profile}。同时检查企业浏览器策略是否禁止远程调试；不要删除配置或改用临时浏览器。`,
  )
}

/** Small bounded CDP client for setup only; never imported by the product runtime. */
export class BrowserConnection {
  constructor(socket) {
    this.socket = socket
    this.sequence = 0
    this.pending = new Map()
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data)
      const pending = this.pending.get(message.id)
      if (!pending) return
      this.pending.delete(message.id)
      clearTimeout(pending.timer)
      if (message.error) pending.reject(new Error(message.error.message))
      else pending.resolve(message.result)
    })
    socket.addEventListener('close', () => this.rejectPending())
    socket.addEventListener('error', () => this.rejectPending())
  }

  static async connect(url) {
    const socket = new WebSocket(url)
    const client = new BrowserConnection(socket)
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        socket.close()
        reject(new Error('浏览器调试连接超时'))
      }, 5000)
      socket.addEventListener(
        'open',
        () => {
          clearTimeout(timer)
          resolve()
        },
        { once: true },
      )
      socket.addEventListener(
        'error',
        () => {
          clearTimeout(timer)
          reject(new Error('浏览器调试连接失败'))
        },
        { once: true },
      )
    })
    return client
  }

  rejectPending() {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(new Error('浏览器连接已关闭'))
    }
    this.pending.clear()
  }

  send(method, params = {}, sessionId) {
    return new Promise((resolve, reject) => {
      const id = ++this.sequence
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`浏览器命令超时：${method}`))
      }, 5000)
      this.pending.set(id, { resolve, reject, timer })
      try {
        this.socket.send(
          JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }),
        )
      } catch (error) {
        clearTimeout(timer)
        this.pending.delete(id)
        reject(error)
      }
    })
  }

  async open(url) {
    const { targetInfos } = await this.send('Target.getTargets')
    const existing = targetInfos.find((target) => target.type === 'page' && target.url === url)
    const { targetId } = existing || (await this.send('Target.createTarget', { url }))
    await this.send('Target.activateTarget', { targetId })
    const { sessionId } = await this.send('Target.attachToTarget', { targetId, flatten: true })
    return { targetId, sessionId }
  }

  async evaluate(sessionId, expression) {
    const result = await this.send(
      'Runtime.evaluate',
      { expression, awaitPromise: true, returnByValue: true },
      sessionId,
    )
    if (result.exceptionDetails)
      throw new Error(
        result.exceptionDetails.exception?.description ||
          result.exceptionDetails.text ||
          '浏览器页面求值失败',
      )
    return result.result.value
  }

  close() {
    this.rejectPending()
    this.socket.close()
  }
}

/** Query the live extension manager, not an extension directory or a sleeping service worker. */
export const extensionInspectionExpression = `
(async () => {
  if (!globalThis.chrome?.developerPrivate) return null
  const extensions = await chrome.developerPrivate.getExtensionsInfo({ includeDisabled: true, includeTerminated: true })
  const profile = await chrome.developerPrivate.getProfileConfiguration()
  return {
    developerMode: profile.inDeveloperMode,
    extensions: extensions.filter(extension => ${JSON.stringify(tampermonkeyIds)}.includes(extension.id)).map(extension => ({
      id: extension.id, name: extension.name, version: extension.version, state: extension.state,
      userScriptsAccess: extension.userScriptsAccess,
    })),
  }
})()`

export function getTampermonkeyStatus(inspection) {
  if (!inspection || !Array.isArray(inspection.extensions))
    throw new Error(
      '无法读取浏览器扩展管理状态；不能将此浏览器标记为就绪。请更新正式版 Chrome/Edge。',
    )
  const installed = inspection.extensions.filter((extension) =>
    tampermonkeyIds.includes(extension.id),
  )
  const enabled = installed.filter((extension) => extension.state === 'ENABLED')
  if (!enabled.length)
    return { stage: installed.length ? 'disabled' : 'missing', extension: installed[0] }
  // New Chromium versions expose a per-extension switch; older versions use developer mode.
  const allowed = enabled.find((extension) => {
    const access = extension.userScriptsAccess
    return typeof access?.isActive === 'boolean'
      ? access.isActive
      : inspection.developerMode === true
  })
  return { stage: allowed ? 'ready' : 'permission', extension: allowed || enabled[0] }
}

/** The preview and production launcher alone cannot establish a real development GM connection. */
export function developmentConnectionExpression(hostUrl) {
  const entryUrl = new URL('/__vite-plugin-monkey.entry.js', hostUrl).href
  return `(() => {
    if (location.href !== ${JSON.stringify(hostUrl)}) return false
    const hasEntry = [...document.scripts].some(script => script.src === ${JSON.stringify(entryUrl)})
    const hasLauncher = !!document.querySelector('any-music-root')?.shadowRoot?.querySelector('button')
    const hasGm = Object.keys(document).filter(key => key.startsWith('__monkeyWindow-')).some(key => {
      const sandbox = document[key]
      return sandbox?.GM_info?.script?.name === 'server:Any Music'
        && sandbox.GM_info.scriptHandler === 'Tampermonkey'
        && typeof sandbox.GM_xmlhttpRequest === 'function'
        && typeof sandbox.GM_getValue === 'function'
    })
    return hasEntry && hasLauncher && hasGm
  })()`
}
