import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import {
  parseVirtualListTestOptions,
  virtualListTestConfig,
  virtualListTestPlugin,
} from './lib/virtual-list-test.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const options = parseVirtualListTestOptions(process.argv.slice(2))
if (options.help) {
  process.stdout
    .write(`Usage: pnpm test:virtual-list [--count 0|1|80|1000|10000] [--theme classic|studio] [--baseline] [--dry-run]
Starts an isolated Tauri desktop with synthetic Favorites, Listen Later and a test playlist.
Default: 1,000 tracks, Classic, C00–C03 candidates enabled. Listen Later retains its 5,000-track product limit.
--baseline uses the same fixture with all virtual candidates disabled.
Fixtures have no playable media or artwork. This is layout/interaction testing, not playback/download acceptance.
Close the app or press Ctrl+C to stop. --dry-run prints the plan without starting a server or app.
`)
} else {
  const base = JSON.parse(
    await readFile(join(root, 'apps/tauri/src-tauri/tauri.conf.json'), 'utf8'),
  )
  const config = virtualListTestConfig(root, base, options)
  const configPath = join(
    root,
    '.local/virtual-list-test',
    `n${options.count}`,
    'tauri.test.conf.json',
  )
  if (options['dry-run']) {
    process.stdout.write(JSON.stringify({ options, configPath, config }, null, 2) + '\n')
  } else {
    await launch(config, configPath)
  }
}

async function launch(config, configPath) {
  const date = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' })
  const logDirectory = join(root, 'logs', `${date}-virtual-list-test-launcher`)
  await mkdir(logDirectory, { recursive: true })
  await mkdir(dirname(configPath), { recursive: true })
  await writeFile(configPath, JSON.stringify(config, null, 2) + '\n')
  const appRoot = join(root, 'apps/tauri')
  const require = createRequire(join(appRoot, 'package.json'))
  const { createServer } = await import(pathToFileURL(require.resolve('vite')).href)
  const runId = randomUUID()
  const logPath = join(
    logDirectory,
    `${options.theme}-${options.count}-${options.baseline ? 'baseline' : 'candidate'}-${runId}.log`,
  )
  const log = createWriteStream(logPath)
  // Vite's config bundler resolves app-owned dependencies from cwd.
  process.chdir(appRoot)
  const server = await createServer({
    root: appRoot,
    configFile: join(appRoot, 'vite.config.ts'),
    mode: 'dev',
    plugins: [virtualListTestPlugin(root, options, runId)],
    server: { host: '127.0.0.1', port: 21420, strictPort: true, open: false },
  })
  let child
  let childRunning = false
  let stopping
  const stop = () => {
    if (!childRunning) return Promise.resolve()
    if (stopping) return stopping
    stopping = new Promise((accept) => {
      if (process.platform === 'win32') {
        // Terminate only this launcher's CLI/Cargo/app tree, including during compilation.
        const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
          windowsHide: true,
          stdio: 'ignore',
        })
        killer.once('error', () => {
          child.kill()
          accept()
        })
        killer.once('exit', () => accept())
      } else {
        process.kill(-child.pid, 'SIGTERM')
        accept()
      }
    })
    return stopping
  }
  const onSignal = () => {
    void stop()
  }
  process.on('SIGINT', onSignal)
  process.on('SIGTERM', onSignal)
  try {
    await server.listen()
    process.stdout.write(`[virtual-list-test] ${config.app.windows[0].title}\n`)
    process.stdout.write(
      `[virtual-list-test] Fixture: Favorites ${options.count}, queue ${Math.min(options.count, 5000)}, playlist ${options.count}\n`,
    )
    process.stdout.write(
      `[virtual-list-test] Opens 我的喜欢. Also test 待听 and 我的歌单 → 虚拟列表测试. Switch Classic/Studio in settings.\n`,
    )
    process.stdout.write(
      `[virtual-list-test] Isolated native identity: ${config.identifier}\n[virtual-list-test] Log: ${logPath}\n`,
    )
    const cli = join(dirname(require.resolve('@tauri-apps/cli/package.json')), 'tauri.js')
    child = spawn(
      process.execPath,
      [cli, 'dev', '--no-watch', '--config', configPath, '--', '--locked', '--no-default-features'],
      {
        cwd: appRoot,
        env: { ...process.env, CARGO_TARGET_DIR: join(root, 'target/virtual-list-test') },
        stdio: ['inherit', 'pipe', 'pipe'],
        windowsHide: true,
        detached: process.platform !== 'win32',
      },
    )
    childRunning = true
    child.stdout.on('data', (chunk) => {
      process.stdout.write(chunk)
      log.write(chunk)
    })
    child.stderr.on('data', (chunk) => {
      process.stderr.write(chunk)
      log.write(chunk)
    })
    process.exitCode = await new Promise((accept, reject) => {
      child.once('error', (error) => {
        childRunning = false
        reject(error)
      })
      child.once('exit', (code) => {
        childRunning = false
        accept(code ?? 1)
      })
    })
  } finally {
    process.off('SIGINT', onSignal)
    process.off('SIGTERM', onSignal)
    await stop()
    await server.close()
    log.end()
  }
}
