import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  createVirtualListTestData,
  parseVirtualListTestOptions,
  virtualListTestConfig,
  virtualListTestPlugin,
} from '../lib/virtual-list-test.mjs'

const root = fileURLToPath(new URL('../../', import.meta.url))
const base = JSON.parse(readFileSync(resolve(root, 'apps/tauri/src-tauri/tauri.conf.json'), 'utf8'))
const data = {
  schemaVersion: 1,
  core: {
    library: {
      schemaVersion: 6,
      profile: { id: 'test', displayName: 'Test' },
      settings: { historyLimit: 500 },
      tracks: [],
      playlists: [],
      history: [],
      customTracks: [],
    },
  },
  host: {},
  namespaces: [],
}

test('test CLI accepts only bounded fixture sizes and known themes', () => {
  assert.equal(parseVirtualListTestOptions([]).count, 1000)
  assert.equal(parseVirtualListTestOptions(['--theme', 'studio', '--baseline']).baseline, true)
  for (const count of ['-1', '10001', '1e3', '80.0'])
    assert.throws(() => parseVirtualListTestOptions(['--count', count]), /--count/)
  assert.throws(() => parseVirtualListTestOptions(['--theme', 'unknown']), /--theme/)
})

test('fixtures populate all three collections without bypassing queue limits or adding media', () => {
  const before = structuredClone(data)
  for (const count of [0, 1, 80, 1000, 10000]) {
    const fixture = createVirtualListTestData(data, { count, theme: 'studio' })
    assert.equal(fixture.core.library.tracks.length, count)
    assert.equal(fixture.core.favorites.trackIds.length, count)
    assert.equal(fixture.core.library.playlists[0].trackIds.length, count)
    assert.equal(fixture.core.queue.trackIds.length, Math.min(count, 5000))
    assert.equal(new Set(fixture.core.favorites.trackIds).size, count)
    assert.equal(fixture.host.theme.themeId, 'studio')
    assert.doesNotMatch(JSON.stringify(fixture), /https?:|blob:|data:|mediaUrl|filePath/)
    // Leave room for the normal runtime's two committed generations in WebView storage.
    if (count === 10000) assert.ok(JSON.stringify(fixture).length * 2 < 5 * 1024 * 1024)
  }
  assert.deepEqual(data, before)
})

test('native test config keeps the main capability label but isolates identity and WebView storage', () => {
  const before = structuredClone(base)
  const config = virtualListTestConfig(root, base, { count: 80, baseline: false })
  assert.notEqual(config.identifier, base.identifier)
  assert.equal(config.app.windows[0].label, 'main')
  assert.equal(
    config.app.windows[0].dataDirectory,
    resolve(root, '.local/virtual-list-test/n80/webview'),
  )
  assert.equal(config.app.security, undefined)
  assert.equal(config.build.beforeDevCommand, null)
  assert.deepEqual(base, before)
})

test('serve-only injection seeds before runtime startup and provides gates before mount', () => {
  const plugin = virtualListTestPlugin(
    root,
    { count: 80, theme: 'classic', baseline: false },
    'run',
  )
  assert.equal(plugin.apply, 'serve')
  const main = readFileSync(resolve(root, 'apps/tauri/src/main.ts'), 'utf8')
  const injected = plugin.transform(main, resolve(root, 'apps/tauri/src/main.ts')).code
  assert.ok(
    injected.indexOf('await prepareVirtualListTest()') <
      injected.indexOf('await configureTauriWorkbench()'),
  )
  assert.match(injected, /\.use\(virtualListTestAdmission\)\.mount\('#app'\)/)
  assert.equal(plugin.transform(main, resolve(root, 'apps/userscript/src/main.ts')), undefined)
  const workbenchPath = resolve(
    root,
    'packages/music-workbench/src/components/music-sources/MusicSourceWorkbench.vue',
  )
  const workbench = readFileSync(workbenchPath, 'utf8')
  assert.match(
    plugin.transform(workbench, workbenchPath).code,
    /controller.selectTab\('favorites'\)/,
  )
  assert.equal(plugin.transform('compiled script', workbenchPath + '?vue&type=script'), undefined)
  const studioPath = resolve(root, 'packages/theme-studio/src/StudioRoot.vue')
  const studio = readFileSync(studioPath, 'utf8')
  assert.match(
    plugin.transform(studio, studioPath).code,
    /provideVirtualListTest\(studioVirtualFavoritesCanaryKey, true\)/,
  )
  assert.doesNotMatch(
    plugin.load(plugin.resolveId('virtual:any-music-virtual-list-test')),
    /theme-studio/,
  )
})

function browserModule(baseline, nativeIdentity) {
  const plugin = virtualListTestPlugin(root, { count: 80, theme: 'classic', baseline }, 'run')
  const code = plugin
    .load(plugin.resolveId('virtual:any-music-virtual-list-test'))
    .replace(/^import .*\n/gm, '')
    .replaceAll('export ', '')
  const calls = []
  const session = new Map()
  const store = {
    snapshot: () => structuredClone(data),
    revision: () => 'revision',
    replace: (fixture) => calls.push(['fixture', fixture]),
  }
  const invoke = async (command, args) => {
    calls.push([command, args])
    if (command === 'plugin:app|identifier') return nativeIdentity
    if (command === 'load_product_data') return null
  }
  const names = [
    'invoke',
    'createProductGenerationStorage',
    'createVirtualListTestData',
    'classicVirtualFavoritesCanaryKey',
    'classicVirtualQueueCanaryKey',
    'classicVirtualPlaylistCanaryKey',
    'sessionStorage',
    'localStorage',
    'console',
  ]
  const keys = Array.from({ length: 3 }, () => Symbol())
  const module = Function(...names, code + '\nreturn { prepare, admission }')(
    invoke,
    () => store,
    createVirtualListTestData,
    ...keys,
    { getItem: (key) => session.get(key), setItem: (key, value) => session.set(key, value) },
    { setItem: (key, value) => calls.push(['local', key, value]) },
    { info() {} },
  )
  return { module, calls, keys }
}

test('fixture bootstrap refuses production identity before touching either mirror', async () => {
  const { module, calls } = browserModule(false, base.identifier)
  await assert.rejects(module.prepare(), /non-test native identity/)
  assert.deepEqual(
    calls.map(([name]) => name),
    ['plugin:app|identifier'],
  )
})

test('fixture bootstrap runs once per launch and candidate/baseline gates stay independent', async () => {
  await Promise.all(
    [false, true].map(async (baseline) => {
      const { module, calls, keys } = browserModule(baseline, 'com.anymusic.virtuallisttest.n80')
      await module.prepare()
      await module.prepare()
      assert.equal(calls.filter(([name]) => name === 'save_product_data').length, 1)
      assert.equal(calls.filter(([name]) => name === 'fixture').length, 1)
      const provided = new Map()
      module.admission.install({ provide: (key, value) => provided.set(key, value) })
      assert.deepEqual([...provided.keys()], keys)
      assert.deepEqual([...provided.values()], [!baseline, !baseline, !baseline])
      const plugin = virtualListTestPlugin(root, { count: 80, theme: 'studio', baseline }, 'run')
      const studioPath = resolve(root, 'packages/theme-studio/src/StudioRoot.vue')
      assert.ok(
        plugin
          .transform(readFileSync(studioPath, 'utf8'), studioPath)
          .code.includes(`provideVirtualListTest(studioVirtualFavoritesCanaryKey, ${!baseline})`),
      )
    }),
  )
})
