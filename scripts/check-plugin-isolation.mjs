import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { checkThemePackageBoundaries } from './check-package-boundaries.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const read = (path) => readFileSync(resolve(root, path), 'utf8')

/** Static complement to the native tests of Tauri's resolved runtime authority. */
export function checkIsolationConfig({
  registry,
  composition,
  build,
  permission,
  capability,
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
  // This permission file deliberately uses only an explicit TOML string array.
  const array = permission.match(/commands\.allow\s*=\s*(\[[^\]]*\])/)?.[1] ?? '[]'
  const allowed = JSON.parse(array.replace(/,(\s*\])/g, '$1'))
  assert.deepEqual(
    allowed.toSorted(),
    commands
      .filter(
        (name) => !['plugin_probe_relay', 'plugin_executor_relay', 'open_qr_login'].includes(name),
      )
      .toSorted(),
    'Desktop product permissions must cover desktop business commands without Android-only handoff',
  )
  assert.deepEqual(
    config.app.security.capabilities,
    ['main'],
    'Only the explicit product capability is enabled',
  )
  assert.equal(capability.identifier, 'main')
  assert.deepEqual(capability.webviews, ['main'])
  assert(!capability.windows && !capability.remote, 'No inherited window or remote authority')
  assert.deepEqual(capability.permissions, ['core:default', 'allow-product-commands'])
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
