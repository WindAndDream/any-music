import { createPinia, disposePinia } from 'pinia'

import App from './App.vue'
import { protectedStyles } from './features/plugins/built-in-themes'
import { configureUserscriptWorkbench } from './platform/configure-userscript-workbench'
import { mountUserscriptApp } from './platform/dom/mount-userscript-app'
import type { UserscriptAppMountTarget } from './platform/dom/mount-userscript-launcher'

import appStyles from './styles/app.scss?inline'
import hostStyles from './styles/host.scss?inline'

/**
 * 首次展开后才组合 Vue、Pinia、共享样式和完整功能树。
 * document-start 所需桥接由 main.ts 独立持有，不能被这一惰性边界延后。
 */
export async function mountExpandedUserscriptApp(target: UserscriptAppMountTarget) {
  const releaseStorage = await configureUserscriptWorkbench()
  const pinia = createPinia()
  try {
    if (window.location.hostname === 'www.douyin.com') {
      // 普通抖音页面只在用户展开后捕获受保护响应；后台回退任务已由 main.ts 提前处理。
      const { installDouyinPageCapture } =
        await import('./platform/music-plugins/douyin/douyin-page-capture-runtime')
      installDouyinPageCapture()
    }
    const mounted = mountUserscriptApp(
      {
        rootComponent: App,
        appPlugins: [pinia],
        styles: [hostStyles, protectedStyles, appStyles],
      },
      target,
    )
    if (!mounted) {
      disposePinia(pinia)
      await releaseStorage()
      return undefined
    }

    let isDisposed = false
    return {
      ...mounted,
      unmount: () => {
        if (isDisposed) return
        isDisposed = true
        mounted.unmount()
        // Store watcher 和持久化任务必须与当前 Vue 作用域一起结束，重开时才能保持单实例。
        disposePinia(pinia)
        void releaseStorage().catch(() => {
          window.dispatchEvent(new CustomEvent('any-music:storage-error'))
        })
      },
    }
  } catch (error) {
    disposePinia(pinia)
    await releaseStorage().catch(() => {})
    throw error
  }
}
