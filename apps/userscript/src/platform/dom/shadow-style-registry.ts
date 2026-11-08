const SHADOW_STYLE_STATE_KEY = '__ANY_MUSIC_SHADOW_STYLE_STATE_V1__'

interface ShadowStyleState {
  cssTexts: string[]
  root?: ShadowRoot
}

type ShadowStyleGlobal = typeof globalThis & {
  [SHADOW_STYLE_STATE_KEY]?: ShadowStyleState
}

function getShadowStyleState(): ShadowStyleState {
  const runtime = globalThis as ShadowStyleGlobal
  return (runtime[SHADOW_STYLE_STATE_KEY] ??= { cssTexts: [] })
}

/**
 * 把 Vite 产出的 SFC CSS 接入当前 Shadow Root。
 * 构建产物由 vite.config 的 cssSideEffects 写入同一注册表；开发态再镜像 Vite HMR 样式。
 */
export function attachGeneratedShadowStyles(shadowRoot: ShadowRoot): () => void {
  const state = getShadowStyleState()
  state.root = shadowRoot
  for (const cssText of state.cssTexts) appendStyle(shadowRoot, cssText)

  const mirroredStyles = new Map<HTMLStyleElement, HTMLStyleElement>()
  const syncDevelopmentStyles = (): void => {
    const currentSources = new Set<HTMLStyleElement>()
    for (const source of document.head.querySelectorAll<HTMLStyleElement>(
      'style[data-vite-dev-id]',
    )) {
      const id = source.dataset.viteDevId?.replaceAll('\\', '/') ?? ''
      // Build-known theme SFCs must follow neutral UI/workbench styles into the Shadow Root.
      if (
        !id.includes('/apps/userscript/') &&
        !id.includes('/packages/ui/') &&
        !id.includes('/packages/theme-default/') &&
        !id.includes('/packages/plugin-tag-management/') &&
        !id.includes('/packages/music-workbench/')
      ) {
        continue
      }
      currentSources.add(source)
      let mirror = mirroredStyles.get(source)
      if (!mirror) {
        mirror = document.createElement('style')
        mirror.dataset.amDevelopmentStyle = id
        mirroredStyles.set(source, mirror)
        shadowRoot.append(mirror)
      }
      if (mirror.textContent !== source.textContent) mirror.textContent = source.textContent
    }
    // Vite 热更新可能替换或移除节点；保留旧副本会让失效规则继续参与层叠。
    for (const [source, mirror] of mirroredStyles) {
      if (currentSources.has(source)) continue
      mirror.remove()
      mirroredStyles.delete(source)
    }
  }

  syncDevelopmentStyles()
  const observer = new MutationObserver(syncDevelopmentStyles)
  observer.observe(document.head, { childList: true, characterData: true, subtree: true })

  return () => {
    observer.disconnect()
    for (const mirror of mirroredStyles.values()) mirror.remove()
    if (state.root === shadowRoot) state.root = undefined
  }
}

function appendStyle(root: ShadowRoot, cssText: string): void {
  const style = document.createElement('style')
  style.dataset.amGeneratedStyle = ''
  style.textContent = cssText
  root.append(style)
}
