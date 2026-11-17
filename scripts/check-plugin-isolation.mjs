import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { checkThemePackageBoundaries } from './check-package-boundaries.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const read = (path) => readFileSync(resolve(root, path), 'utf8')

/** Static complement to the native tests of Tauri's resolved runtime authority. */
/** Official account pages are remote; they may reach exactly one report command. */
const ACCOUNT_PAGE_ORIGINS = [
  'https://*.douyin.com/*',
  'https://*.bilibili.com/*',
  'https://music.163.com/*',
]
export function checkIsolationConfig({
  registry,
  composition,
  build,
  permission,
  capability,
  accountPages,
  config,
}) {
  assert.equal((registry.match(/tauri::generate_handler!/g) ?? []).length, 1)
  const list = registry.split('tauri::generate_handler![')[1]?.split(']')[0]
  assert(list, 'Missing single application command registry')
  const commands = list
    .split(',')
    .map((path) => path.trim())
    .filter(Boolean)
    .map((path) => {
      assert(/^(?:[a-z_]+::)+[a-z_]+$/.test(path), `Unsupported registry entry: ${path}`)
      return path.split('::').at(-1)
    })
  assert.equal(new Set(commands).size, commands.length, 'Duplicate application command')
  assert(commands.includes('plugin_probe_relay'))
  assert(!composition.includes('generate_handler!'), 'Bypass of the audited registry')
  assert(composition.includes('.invoke_handler(ipc::handler())'))
  assert(build.includes('include_str!("src/ipc.rs")'))
  assert(build.includes('AppManifest::new().commands(commands)'))
  // This permission file deliberately uses only explicit TOML string arrays.
  const permissions = Object.fromEntries(
    [
      ...permission.matchAll(
        /identifier\s*=\s*"([^"]+)"[\s\S]*?commands\.allow\s*=\s*(\[[^\]]*\])/g,
      ),
    ].map(([, identifier, array]) => [identifier, JSON.parse(array.replace(/,(\s*\])/g, '$1'))]),
  )
  assert.deepEqual(
    Object.keys(permissions).toSorted(),
    ['allow-account-page-report', 'allow-product-commands'],
    'Only reviewed application permission sets exist',
  )
  assert.deepEqual(
    permissions['allow-product-commands'].toSorted(),
    commands
      .filter(
        (name) =>
          ![
            'plugin_probe_relay',
            'plugin_executor_relay',
            'open_qr_login',
            'account_page_report',
          ].includes(name),
      )
      .toSorted(),
    'Desktop product permissions must cover desktop business commands without Android-only handoff',
  )
  assert.deepEqual(
    permissions['allow-account-page-report'],
    ['account_page_report'],
    'Account pages may only report page observations',
  )
  assert.deepEqual(
    config.app.security.capabilities,
    ['main', 'account-pages'],
    'Only the explicit product and account-page capabilities are enabled',
  )
  assert.equal(capability.identifier, 'main')
  assert.deepEqual(capability.webviews, ['main'])
  assert(!capability.windows && !capability.remote, 'No inherited window or remote authority')
  assert.deepEqual(capability.permissions, ['core:default', 'allow-product-commands'])
  assert.equal(accountPages.identifier, 'account-pages')
  assert.deepEqual(accountPages.webviews, ['account-page-*'])
  assert(!accountPages.windows, 'Account pages inherit no window authority')
  assert.equal(accountPages.local, false, 'Account-page reports never accept local callers')
  assert.deepEqual(accountPages.remote?.urls, ACCOUNT_PAGE_ORIGINS)
  assert.deepEqual(accountPages.permissions, ['allow-account-page-report'])
  return commands
}

export function inspectIsolationConfig() {
  assert.deepEqual(
    checkThemePackageBoundaries(root),
    [],
    'Built-in theme packages cannot import plugin/runtime authority',
  )
  return checkIsolationConfig({
    registry: read('apps/tauri/src-tauri/src/ipc.rs'),
    composition: read('apps/tauri/src-tauri/src/lib.rs'),
    build: read('apps/tauri/src-tauri/build.rs'),
    permission: read('apps/tauri/src-tauri/permissions/product.toml'),
    capability: JSON.parse(read('apps/tauri/src-tauri/capabilities/main.json')),
    accountPages: JSON.parse(read('apps/tauri/src-tauri/capabilities/account-pages.json')),
    config: JSON.parse(read('apps/tauri/src-tauri/tauri.conf.json')),
  })
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const commands = inspectIsolationConfig()
  console.log(
    JSON.stringify({
      appCommands: commands.length,
      productCommands: commands.length - 3,
      relays: ['plugin_probe_relay', 'plugin_executor_relay'],
      offlineOnly: true,
      nativeTargetAdmission: 'separate exact target record',
    }),
  )
}
