import { resolve } from 'node:path'
import { parseArgs } from 'node:util'

export { createVirtualListTestData } from './virtual-list-test-data.mjs'

export function parseVirtualListTestOptions(args) {
  const { values } = parseArgs({
    args,
    options: {
      count: { type: 'string', default: '1000' },
      theme: { type: 'string', default: 'classic' },
      baseline: { type: 'boolean', default: false },
      'dry-run': { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
  })
  const count = Number(values.count)
  if (!['0', '1', '80', '1000', '10000'].includes(values.count))
    throw new Error('--count must be 0, 1, 80, 1000 or 10000')
  if (!['classic', 'studio'].includes(values.theme))
    throw new Error('--theme must be classic or studio')
  return { ...values, count }
}

export function virtualListTestConfig(root, base, options) {
  const directory = resolve(root, '.local/virtual-list-test', `n${options.count}`)
  return {
    identifier: `com.anymusic.virtuallisttest.n${options.count}`,
    build: { beforeDevCommand: null },
    app: {
      windows: [
        {
          ...base.app.windows.find(({ label }) => label === 'main'),
          label: 'main',
          title: `Any Music · ${options.baseline ? 'Baseline' : 'C00–C03 Virtual'} · ${options.count}`,
          dataDirectory: resolve(directory, 'webview'),
        },
      ],
    },
  }
}

/** This plugin is supplied only by the test launcher, never by either product config. */
export function virtualListTestPlugin(root, options, runId) {
  const virtualId = 'virtual:any-music-virtual-list-test'
  const mainPath = resolve(root, 'apps/tauri/src/main.ts').replaceAll('\\', '/')
  const studioPath = resolve(root, 'packages/theme-studio/src/StudioRoot.vue').replaceAll('\\', '/')
  const workbenchPath = resolve(
    root,
    'packages/music-workbench/src/components/music-sources/MusicSourceWorkbench.vue',
  ).replaceAll('\\', '/')
  const fs = (path) => `/@fs/${resolve(root, path).replaceAll('\\', '/')}`
  return {
    name: 'any-music-virtual-list-test',
    apply: 'serve',
    enforce: 'pre',
    resolveId(id) {
      return id === virtualId ? `\0${virtualId}` : undefined
    },
    load(id) {
      if (id !== `\0${virtualId}`) return undefined
      return `
import { invoke } from ${JSON.stringify(fs('apps/tauri/node_modules/@tauri-apps/api/core.js'))}
import { createProductGenerationStorage } from ${JSON.stringify(fs('packages/music-workbench/src/storage/product-storage.ts'))}
import { createVirtualListTestData } from ${JSON.stringify(fs('scripts/lib/virtual-list-test-data.mjs'))}
import { classicVirtualFavoritesCanaryKey, classicVirtualQueueCanaryKey, classicVirtualPlaylistCanaryKey } from ${JSON.stringify(fs('packages/theme-default/src/composables/classic-virtual-favorites-canary.ts'))}
const options = ${JSON.stringify({ count: options.count, theme: options.theme, baseline: options.baseline })}
const runId = ${JSON.stringify(runId)}
export async function prepare() {
  // Require the launcher's distinct native identity before any fixture write.
  const metadata = await invoke('plugin:app|identifier')
  if (metadata !== ${JSON.stringify(`com.anymusic.virtuallisttest.n${options.count}`)}) throw Error('Refusing to seed a non-test native identity')
  if (sessionStorage.getItem('am-virtual-list-test-run') === runId) return
  const old = await invoke('load_product_data')
  const values = structuredClone(old?.values ?? {})
  const raw = {
    read: (key, fallback) => values[key] ?? fallback,
    write: (key, value) => { values[key] = structuredClone(value) },
    remove: key => { delete values[key] },
    withExclusiveWrite: operation => operation(),
  }
  const store = createProductGenerationStorage(raw, { runtime: 'tauri' })
  store.replace(createVirtualListTestData(store.snapshot(), options), store.revision())
  const mirror = { schemaVersion: 2, revision: (old?.revision ?? 0) + 1, values }
  localStorage.setItem('any-music:tauri:product:v2', JSON.stringify(mirror))
  await invoke('save_product_data', { value: mirror })
  sessionStorage.setItem('am-virtual-list-test-run', runId)
  console.info('[virtual-list-test]', options)
}
export const admission = {
  install(app) {
    for (const key of [classicVirtualFavoritesCanaryKey, classicVirtualQueueCanaryKey, classicVirtualPlaylistCanaryKey]) app.provide(key, !options.baseline)
  },
}
`
    },
    transform(code, id) {
      if (id.replaceAll('\\', '/') === studioPath) {
        const marker = '<script setup lang="ts">'
        if (!code.includes(marker))
          throw new Error('Studio bootstrap changed; update the test admission')
        // Install inside the lazy theme root, preserving optional-theme startup isolation.
        return {
          code: code.replace(
            marker,
            `${marker}\nimport { provide as provideVirtualListTest } from 'vue'\nimport { studioVirtualFavoritesCanaryKey } from './composables/studio-virtual-favorites-canary'\nprovideVirtualListTest(studioVirtualFavoritesCanaryKey, ${!options.baseline})`,
          ),
          map: null,
        }
      }
      if (id.replaceAll('\\', '/') === workbenchPath) {
        const marker = 'const { player } = controller'
        if (!code.includes(marker))
          throw new Error('Workbench bootstrap changed; update the test navigation')
        return {
          code: code.replace(marker, `controller.selectTab('favorites')\n${marker}`),
          map: null,
        }
      }
      if (id.replaceAll('\\', '/').split('?')[0] !== mainPath) return undefined
      if (!code.includes('await configureTauriWorkbench()') || !code.includes(".mount('#app')"))
        throw new Error('Tauri bootstrap changed; update the virtual-list test injection')
      return {
        code:
          `import { prepare as prepareVirtualListTest, admission as virtualListTestAdmission } from '${virtualId}'\n` +
          code
            .replace(
              'await configureTauriWorkbench()',
              'await prepareVirtualListTest()\n  await configureTauriWorkbench()',
            )
            .replace(".mount('#app')", ".use(virtualListTestAdmission).mount('#app')"),
        map: null,
      }
    },
  }
}
