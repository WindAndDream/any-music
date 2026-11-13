import { fileURLToPath } from 'node:url'

import vue from '@vitejs/plugin-vue'
import { defineConfig, loadEnv } from 'vite'
import monkey from 'vite-plugin-monkey'

import {
  themeComponentId,
  themeStyleResources,
  themeBundleAudit,
} from '../../scripts/vite/theme-style-resources.ts'
import { userscriptBundleBoundary } from './scripts/userscript-bundle-boundary.ts'

const workspaceRoot = fileURLToPath(new URL('../..', import.meta.url))
const sourceRoot = fileURLToPath(new URL('./src', import.meta.url))
const appEnvironments = ['dev', 'staging', 'prod'] as const

/** 构建前校验模式文件，防止脚本参数和注入到客户端的环境标识不一致。 */
function validateEnvironment(mode: string): void {
  if (!appEnvironments.some((environment) => environment === mode)) {
    throw new Error(`不支持环境模式 "${mode}"，请使用 dev、staging 或 prod。`)
  }

  const env = loadEnv(mode, workspaceRoot, 'VITE_')
  if (env.VITE_APP_ENV !== mode) {
    throw new Error(`.env.${mode} 中的 VITE_APP_ENV 必须为 "${mode}"。`)
  }
  if (env.VITE_APP_DEBUG !== 'true' && env.VITE_APP_DEBUG !== 'false') {
    throw new Error(`.env.${mode} 中的 VITE_APP_DEBUG 必须为 "true" 或 "false"。`)
  }
}

// Userscript 的构建配置只属于当前应用，不应被共享包导入。
export default defineConfig(({ mode }) => {
  validateEnvironment(mode)

  return {
    // 两个应用共用仓库根目录的 .env.[mode]，避免环境定义发生漂移。
    envDir: workspaceRoot,
    // 正式应用内部统一使用稳定别名，迁移功能时不把目录层级编码进 import。
    resolve: {
      alias: {
        '@': sourceRoot,
      },
    },
    // vite-plugin-monkey 的客户端入口包含随元数据变化的沙箱键，不能让依赖预构建跨重启复用旧值。
    optimizeDeps: {
      exclude: ['vite-plugin-monkey/dist/client'],
    },
    plugins: [
      userscriptBundleBoundary(),
      vue({
        features: {
          componentIdGenerator: (filename) =>
            themeComponentId(workspaceRoot, filename, 'userscript'),
        },
      }),
      themeStyleResources(workspaceRoot, 'userscript'),
      themeBundleAudit(workspaceRoot, 'userscript'),
      monkey({
        // vite-plugin-monkey 从该入口收集脚本代码和元数据。
        entry: 'src/main.ts',
        userscript: {
          name: 'Any Music',
          namespace: 'https://github.com/any-music',
          description: '跨平台聚合、整理与播放音乐内容的正式 Any Music 用户脚本',
          // 正式入口需要在任意 HTTP(S) 页面可用；平台 API 统一由 GM 适配器跨域访问。
          match: ['*://*/*'],
          // 悬浮应用只属于顶层文档，禁止在广告、播放器等 iframe 中重复挂载。
          noframes: true,
          // 权限必须与 src/platform 中实际使用的 GM 能力保持同步。
          grant: [
            'GM_getValue',
            'GM_setValue',
            'GM_deleteValue',
            'GM.getValue',
            'GM.setValue',
            'GM.deleteValue',
            'GM.listValues',
            'GM.getTab',
            'GM.saveTab',
            'GM.getTabs',
            'GM_addValueChangeListener',
            'GM_removeValueChangeListener',
            'GM_openInTab',
            'GM_cookie',
            'GM_xmlhttpRequest',
            'unsafeWindow',
          ],
          // 页面签名和受保护列表捕获必须早于抖音应用自己的监听器安装。
          'run-at': 'document-start',
          // S10 仅装配内置来源，不再为外置清单保留全域连接权限。
          connect: [
            'hdslb.com',
            'byteimg.com',
            'douyinpic.com',
            'pstatp.com',
            '126.net',
            'music.163.com',
            'music.126.net',
            'api.bilibili.com',
            'bilivideo.cn',
            'bilivideo.com',
            'www.douyin.com',
            'www-hj.douyin.com',
            'www.iesdouyin.com',
            // Official work descriptors may use this redirecting media entry before the CDN.
            'aweme.snssdk.com',
            'douyinvod.com',
          ],
        },
        // 动态模块仍内联进单个安装产物，只延迟执行而不引入运行时 CDN 依赖。
        build: {
          fileName: 'any-music.user.js',
          systemjs: 'inline',
          // SFC CSS 默认会写入宿主页 head，无法穿透 Shadow DOM；改为排队并注入当前产品根。
          cssSideEffects: `(css)=>{const key='__ANY_MUSIC_SHADOW_STYLE_STATE_V1__';const state=globalThis[key]??=(globalThis[key]={cssTexts:[]});state.cssTexts.push(css);if(state.root){const style=document.createElement('style');style.dataset.amGeneratedStyle='';style.textContent=css;state.root.append(style)}}`,
        },
      }),
    ],
  }
})
