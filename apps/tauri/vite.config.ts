import { fileURLToPath } from 'node:url'

import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'

import { retryableThemeImports } from '../../scripts/vite/retryable-theme-imports.ts'
import {
  themeComponentId,
  themeStyleResources,
  themeBundleAudit,
} from '../../scripts/vite/theme-style-resources.ts'

const workspaceRoot = fileURLToPath(new URL('../..', import.meta.url))

export default defineConfig({
  plugins: [
    vue({
      features: {
        componentIdGenerator: (filename) => themeComponentId(workspaceRoot, filename, 'tauri'),
      },
    }),
    themeStyleResources(workspaceRoot, 'tauri'),
    themeBundleAudit(workspaceRoot, 'tauri'),
    retryableThemeImports(workspaceRoot),
  ],
  envDir: '../..',
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  // Keep this fixed port aligned with Tauri's devUrl and the native origin check.
  server: { host: '127.0.0.1', port: 21420, strictPort: true },
  clearScreen: false,
  build: { target: 'es2022' },
})
