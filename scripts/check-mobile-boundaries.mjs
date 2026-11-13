import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { checkThemePackageBoundaries } from './check-package-boundaries.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const read = (path) => readFileSync(resolve(root, path), 'utf8')

/** Offline ACL verification; it cannot admit a device, engine or distribution channel. */
export function checkMobileBoundaries({
  desktop,
  mobile,
  androidCapability,
  android,
  ios,
  permission,
  androidGradle,
  androidManifest,
  androidNetworkSecurity,
}) {
  assert.deepEqual(desktop.platforms, ['windows', 'macOS', 'linux'])
  assert.deepEqual(mobile.platforms, ['iOS'])
  assert.deepEqual(mobile.webviews, ['main'])
  assert(!mobile.windows && !mobile.remote)
  assert.deepEqual(mobile.permissions, ['core:default', 'allow-mobile-commands'])
  assert.deepEqual(androidCapability.platforms, ['android'])
  assert.deepEqual(androidCapability.webviews, ['main'])
  assert(!androidCapability.windows && !androidCapability.remote)
  assert.deepEqual(androidCapability.permissions, [
    'core:default',
    'core:app:allow-exit',
    'allow-mobile-commands',
    'allow-android-account-commands',
    'allow-android-delivery-commands',
  ])
  for (const config of [android, ios]) {
    assert.equal(config.identifier, 'com.anymusic.app')
  }
  assert.deepEqual(android.app.security.capabilities, ['main-android'])
  assert.equal(android.bundle.android.minSdkVersion, 26)
  assert.match(androidGradle, /\bminSdk\s*=\s*26\b/, 'Gradle must enforce the same Android minimum')
  assert.deepEqual(ios.app.security.capabilities, ['main-mobile'])
  assert.match(androidManifest, /android:networkSecurityConfig="@xml\/network_security_config"/)
  assert.match(androidNetworkSecurity, /<base-config\s+cleartextTrafficPermitted="false"\s*\/>/)
  assert.deepEqual(
    [...androidNetworkSecurity.matchAll(/<domain\s+includeSubdomains="false">([^<]+)<\/domain>/g)]
      .map((match) => match[1])
      .toSorted(),
    ['127.0.0.1', 'localhost'],
    'Only loopback media can use cleartext in Android WebView',
  )
  assert.equal((androidNetworkSecurity.match(/<domain\s/g) ?? []).length, 2)
  assert.equal((androidNetworkSecurity.match(/<domain-config\b/g) ?? []).length, 1)
  assert.match(androidNetworkSecurity, /<domain-config\s+cleartextTrafficPermitted="true">/)
  const commands = JSON.parse(
    permission.match(/commands\.allow\s*=\s*(\[[^\]]*\])/)?.[1].replace(/,(\s*\])/g, '$1') ?? '[]',
  )
  assert.deepEqual(
    commands.toSorted(),
    [
      'runtime_capabilities',
      'account_snapshot',
      'load_product_data',
      'save_product_data',
      'login_capabilities',
      'cancel_request',
      'resource_cache_snapshot',
      'resource_cache_configure',
      'resource_cache_clear',
    ].toSorted(),
    'Unaccepted mobile targets may only access local data and capability discovery',
  )
  const delivery = permission
    .split('[[permission]]')
    .find((block) => block.includes('identifier = "allow-android-delivery-commands"'))
  assert(delivery)
  const deliveryCommands = JSON.parse(
    delivery.match(/commands\.allow\s*=\s*(\[[^\]]*\])/)?.[1].replace(/,(\s*\])/g, '$1') ?? '[]',
  )
  assert.deepEqual(
    deliveryCommands.toSorted(),
    [
      'save_download',
      'verify_download',
      'open_download_schedule',
      'acquire_download_slot',
      'release_download_slot',
      'close_download_schedule',
      'get_download_directory',
      'choose_download_directory',
      'reset_download_directory',
      'plugin_authority_snapshot',
      'plugin_authority_revoke',
      'plugin_package_preview',
      'plugin_package_pick_preview',
      'plugin_package_url_preview',
      'plugin_package_current_preview',
      'plugin_package_discard_preview',
      'plugin_diagnostics',
      'plugin_diagnostics_export',
    ].toSorted(),
    'Android document adapters cannot gain desktop transport or code authority',
  )
  const accounts = permission
    .split('[[permission]]')
    .find((block) => block.includes('identifier = "allow-android-account-commands"'))
  assert(accounts)
  const accountCommands = JSON.parse(
    accounts.match(/commands\.allow\s*=\s*(\[[^\]]*\])/)?.[1].replace(/,(\s*\])/g, '$1') ?? '[]',
  )
  assert.deepEqual(
    accountCommands.toSorted(),
    [
      'create_account',
      'update_account',
      'remove_account',
      'account_usage',
      'acquire_account_usage',
      'release_account_usage',
      'cancel_platform_requests',
      'http_request',
      'begin_qr_login',
      'poll_qr_login',
      'cancel_qr_login',
      'open_qr_login',
      'save_proxy',
      'remove_proxy',
      'register_media',
      'register_artwork',
      'release_media',
    ].toSorted(),
    'Android built-in accounts and media cannot gain desktop browsers or plugin execution',
  )
}

export function inspectMobileBoundaries() {
  assert.deepEqual(
    checkThemePackageBoundaries(root),
    [],
    'Mobile themes consume controlled inputs without native/desktop authority',
  )
  checkMobileBoundaries({
    desktop: JSON.parse(read('apps/tauri/src-tauri/capabilities/main.json')),
    mobile: JSON.parse(read('apps/tauri/src-tauri/capabilities/main-mobile.json')),
    androidCapability: JSON.parse(read('apps/tauri/src-tauri/capabilities/main-android.json')),
    android: JSON.parse(read('apps/tauri/src-tauri/tauri.android.conf.json')),
    ios: JSON.parse(read('apps/tauri/src-tauri/tauri.ios.conf.json')),
    permission: read('apps/tauri/src-tauri/permissions/mobile.toml'),
    androidGradle: read('apps/tauri/src-tauri/gen/android/app/build.gradle.kts'),
    androidManifest: read('apps/tauri/src-tauri/gen/android/app/src/main/AndroidManifest.xml'),
    androidNetworkSecurity: read(
      'apps/tauri/src-tauri/gen/android/app/src/main/res/xml/network_security_config.xml',
    ),
  })
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  inspectMobileBoundaries()
  console.log(
    'Mobile ACLs checked offline; Android/iOS device and channel acceptance remains pending.',
  )
}
