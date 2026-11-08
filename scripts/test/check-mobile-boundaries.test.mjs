import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

import { checkMobileBoundaries, inspectMobileBoundaries } from '../check-mobile-boundaries.mjs'
import { createWorkspace } from './helpers/package-workspace.mjs'

test('mobile theme packages cannot depend on desktop/native APIs, including through a second script block', (context) => {
  const workspace = createWorkspace(context)
  workspace.theme('theme-paper')
  assert.deepEqual(workspace.checkThemes(), [])
  workspace.write(
    'packages/theme-paper/src/ThemeRoot.vue',
    '<script>export default {}</script><script setup lang="ts">import "@tauri-apps/api/core"; import "../../../apps/tauri/src/private"</script>',
  )
  const errors = workspace.checkThemes()
  assert.ok(errors.some((error) => error.includes('inject native runtime capabilities')))
  assert.ok(errors.some((error) => error.includes('relative import escapes package')))
})

const read = (file) =>
  readFileSync(new URL(`../../apps/tauri/src-tauri/${file}`, import.meta.url), 'utf8')
const fixture = () => ({
  desktop: JSON.parse(read('capabilities/main.json')),
  mobile: JSON.parse(read('capabilities/main-mobile.json')),
  androidCapability: JSON.parse(read('capabilities/main-android.json')),
  android: JSON.parse(read('tauri.android.conf.json')),
  ios: JSON.parse(read('tauri.ios.conf.json')),
  permission: read('permissions/mobile.toml'),
  androidGradle: read('gen/android/app/build.gradle.kts'),
  androidManifest: read('gen/android/app/src/main/AndroidManifest.xml'),
  androidNetworkSecurity: read('gen/android/app/src/main/res/xml/network_security_config.xml'),
})
test(
  'mobile capabilities separate Android built-in transport from iOS local data',
  inspectMobileBoundaries,
)
test('desktop or remote privilege cannot enter mobile through configuration', () => {
  for (const mutate of [
    (f) => f.mobile.permissions.push('allow-product-commands'),
    (f) => f.mobile.permissions.push('core:app:allow-exit'),
    (f) => f.mobile.webviews.push('*'),
    (f) => f.androidCapability.permissions.push('allow-product-commands'),
    (f) => f.androidCapability.webviews.push('*'),
    (f) => {
      f.mobile.remote = { urls: ['https://example.com/*'] }
    },
    (f) => f.desktop.platforms.push('android'),
    (f) => f.android.app.security.capabilities.push('main'),
    (f) => f.ios.app.security.capabilities.push('executor-0'),
    (f) => {
      f.android.bundle.android.minSdkVersion = 24
    },
    (f) => {
      f.androidGradle = f.androidGradle.replace('minSdk = 26', 'minSdk = 24')
    },
    (f) => {
      f.androidManifest = f.androidManifest.replace(
        'android:networkSecurityConfig=',
        'android:unusedConfig=',
      )
    },
    (f) => {
      f.androidNetworkSecurity = f.androidNetworkSecurity.replace(
        'cleartextTrafficPermitted="false"',
        'cleartextTrafficPermitted="true"',
      )
    },
    (f) => {
      f.androidNetworkSecurity = f.androidNetworkSecurity.replace('127.0.0.1', 'example.com')
    },
    (f) => {
      f.androidNetworkSecurity = f.androidNetworkSecurity.replace(
        'includeSubdomains="false"',
        'includeSubdomains="true"',
      )
    },
    (f) => {
      f.permission = f.permission.replace('"cancel_request",', '"cancel_request", "http_request",')
    },
    (f) => {
      f.permission = f.permission.replace(
        '"open_qr_login",',
        '"open_qr_login", "begin_browser_login",',
      )
    },
  ]) {
    const value = fixture()
    mutate(value)
    assert.throws(() => checkMobileBoundaries(value))
  }
})
