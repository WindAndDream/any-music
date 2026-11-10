import { fileURLToPath } from 'node:url'

import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vitest/config'

const vuePlugin = vue()
const vueTransform = vuePlugin.transform
const vueLoad = vuePlugin.load

// Node 渲染宿主需要客户端事件处理器；编译 render，不启动产品或浏览器。
// 同一配置也允许 server-renderer 覆盖共享组件的静态输出。
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
  resolve: { alias: { '#workbench': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    // Heavy compiled Vue integration suites become slower and flaky when their workers
    // compete for CPU/memory. Keep the default full-suite run deterministic.
    maxWorkers: 1,
    fileParallelism: false,
  },
})
