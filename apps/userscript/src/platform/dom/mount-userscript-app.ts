import { createApp } from 'vue'
import type { App, Component, Plugin } from 'vue'

import type { UserscriptAppMountTarget } from './mount-userscript-launcher'
import { USERSCRIPT_HOST_TAG_NAME } from './mount-userscript-launcher'
import { attachGeneratedShadowStyles } from './shadow-style-registry'

/** 正式 Vue 应用的根组件、插件和 Shadow Root 样式。 */
export interface MountUserscriptAppOptions {
  rootComponent: Component
  appPlugins?: readonly Plugin[]
  styles?: readonly string[]
}

/** 挂载结果暴露最小清理契约，启动器和未来测试可完整回收当前实例。 */
export interface MountedUserscriptApp {
  app: App<Element>
  host: HTMLElement
  unmount: () => void
}

/** 创建或复用启动器的 Shadow Root，并在同一宿主内挂载正式 Vue 应用。 */
export function mountUserscriptApp(
  options: MountUserscriptAppOptions,
  target?: UserscriptAppMountTarget,
): MountedUserscriptApp | undefined {
  if (!target && document.querySelector(USERSCRIPT_HOST_TAG_NAME)) return undefined

  const host = target?.host ?? document.createElement(USERSCRIPT_HOST_TAG_NAME)
  const shadowRoot = target?.shadowRoot ?? host.attachShadow({ mode: 'open' })
  // 用户离开或脚本卸载后，迟到的动态模块不得把旧宿主重新插回页面。
  if (target && !host.isConnected) return undefined

  const styleElement = document.createElement('style')
  const mountPoint = document.createElement('div')

  mountPoint.className = 'am-root'
  styleElement.textContent = options.styles?.join('\n') ?? ''
  // 原子替换启动器，避免展开时同时出现两套入口或短暂失去 Shadow 样式。
  shadowRoot.replaceChildren(styleElement, mountPoint)
  const detachGeneratedStyles = attachGeneratedShadowStyles(shadowRoot)
  if (!target) document.documentElement.append(host)

  const app = createApp(options.rootComponent)
  for (const plugin of options.appPlugins ?? []) app.use(plugin)
  try {
    app.mount(mountPoint)
  } catch (error) {
    detachGeneratedStyles()
    shadowRoot.replaceChildren()
    throw error
  }

  // 独立挂载时由本层守护宿主；从启动器展开时沿用启动器已经安装的观察器。
  const observer = target ? undefined : createHostObserver(host)
  let isUnmounted = false
  return {
    app,
    host,
    unmount: () => {
      if (isUnmounted) return
      isUnmounted = true
      observer?.disconnect()
      detachGeneratedStyles()
      app.unmount()
      host.remove()
    },
  }
}

function createHostObserver(host: HTMLElement): MutationObserver {
  const observer = new MutationObserver(() => {
    if (!document.documentElement.contains(host)) document.documentElement.append(host)
  })
  observer.observe(document.documentElement, { childList: true })
  return observer
}
