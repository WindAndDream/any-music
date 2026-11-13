import { installHostShortcutCaptureGuard } from './platform/dom/keyboard-event-boundary'
import {
  mountUserscriptLauncher,
  USERSCRIPT_HOST_TAG_NAME,
} from './platform/dom/mount-userscript-launcher'
import {
  parseDouyinPageBridgeTask,
  readDouyinPageBridgeSessionTask,
} from './platform/music-plugins/douyin/douyin-page-bridge'
import { installDouyinMainWorldSignatureBridge } from './platform/music-plugins/douyin/douyin-page-signature-bridge'

const HOST_CAPTURE_SHORTCUT_CODES = new Set(['KeyA', 'KeyD'])

// 必须在 document-start 抢先于宿主页安装已知冲突快捷键；非 Any Music 事件保持透明。
installHostShortcutCaptureGuard(window, {
  hostTagName: USERSCRIPT_HOST_TAG_NAME,
  shortcutCodes: HOST_CAPTURE_SHORTCUT_CODES,
})

// 签名桥必须先于抖音页面应用启动；非抖音宿主页使用隔离签名环境，不读取宿主状态。
installDouyinMainWorldSignatureBridge(document)

// 页面回退标签只执行捕获任务，不挂载可见应用，成功后由运行时负责关闭标签页。
if (hasDouyinPageBridgeTask()) {
  void import('./platform/music-plugins/douyin/douyin-page-capture-runtime')
    .then(({ installDouyinPageCapture }) => installDouyinPageCapture())
    .catch((error: unknown) => console.error('[Any Music] 抖音页面捕获器加载失败。', error))
} else {
  mountVisibleLauncher()
}

/** 同源登录或验证跳转可能丢失 fragment，因此还需检查当前标签页的短时会话任务。 */
function hasDouyinPageBridgeTask(): boolean {
  if (parseDouyinPageBridgeTask(window.location.href)) return true
  try {
    return (
      readDouyinPageBridgeSessionTask(window.sessionStorage, window.location.href, Date.now()) !==
      undefined
    )
  } catch {
    return false
  }
}

/** 在全部 HTTP(S) 顶层页面提供原生入口，完整应用只在用户首次展开后执行。 */
function mountVisibleLauncher(): void {
  mountLauncherIntoDocument()
  if (!document.documentElement)
    document.addEventListener('DOMContentLoaded', mountLauncherIntoDocument, { once: true })
}

/** 延迟回调保持无捕获，document-start 尚无根节点时不会反复创建闭包。 */
function mountLauncherIntoDocument(): void {
  if (!document.documentElement) return
  mountUserscriptLauncher({
    loadExpandedApp: async (target) => {
      const { mountExpandedUserscriptApp } = await import('./bootstrap-userscript-app')
      return mountExpandedUserscriptApp(target)
    },
  })
}
