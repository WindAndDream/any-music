import { fileURLToPath } from 'node:url'

import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vitest/config'

const vuePlugin = vue()
const vueTransform = vuePlugin.transform
const vueLoad = vuePlugin.load

// Compile client event handlers for the Node component host; SSR assertions still work.
vuePlugin.transform = {
  ...(typeof vueTransform === 'object' ? vueTransform : {}),
  handler(code, id, options) {
    const handler = typeof vueTransform === 'function' ? vueTransform : vueTransform?.handler
    return handler?.call(this, code, id, {
      ...options,
      moduleType: options?.moduleType ?? 'js',
      ssr: false,
    })
  },
}
vuePlugin.load = {
  ...(typeof vueLoad === 'object' ? vueLoad : {}),
  handler(id, options) {
    const handler = typeof vueLoad === 'function' ? vueLoad : vueLoad?.handler
    return handler?.call(this, id, { ...options, ssr: false })
  },
}
export default defineConfig({
  plugins: [vuePlugin],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: { environment: 'node', include: ['test/**/*.test.ts'] },
})
