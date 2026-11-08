import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { virtualListTestPlugin } from '../lib/virtual-list-test.mjs'

const root = fileURLToPath(new URL('../../', import.meta.url))
const appRoot = resolve(root, 'apps/tauri')
const require = createRequire(resolve(appRoot, 'package.json'))

test('real Vite module graph connects launcher admission to every Classic consumer gate', async () => {
  const { createServer } = await import(pathToFileURL(require.resolve('vite')).href)
  const server = await createServer({
    root: appRoot,
    configFile: resolve(appRoot, 'vite.config.ts'),
    // This test neither listens nor launches a product. Keep its optimizer separate from
    // an already running desktop test service and resolve the real plugin/module graph.
    cacheDir: resolve(root, 'node_modules/.vite/virtual-list-test-graph'),
    server: { middlewareMode: true, hmr: false, watch: null },
    optimizeDeps: { noDiscovery: true, include: [] },
    ssr: { external: ['vue', '@tanstack/vue-virtual'] },
    plugins: [
      virtualListTestPlugin(root, { count: 80, theme: 'classic', baseline: false }, 'graph'),
    ],
  })
  try {
    const main = await server.transformRequest('/src/main.ts')
    assert.match(main.code, /\.use\(virtualListTestAdmission\)\.mount\(["']#app["']\)/)
    const studio = await server.transformRequest(
      '/@fs/' + resolve(root, 'packages/theme-studio/src/StudioRoot.vue').replaceAll('\\', '/'),
    )
    assert.match(studio.code, /provideVirtualListTest\(studioVirtualFavoritesCanaryKey, true\)/)
    const { admission } = await server.ssrLoadModule('virtual:any-music-virtual-list-test')
    const { useClassicCollectionPresentation } = await server.ssrLoadModule(
      resolve(
        root,
        'packages/theme-default/src/composables/use-classic-collection-presentation.ts',
      ),
    )
    const { createRenderer, shallowRef } = require('vue')
    const { createCatalogTrackFilterState } = await server.ssrLoadModule(
      resolve(root, 'packages/ui/src/catalog.ts'),
    )
    const renderer = createRenderer({
      createComment: () => ({}),
      insert() {},
      remove() {},
      parentNode: () => null,
      nextSibling: () => null,
    })
    for (const scope of ['favorites:tracks', 'queue:tracks', 'playlist:fixture:tracks']) {
      let presentation
      const app = renderer.createApp({
        setup() {
          presentation = useClassicCollectionPresentation(
            {
              scope,
              title: scope,
              state: {
                tracks: [],
                platformNames: new Map(),
                filters: createCatalogTrackFilterState(),
                selectedTrackIds: [],
                displayMode: 'standard',
                mobileColumns: 1,
              },
              collection: { state: { arrangementMode: 'flat' }, actions: {} },
              actions: {},
              availability: { status: 'available' },
            },
            shallowRef(null),
          )
          return () => null
        },
      })
      app.use(admission).mount({})
      try {
        assert.ok(presentation.virtualGrid.value, `${scope} lost the launcher's actual Symbol`)
      } finally {
        app.unmount()
      }
    }
  } finally {
    await server.close()
  }
})
