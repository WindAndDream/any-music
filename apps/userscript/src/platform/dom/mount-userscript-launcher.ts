import { formatAppErrorMessage, toAppErrorState } from '@any-music/core'

import { installKeyboardEventBoundary } from './keyboard-event-boundary'

// 正式脚本使用独立低碰撞宿主，避免与测试脚本并存时互相去重或卸载。
export const USERSCRIPT_HOST_TAG_NAME = 'any-music-root'

/** 首次展开时交给 Vue 挂载层复用，避免替换 Shadow Host 造成闪烁。 */
export interface UserscriptAppMountTarget {
  host: HTMLElement
  shadowRoot: ShadowRoot
}

interface UnmountableUserscriptApp {
  unmount: () => void
}

export interface MountUserscriptLauncherOptions {
  loadExpandedApp: (
    target: UserscriptAppMountTarget,
  ) => Promise<UnmountableUserscriptApp | undefined>
}

export interface MountedUserscriptLauncher {
  host: HTMLElement
  unmount: () => void
}

const LAUNCHER_STYLE = `
:host {
  --am-launcher-accent: #002fa7;
  all: initial;
  position: fixed;
  z-index: 2147483647;
  inset: 0 0 auto auto;
  display: block;
  width: 0;
  height: 0;
  color-scheme: light;
  pointer-events: none;
}

.am-launcher {
  position: fixed;
  top: 50%;
  right: 8px;
  display: grid;
  width: 40px;
  height: 40px;
  place-items: center;
  padding: 0;
  border: 1px solid #3155b5;
  border-radius: 12px;
  background: var(--am-launcher-accent);
  box-shadow: 0 8px 24px rgb(0 47 167 / 28%);
  color: white;
  cursor: pointer;
  pointer-events: auto;
  transform: translateY(-50%);
  transition: box-shadow 180ms ease, transform 180ms ease;
}

.am-launcher:hover {
  box-shadow: 0 10px 30px rgb(0 47 167 / 40%);
  transform: translateY(-50%) scale(1.04);
}

.am-launcher:focus-visible {
  outline: 3px solid rgb(0 47 167 / 32%);
  outline-offset: 3px;
}

.am-launcher:disabled {
  cursor: progress;
  opacity: 0.72;
}

.am-launcher--loading {
  animation: am-launcher-pulse 1.1s ease-in-out infinite;
}

.am-launcher__icon {
  display: block;
  width: 20px;
  height: 20px;
  fill: none;
  stroke: currentcolor;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 2;
}

.am-launcher-status {
  position: fixed;
  top: 50%;
  right: 56px;
  display: flex;
  box-sizing: border-box;
  min-width: min(216px, calc(100vw - 72px));
  max-width: calc(100vw - 72px);
  align-items: center;
  gap: 10px;
  padding: 10px 13px;
  border: 1px solid rgb(26 26 31 / 12%);
  border-radius: 12px;
  background: rgb(255 255 255 / 96%);
  box-shadow: 0 12px 30px rgb(18 17 22 / 18%);
  color: #1a1a1f;
  font: 12px/1.4 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  opacity: 0;
  pointer-events: none;
  transform: translate(12px, -50%) scale(0.97);
  visibility: hidden;
  transition: opacity 160ms ease, transform 220ms cubic-bezier(0.22, 1, 0.36, 1), visibility 0s linear 220ms;
}

.am-launcher-status--active {
  opacity: 1;
  transform: translate(0, -50%) scale(1);
  visibility: visible;
  transition: opacity 160ms ease, transform 220ms cubic-bezier(0.22, 1, 0.36, 1), visibility 0s linear;
}

.am-launcher-status__spinner {
  width: 18px;
  height: 18px;
  flex: 0 0 auto;
  border: 2px solid rgb(0 47 167 / 20%);
  border-top-color: var(--am-launcher-accent);
  border-radius: 50%;
  animation: am-launcher-spin 720ms linear infinite;
}

.am-launcher-status__copy strong,
.am-launcher-status__copy small {
  display: block;
  overflow-wrap: anywhere;
}

.am-launcher-status--error .am-launcher-status__spinner {
  display: none;
}

.am-launcher-status__copy small {
  margin-top: 2px;
  color: rgb(26 26 31 / 60%);
  font-size: 10px;
}

@keyframes am-launcher-pulse {
  50% { box-shadow: 0 10px 32px rgb(0 47 167 / 52%); }
}

@keyframes am-launcher-spin {
  to { transform: rotate(1turn); }
}

@media (prefers-color-scheme: dark) {
  :host { color-scheme: dark; }
  .am-launcher-status {
    border-color: rgb(243 240 234 / 12%);
    background: rgb(30 28 36 / 96%);
    color: #f3f0ea;
  }
  .am-launcher-status__copy small { color: rgb(243 240 234 / 60%); }
}

@media (prefers-reduced-motion: reduce) {
  .am-launcher,
  .am-launcher-status { transition: none; }
  .am-launcher--loading,
  .am-launcher-status__spinner { animation: none; }
}
`

/**
 * 全站只挂载无框架依赖的原生入口；完整 Vue 应用由首次点击动态加载。
 * 加载失败会恢复同一入口，临时模块错误不会迫使用户刷新宿主页。
 */
export function mountUserscriptLauncher(
  options: MountUserscriptLauncherOptions,
): MountedUserscriptLauncher | undefined {
  if (document.querySelector(USERSCRIPT_HOST_TAG_NAME)) return undefined

  const host = document.createElement(USERSCRIPT_HOST_TAG_NAME)
  const shadowRoot = host.attachShadow({ mode: 'open' })
  const style = document.createElement('style')
  const button = createLauncherButton()
  const {
    indicator: loadingIndicator,
    title: loadingTitle,
    description: loadingDescription,
  } = createLoadingIndicator()
  const removeKeyboardEventBoundary = installKeyboardEventBoundary(shadowRoot)

  style.textContent = LAUNCHER_STYLE
  shadowRoot.append(style, loadingIndicator, button)
  document.documentElement.append(host)

  const observer = new MutationObserver(() => {
    if (!document.documentElement.contains(host)) document.documentElement.append(host)
  })
  observer.observe(document.documentElement, { childList: true })

  let isDisposed = false
  let isLoading = false
  let mountedApp: UnmountableUserscriptApp | undefined

  const handleExpand = async (): Promise<void> => {
    if (isDisposed || isLoading || mountedApp) return

    isLoading = true
    button.disabled = true
    button.classList.add('am-launcher--loading')
    button.setAttribute('aria-busy', 'true')
    button.setAttribute('aria-describedby', 'am-launcher-status')
    button.title = '正在加载 Any Music…'
    loadingTitle.textContent = '正在打开 Any Music'
    loadingDescription.textContent = '加载音乐资料与播放器…'
    loadingIndicator.classList.remove('am-launcher-status--error')
    loadingIndicator.classList.add('am-launcher-status--active')
    loadingIndicator.setAttribute('aria-hidden', 'false')

    try {
      // 在动态模块占用主线程前提交至少一帧反馈，避免首次展开看似没有响应。
      await waitForLoadingIndicatorPaint()
      if (isDisposed) return
      const loadedApp = await options.loadExpandedApp({ host, shadowRoot })
      if (!loadedApp) throw new Error('Any Music 应用未能挂载。')
      if (isDisposed) {
        loadedApp.unmount()
        return
      }
      mountedApp = loadedApp
    } catch (error) {
      if (isDisposed) return
      // Vue 挂载层可能已经清空 Shadow Root；恢复原生节点和监听以允许立即重试。
      shadowRoot.replaceChildren(style, loadingIndicator, button)
      button.disabled = false
      button.classList.remove('am-launcher--loading')
      button.setAttribute('aria-busy', 'false')
      const message = formatAppErrorMessage(
        toAppErrorState(error, 'invariant-violation', 'Any Music 加载失败，请重试。'),
      )
      button.title = `加载失败：${message}`
      // Touch users cannot hover a title. Keep the actionable failure visible and
      // described by the same retry button after a failed import or writer claim.
      loadingTitle.textContent = 'Any Music 打开失败'
      loadingDescription.textContent = `${message} 点击右侧按钮重试。`
      loadingIndicator.classList.add('am-launcher-status--error', 'am-launcher-status--active')
      loadingIndicator.setAttribute('aria-hidden', 'false')
      console.error('[Any Music] 加载正式应用失败。', error)
    } finally {
      isLoading = false
    }
  }
  const handleButtonClick = (): void => void handleExpand()
  button.addEventListener('click', handleButtonClick)

  return {
    host,
    unmount: () => {
      if (isDisposed) return
      isDisposed = true
      observer.disconnect()
      button.removeEventListener('click', handleButtonClick)
      removeKeyboardEventBoundary()
      if (mountedApp) mountedApp.unmount()
      else host.remove()
    },
  }
}

function waitForLoadingIndicatorPaint(): Promise<void> {
  return new Promise((resolve) => {
    let isResolved = false
    const fallbackTimer = window.setTimeout(finish, 80)

    function finish(): void {
      if (isResolved) return
      isResolved = true
      window.clearTimeout(fallbackTimer)
      resolve()
    }

    window.requestAnimationFrame(() => window.requestAnimationFrame(finish))
  })
}

function createLoadingIndicator() {
  const indicator = document.createElement('div')
  const spinner = document.createElement('span')
  const copy = document.createElement('span')
  const title = document.createElement('strong')
  const description = document.createElement('small')

  indicator.className = 'am-launcher-status'
  indicator.id = 'am-launcher-status'
  indicator.setAttribute('role', 'status')
  indicator.setAttribute('aria-live', 'polite')
  indicator.setAttribute('aria-hidden', 'true')
  spinner.className = 'am-launcher-status__spinner'
  spinner.setAttribute('aria-hidden', 'true')
  copy.className = 'am-launcher-status__copy'
  title.textContent = '正在打开 Any Music'
  description.textContent = '加载音乐资料与播放器…'
  copy.append(title, description)
  indicator.append(spinner, copy)
  return { indicator, title, description }
}

function createLauncherButton(): HTMLButtonElement {
  const button = document.createElement('button')
  const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')

  button.type = 'button'
  button.className = 'am-launcher'
  button.setAttribute('aria-label', '展开 Any Music')
  button.setAttribute('aria-expanded', 'false')
  button.setAttribute('aria-busy', 'false')
  button.title = '展开 Any Music'
  icon.classList.add('am-launcher__icon')
  icon.setAttribute('viewBox', '0 0 20 20')
  icon.setAttribute('aria-hidden', 'true')
  icon.setAttribute('focusable', 'false')
  path.setAttribute('d', 'M12.5 4.5 7 10l5.5 5.5M7 10h8')
  icon.append(path)
  button.append(icon)
  return button
}
