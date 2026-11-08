import { fileURLToPath } from 'node:url'

import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vitest/config'

const sourceRoot = fileURLToPath(new URL('./src', import.meta.url))

/** 正式 Userscript 单元测试不加载脚本元数据，避免 test 模式触发构建环境校验。 */
export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': sourceRoot,
    },
  },
  test: {
    environment: 'node',
    // 包级 test 目录镜像 src 职责层级，平台 DOM 测试按文件提供最小浏览器替身。
    include: ['test/**/*.test.ts'],
  },
})
