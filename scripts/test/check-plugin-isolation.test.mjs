import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import { validateIsolationAcceptance } from '../../apps/tauri/scripts/isolation-acceptance-report.mjs'
import { checkIsolationConfig, inspectIsolationConfig } from '../check-plugin-isolation.mjs'
import { createWorkspace } from './helpers/package-workspace.mjs'

test('built-in themes cannot acquire plugin authority through package imports', (context) => {
  const workspace = createWorkspace(context)
  workspace.theme('theme-paper')
  assert.deepEqual(workspace.checkThemes(), [])
  workspace.write(
    'packages/theme-paper/src/vue.ts',
    "import '@any-music/plugin-sdk/host'; import '@any-music/plugin-ui-vue/trusted'",
  )
  assert.ok(workspace.checkThemes().some((error) => error.includes('disallowed internal import')))
})

const read = (path) =>
  readFileSync(new URL(`../../apps/tauri/src-tauri/${path}`, import.meta.url), 'utf8')
const fixture = () => ({
  registry: read('src/ipc.rs'),
  composition: read('src/lib.rs'),
  build: read('build.rs'),
  permission: read('permissions/product.toml'),
  capability: JSON.parse(read('capabilities/main.json')),
  config: JSON.parse(read('tauri.conf.json')),
})

test('the actual registry has complete AppManifest coverage and exact main authority', () => {
  const commands = inspectIsolationConfig()
  assert.equal(commands.length, 77)
  for (const command of [
    'runtime_capabilities',
    'discard_account_draft',
    'source_account_platforms',
    'source_account_auth',
    'resource_cache_snapshot',
    'resource_cache_configure',
    'resource_cache_clear',
    'resource_cache_directory',
    'register_artwork',
    'verify_download',
    'open_download_schedule',
    'acquire_download_slot',
    'release_download_slot',
    'close_download_schedule',
    'get_download_directory',
    'choose_download_directory',
    'reset_download_directory',
    'open_qr_login',
    'plugin_package_current_preview',
    'plugin_package_pick_preview',
    'plugin_package_url_preview',
    'plugin_dev_begin',
    'plugin_dev_end',
    'plugin_package_install',
    'plugin_package_rollback',
    'plugin_command_run',
    'plugin_command_cancel',
    'plugin_diagnostics',
    'plugin_result_save',
    'plugin_diagnostics_export',
    'plugin_executor_relay',
  ])
    assert(commands.includes(command))
})

test('new commands, broad capabilities, remote access and relay grants cannot silently bypass review', () => {
  const mutations = [
    (value) => {
      value.registry = value.registry.replace(
        'crate::isolation::plugin_probe_relay',
        'crate::isolation::plugin_probe_relay, crate::new_command',
      )
    },
    (value) => {
      value.permission = value.permission.replace('"http_request",', '')
    },
    (value) => {
      value.permission = value.permission.replace(
        '"http_request",',
        '"http_request", "open_qr_login",',
      )
    },
    (value) => {
      value.capability.windows = ['main']
    },
    (value) => {
      value.capability.webviews = ['*']
    },
    (value) => {
      value.capability.permissions.push('allow-plugin-probe-relay')
    },
    (value) => {
      value.capability.remote = { urls: ['https://example.com'] }
    },
    (value) => {
      value.config.app.security.capabilities.push('another-capability')
    },
    (value) => {
      value.build = value.build.replace(
        'AppManifest::new().commands(commands)',
        'AppManifest::new()',
      )
    },
    (value) => {
      value.composition += 'tauri::generate_handler![bypass]'
    },
  ]
  for (const mutate of mutations) {
    const value = fixture()
    mutate(value)
    assert.throws(() => checkIsolationConfig(value))
  }
})

test('actual acceptance records fail closed on missing evidence, leaked authority or inconsistent targets', () => {
  // Synthetic metadata exercises the report validator only, never runtime acceptance.
  const commands = ['http_request']
  const report = {
    scope: 'S03',
    status: 'passed',
    codePluginsEnabled: false,
    gracefulExit: true,
    applicationSha256: 'a'.repeat(64),
    profileCleanup: [{ removed: true }],
    commands,
    checks: Object.fromEntries(
      [
        'actualCommandDenial',
        'mainProductCommands',
        'workerWasmStartup',
        'directNetworkDenial',
        'documentCsp',
        'workerCsp',
        'originStorageIsolation',
        'cookieCacheIsolation',
        'broadcastSharedWorkerOpenerIsolation',
        'resourceNavigationDownloadDeviceDenial',
        'nativeSessionDisposal',
      ].map((key) => [key, true]),
    ),
    observations: Object.fromEntries(
      ['main', 's03-a', 's03-b', 's03-peer'].map((label) => [
        label,
        {
          url:
            label === 's03-peer'
              ? 'https://am-s03-a.localhost/index.html'
              : `https://am-${label}.localhost/index.html`,
          browser: { product: 'Edg/155.0.4283.60' },
          commands: [{ command: 'http_request', error: 'http_request not allowed' }],
          workerCsp: { fetchRejected: true, socketRejected: true },
        },
      ]),
    ),
    nativeEvents: ['main', 's03-a', 's03-b', 's03-peer'].map((directory) => ({
      event: 'profile',
      directory,
    })),
    canaryRequests: ['/control'],
    workerResponseHeaders: { 'Content-Security-Policy': "connect-src 'none'" },
  }
  report.observations['s03-b'].lifecycle = {
    unload: { oldWorkerTargetsGone: true, oldDocument: { error: 'unknown probe caller' } },
  }
  report.observations['s03-b'].budgets = { acceptedMessages: 32, acceptedSessionBytes: 65536 }
  assert.equal(validateIsolationAcceptance(report, commands).target, 'Windows')
  const mutations = [
    (value) => {
      value.status = 'partial'
    },
    (value) => {
      delete value.checks.workerCsp
    },
    (value) => {
      value.codePluginsEnabled = true
    },
    (value) => {
      value.gracefulExit = false
    },
    (value) => {
      value.profileCleanup[0].removed = false
    },
    (value) => {
      value.observations['s03-b'].commands[0].error = 'invalid arguments'
    },
    (value) => {
      value.observations['s03-peer'].browser.product = 'Edg/154.0.0.0'
    },
    (value) => {
      value.nativeEvents[3].directory = value.nativeEvents[0].directory
    },
    (value) => {
      value.canaryRequests.push('/blocked-worker')
    },
  ]
  for (const mutate of mutations) {
    const value = structuredClone(report)
    mutate(value)
    assert.throws(() => validateIsolationAcceptance(value, commands))
  }
})
